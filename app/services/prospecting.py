import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import Company, Contact, Job
from app.services import applog, jobs
from app.services import people as P
from app.services.blacklist import BlacklistSets, load_blacklist
from app.services.countries import to_iso
from app.services.dedup import upsert_company, upsert_contact
from app.services.email_discovery import discover_candidates
from app.services.email_verifier import _resolve_mx, probe_domain, verify_many
from app.services.normalize import extract_domain
from app.services.providers import resolve
from app.services.providers.base import SearchParams
from app.services.sources import people_web
from app.services.sources.crawler import crawl_site
from app.services.sources.site_finder import find_site
from app.services.verification import verify_batches

log = applog.get("prospecting")
BATCH = 40  # entreprises enrichies par lot (un checkpoint par lot)
NO_PEOPLE = {"enabled": False, "titles": [], "levels": [], "departments": [], "sources": [], "max": 15}


def _smtp_enabled(use_smtp: bool | None) -> bool:
    return settings.SMTP_CHECK_ENABLED if use_smtp is None else use_smtp


def _discover(db: Session, company: Company, bl: BlacklistSets, stats: Counter,
              timings: applog.Timings | None = None, use_officers: bool = True) -> int:
    """Génère contact@, info@ (+ patterns des dirigeants si use_officers) et ne garde que les adresses confirmées par SMTP."""
    officers = (company.extra or {}).get("officers", []) if use_officers else []
    cands = discover_candidates(company.domain, officers, settings.DISCOVERY_MAX_ROLE)
    if not cands:
        return 0
    with applog.timed(log, "smtp_probe", company.domain, timings):
        info = probe_domain(company.domain)
    # On ne peut confirmer une adresse que si le serveur rejette les adresses inexistantes (catch_all == False)
    if not info["has_mx"] or info["catch_all"] is not False:
        stats["discovery_domain_unverifiable"] += 1
        return 0
    created = 0
    with applog.timed(log, "smtp_verify", company.domain, timings):
        results = verify_many([c["email"] for c in cands], True)
    for cand in cands:
        r = results[cand["email"]]
        if r["status"] != "valid":
            continue
        ct, st = upsert_contact(db, {**cand, "company_id": company.id, "source": "discovery"}, bl)
        if ct is not None and st == "created":
            ct.email_status, ct.email_reason = "valid", f"discovery:{cand['kind']};{r['reason']}"
            ct.email_score, ct.is_role, ct.verified_at = r["score"], r["is_role"], datetime.utcnow()
            stats["contacts_discovered"] += 1
            created += 1
    return created


def _generic_fallback(db: Session, company: Company, bl: BlacklistSets, stats: Counter) -> None:
    """SMTP inutilisable : ajoute contact@ et info@ si le domaine reçoit des mails. Statut 'risky' (non confirmé)."""
    hosts, err = _resolve_mx(company.domain)
    if err or not hosts:
        return
    for prefix in ("contact", "info"):
        ct, st = upsert_contact(db, {"email": f"{prefix}@{company.domain}", "company_id": company.id,
                                     "source": "discovery"}, bl)
        if ct is not None and st == "created":
            ct.email_status, ct.email_reason = "risky", "discovery:generic_unverified"
            ct.email_score, ct.is_role, ct.verified_at = 40, True, datetime.utcnow()
            stats["contacts_generic_unverified"] += 1


def _people(db: Session, company: Company, site_people: list[dict], ext_people: list[dict], bl: BlacklistSets,
            stats: Counter, timings: applog.Timings | None, smtp_ok: bool, cfg: dict) -> tuple[list[int], int]:
    """Personnes d'une entreprise -> contacts. Retourne (ids à vérifier, nombre de contacts avec email)."""
    officers = []
    if "registry" in cfg["sources"]:
        officers = [P.blank(first_name=o.get("first_name"), last_name=o.get("last_name"),
                            job_title=o.get("role"), source="registry")
                    for o in (company.extra or {}).get("officers", []) if o.get("last_name") and o.get("first_name")]
    people = P.select(P.merge(site_people, officers, ext_people), cfg)
    if not people:
        return [], 0
    stats["people_found"] += len(people)
    domain = company.domain
    ids: list[int] = []
    n_emails = 0
    no_email: list[dict] = []
    resolved: set[str] = set()

    # format d'email réel du domaine, déduit des adresses déjà connues (nom + email)
    pairs = []
    if domain:
        for f, l, e in db.execute(select(Contact.first_name, Contact.last_name, Contact.email)
                                  .where(Contact.company_id == company.id)).all():
            if f and l and e.lower().endswith("@" + domain):
                pairs.append((f, l, e.split("@")[0]))
        pairs += [(p["first_name"], p["last_name"], p["email"].split("@")[0]) for p in people
                  if p.get("email") and p["first_name"] and p["last_name"] and p["email"].lower().endswith("@" + domain)]
    pattern = P.infer_pattern(pairs)
    info: dict | None = None

    for p in people:
        key = P.slug(p.get("first_name")) + P.slug(p.get("last_name"))
        data = {"first_name": p.get("first_name"), "last_name": p.get("last_name"), "job_title": p.get("job_title"),
                "phone": p.get("phone"), "profile_url": p.get("profile_url"), "department": p.get("department"),
                "seniority": p.get("seniority"), "evidence": p.get("evidence"), "company_id": company.id}

        if p.get("email"):  # email publié : sera vérifié par la phase de vérification
            ct, st = upsert_contact(db, {**data, "email": p["email"], "source": p.get("source") or "website"}, bl)
            if st == "created":
                ids.append(ct.id)
                stats["people_emails_direct"] += 1
            if st in ("created", "duplicate"):
                n_emails += 1
                resolved.add(key)
            continue

        if not domain or not p.get("first_name") or not p.get("last_name"):
            no_email.append(p)
            continue
        if info is None:
            with applog.timed(log, "smtp_probe", domain, timings):
                info = probe_domain(domain)
        if not info["has_mx"]:
            no_email.append(p)
            continue
        verifiable = smtp_ok and info["catch_all"] is False
        if pattern:
            pats = [pattern]
        elif verifiable:
            pats = P.PATTERNS[:5]
        else:
            pats = []
        cands = [f"{e}@{domain}" for e in (P.build_email(pt, p["first_name"], p["last_name"]) for pt in pats) if e]
        if not cands:
            no_email.append(p)
            continue

        if verifiable:
            with applog.timed(log, "smtp_verify", f"{p['last_name']}@{domain}", timings):
                results = verify_many(cands, True)
            good = next((c for c in cands if results[c]["status"] == "valid"), None)
            if not good:
                no_email.append(p)
                continue
            r = results[good]
            ct, st = upsert_contact(db, {**data, "email": good, "source": "people_pattern"}, bl)
            if ct is not None and st == "created":
                ct.email_status, ct.email_reason = "valid", f"people:pattern;{r['reason']}"
                ct.email_score, ct.is_role, ct.verified_at = r["score"], r["is_role"], datetime.utcnow()
                stats["people_emails_verified"] += 1
            if st in ("created", "duplicate"):
                n_emails += 1
                resolved.add(key)
            continue

        # SMTP impossible : on n'ajoute que si le format est confirmé par une vraie adresse du domaine
        ct, st = upsert_contact(db, {**data, "email": cands[0], "source": "people_pattern"}, bl)
        if ct is not None and st == "created":
            ct.email_status, ct.email_reason = "risky", "people:pattern_inferred"
            ct.email_score, ct.is_role, ct.verified_at = 45, False, datetime.utcnow()
            stats["people_emails_inferred"] += 1
        if st in ("created", "duplicate"):
            n_emails += 1
            resolved.add(key)

    # personnes sans email : conservées (nom, poste, profil) dans la fiche entreprise
    extra = dict(company.extra or {})
    cur = {P.slug(x.get("first_name")) + P.slug(x.get("last_name")): x for x in extra.get("people", [])}
    for k in resolved:
        cur.pop(k, None)
    for p in no_email:
        cur[P.slug(p.get("first_name")) + P.slug(p.get("last_name"))] = {
            k: p.get(k) for k in ("first_name", "last_name", "job_title", "seniority", "department",
                                  "profile_url", "phone", "source", "evidence")}
    stats["people_profile_only"] += len(no_email)
    if cur != {P.slug(x.get("first_name")) + P.slug(x.get("last_name")): x for x in extra.get("people", [])}:
        extra["people"] = list(cur.values())[:100]
        company.extra = extra
    return ids, n_emails


def _find_sites(companies: list[Company], stats: Counter, timings: applog.Timings | None = None) -> None:
    """Retrouve le site des entreprises qui n'en ont pas (une seule tentative par entreprise)."""
    todo = [(c, c.name, c.country, c.city) for c in companies
            if not c.website and not (c.extra or {}).get("site_search")]
    if not todo:
        return

    def work(t):
        try:
            with applog.timed(log, "site_finder", t[1], timings):
                return find_site(t[1], t[2], t[3], settings.SITE_FINDER_WEB)
        except Exception as e:  # noqa: BLE001
            log.warning("find_site a échoué pour %r : %r", t[1], e)
            return None

    with ThreadPoolExecutor(max_workers=max(1, settings.CRAWL_WORKERS)) as ex:
        sites = list(ex.map(work, todo))
    today = datetime.utcnow().strftime("%Y-%m-%d")
    for (c, *_), site in zip(todo, sites):
        extra = dict(c.extra or {})
        if site:
            c.website, c.domain = site, extract_domain(site)
            extra["site_search"] = f"found {today}"
            stats["sites_found"] += 1
        else:
            extra["site_search"] = f"none {today}"
            stats["sites_not_found"] += 1
        c.extra = extra


def enrich_companies(db: Session, companies: list[Company], crawl: bool, discover: bool,
                     use_smtp: bool | None, bl: BlacklistSets, stats: Counter,
                     timings: applog.Timings | None = None, job_id: int | None = None,
                     pcfg: dict | None = None) -> list[int]:
    """Trouve le site, lit les pages, cherche emails/téléphones et personnes. Retourne les ids de contacts à vérifier."""
    pcfg = pcfg or NO_PEOPLE
    people_on = pcfg["enabled"]
    site_people = people_on and "website" in pcfg["sources"]
    crawl = crawl or site_people
    new_ids: list[int] = []
    if settings.SITE_FINDER_ENABLED and (crawl or discover or people_on):
        jobs.beat(job_id, f"recherche de sites ({len(companies)} entreprises)")
        _find_sites(companies, stats, timings)
        db.commit()

    crawled: dict[str, dict] = {}
    if crawl:
        sites = list({c.website for c in companies if c.website and c.domain})
        jobs.beat(job_id, f"lecture de {len(sites)} sites web")

        def _crawl(site: str) -> dict:
            try:
                with applog.timed(log, "crawl", site, timings):
                    return crawl_site(site, site_people)
            except Exception:  # noqa: BLE001
                log.warning("crawl_site a planté pour %s", site, exc_info=True)
                return {"emails": [], "phones": [], "people": []}

        with ThreadPoolExecutor(max_workers=settings.CRAWL_WORKERS) as ex:
            for site, res in zip(sites, ex.map(_crawl, sites)):
                crawled[site] = res

    external: dict[int, list[dict]] = {}
    if people_on and {"web", "profiles", "github"} & set(pcfg["sources"]):
        jobs.beat(job_id, f"recherche de personnes sur le web ({len(companies)} entreprises)")

        def _ext(c: Company):
            try:
                with applog.timed(log, "people_external", c.name, timings):
                    return c.id, people_web.fetch(c.name, c.domain, c.country, pcfg)
            except Exception:  # noqa: BLE001
                log.warning("people_web.fetch a planté pour %r", c.name, exc_info=True)
                return c.id, []

        with ThreadPoolExecutor(max_workers=2) as ex:  # DuckDuckGo est de toute façon limité à 1 requête / 2 s
            for cid, res in ex.map(_ext, companies):
                external[cid] = res

    smtp_ok = _smtp_enabled(use_smtp)
    today = datetime.utcnow().strftime("%Y-%m-%d")

    def one(c: Company) -> list[int]:
        ids: list[int] = []
        found = 0
        res = crawled.get(c.website or "", {})
        if res.get("phones") and not c.phone:
            c.phone = res["phones"][0]
        for email in res.get("emails", []):
            ct, st = upsert_contact(db, {"email": email, "company_id": c.id, "source": "website"}, bl)
            stats[f"contacts_{st}"] += 1
            if st == "created":
                ids.append(ct.id)
                found += 1
            elif st == "duplicate":
                found += 1
        if people_on:
            p_ids, p_found = _people(db, c, res.get("people", []), external.get(c.id, []), bl, stats,
                                     timings, smtp_ok, pcfg)
            ids += p_ids
            found += p_found
        if discover and c.domain and not found:
            created = 0
            if smtp_ok:
                created = _discover(db, c, bl, stats, timings, use_officers=not people_on)
            else:
                stats["discovery_skipped_smtp_disabled"] += 1
            if not created and settings.DISCOVERY_FALLBACK_GENERIC:
                _generic_fallback(db, c, bl, stats)
        c.extra = {**(c.extra or {}), "enriched": today}
        return ids

    for c in companies:
        jobs.beat(job_id, f"entreprise {c.name}")
        try:
            with db.begin_nested():  # une entreprise en erreur n'annule pas tout le lot
                new_ids += one(c)
        except Exception:  # noqa: BLE001
            log.error("Entreprise #%s (%s) : enrichissement échoué", c.id, c.name, exc_info=True)
            stats["companies_enrich_errors"] += 1
    db.commit()
    return new_ids


@jobs.tracked("search")
def run_search_job(job_id: int) -> None:
    db = SessionLocal()
    job = db.get(Job, job_id)
    jl = applog.jlog("prospecting", job_id)
    timings = applog.Timings()
    t_start = time.time()
    try:
        jobs.start(db, job)
        p = job.params
        pcfg = P.cfg_from(p)
        prog = dict(job.progress or {})  # non vide = reprise après interruption
        if prog.get("phase"):
            jl.info("EVENT search.resume phase=%s percent=%s", prog.get("phase"), prog.get("percent"))
        timings.load(prog.get("timings"))
        base_elapsed = float(prog.get("elapsed_s") or 0)
        stats = Counter(prog.get("stats") or {})
        done_tasks = set(prog.get("done_tasks") or [])
        per_source = dict(prog.get("per_source") or {})
        errors = dict(prog.get("errors") or {})
        skipped: dict[str, str] = {}
        raw_total = int(prog.get("raw_results") or 0)
        company_ids = list(prog.get("company_ids") or [])
        seen_ids = set(company_ids)
        new_ids = list(prog.get("new_ids") or [])
        enriched = set(prog.get("enriched_ids") or [])
        bl = load_blacklist(db)

        def save(phase: str, message: str, percent: int) -> None:
            prog.update(phase=phase, message=message, percent=int(percent), stats=dict(stats),
                        done_tasks=sorted(done_tasks), per_source=per_source, errors=errors, skipped=skipped,
                        raw_results=raw_total, company_ids=company_ids, new_ids=new_ids,
                        enriched_ids=sorted(enriched), timings=timings.summary(),
                        elapsed_s=round(base_elapsed + time.time() - t_start, 1))
            jobs.checkpoint(db, job, prog)

        # ---------- tâches (source × pays × mot-clé) ----------
        queries = p.get("queries") or ([p["query"]] if p.get("query") else [""])
        raw_countries = p.get("countries") or ([p["country"]] if p.get("country") else [])
        countries = [to_iso(c) or c for c in raw_countries] or [None]
        excluded = set(p.get("exclude_sources") or [])
        tasks: list[tuple] = []
        for country in countries:
            providers, sk = resolve(p["sources"], country)
            for name in excluded:
                sk.pop(name, None)
            providers = [x for x in providers if x.name not in excluded]
            skipped.update({f"{k} [{country or '-'}]": v for k, v in sk.items()})
            for prov in providers:
                for q in queries:
                    tasks.append((prov, SearchParams(query=q, location=p.get("location", ""), country=country,
                                                     limit=p["limit"], filters=p.get("filters") or {})))

        def key(t) -> str:
            return f"{t[0].name}|{t[1].country or '-'}|{t[1].query}"

        todo = [t for t in tasks if key(t) not in done_tasks]
        jl.info("EVENT search.plan tasks=%d todo=%d skipped_sources=%d people=%s", len(tasks), len(todo),
                len(skipped), pcfg["sources"] if pcfg["enabled"] else "off")
        if not tasks:
            jl.warning("Aucune source active pour cette recherche (voir sources_skipped)")
        save("providers", f"Sources : 0/{len(todo)}", 0)

        # ---------- phase 1 : sources (enregistrement immédiat de chaque résultat) ----------
        def run(task):
            prov, sp = task
            try:
                with applog.timed(jl, f"provider:{prov.name}", f"{sp.country or '-'} {sp.query!r}", timings):
                    items = prov.search(sp)
                for it in items:
                    it.setdefault("source", prov.name)
                jl.info("EVENT provider.done name=%s country=%s q=%r results=%d", prov.name,
                        sp.country or "-", sp.query, len(items))
                return task, items, None
            except Exception as e:  # noqa: BLE001
                jl.error("Source %s a échoué (pays=%s requête=%r)", prov.name, sp.country, sp.query, exc_info=True)
                return task, [], repr(e)[:300]
            finally:
                jobs.beat(job_id, f"source {prov.name} {sp.country or ''}")

        if todo:
            with ThreadPoolExecutor(max_workers=max(1, settings.PROVIDER_WORKERS)) as ex:
                futures = [ex.submit(run, t) for t in todo]
                for i, fut in enumerate(as_completed(futures), 1):
                    task, items, err = fut.result()
                    prov = task[0]
                    per_source[prov.name] = per_source.get(prov.name, 0) + len(items)
                    raw_total += len(items)
                    if err:
                        errors[prov.name] = err
                    try:
                        for r in items:
                            try:
                                company, created = upsert_company(db, r, r["source"])
                            except ValueError:
                                continue
                            stats["companies_new" if created else "companies_duplicates"] += 1
                            if company.id not in seen_ids:
                                seen_ids.add(company.id)
                                company_ids.append(company.id)
                            if r.get("email"):
                                ct, status = upsert_contact(db, {"email": r["email"], "company_id": company.id,
                                                                 "source": r["source"]}, bl)
                                stats[f"contacts_{status}"] += 1
                                if status == "created":
                                    new_ids.append(ct.id)
                        db.commit()
                    except Exception as e:  # noqa: BLE001
                        db.rollback()
                        jl.error("Enregistrement des résultats de %s échoué", prov.name, exc_info=True)
                        errors[f"{prov.name}:db"] = repr(e)[:300]
                        continue  # tâche non marquée terminée : elle sera refaite à la reprise
                    done_tasks.add(key(task))
                    save("providers", f"Sources : {i}/{len(todo)} · {len(company_ids)} entreprises",
                         35 * i / max(1, len(todo)))

        # ---------- phase 2 : enrichissement (sites, emails, personnes) par lots ----------
        if p["enrich_websites"] or p["discover_emails"] or pcfg["enabled"]:
            todo_ids = [i for i in company_ids if i not in enriched]
            for b in range(0, len(todo_ids), BATCH):
                chunk = todo_ids[b:b + BATCH]
                comps = db.execute(select(Company).where(Company.id.in_(chunk))).scalars().all()
                with applog.timed(jl, "enrich_batch", f"{len(chunk)} entreprises", timings,
                                  warn_after=settings.SLOW_BATCH_S):
                    new_ids += enrich_companies(db, comps, p["enrich_websites"], p["discover_emails"],
                                                p.get("use_smtp"), bl, stats, timings, job_id, pcfg)
                enriched.update(chunk)
                save("enrich", f"Enrichissement {len(enriched)}/{len(company_ids)}",
                     35 + 50 * len(enriched) / max(1, len(company_ids)))

        # ---------- phase 3 : vérification par lots ----------
        verification = None
        if p["verify"] and new_ids:
            verification = verify_batches(db, job, prog, new_ids, p.get("use_smtp"), timings,
                                          pct_from=85, pct_to=99, statuses=("unverified", "unknown"))

        result = {"sources_used": sorted({t[0].name for t in tasks}), "sources_skipped": skipped,
                  "results_per_source": per_source, "source_errors": errors,
                  "raw_results": raw_total, **stats,
                  "duration_s": round(base_elapsed + time.time() - t_start),
                  "timings": timings.summary()}
        if verification is not None:
            result["verification"] = verification
        jobs.finish(db, job, result)
    except Exception as e:  # noqa: BLE001
        jl.exception("Tâche search plantée")
        jobs.fail(db, job, repr(e))
    finally:
        db.close()


@jobs.tracked("enrich")
def run_enrich_job(job_id: int) -> None:
    db = SessionLocal()
    job = db.get(Job, job_id)
    jl = applog.jlog("prospecting", job_id)
    timings = applog.Timings()
    t_start = time.time()
    try:
        jobs.start(db, job)
        p = job.params
        pcfg = P.cfg_from(p)
        prog = dict(job.progress or {})
        timings.load(prog.get("timings"))
        base_elapsed = float(prog.get("elapsed_s") or 0)
        stats = Counter(prog.get("stats") or {})

        if "company_ids" not in prog:  # première exécution : on fige la liste à traiter
            if p.get("company_ids"):
                ids = list(dict.fromkeys(p["company_ids"]))
            else:
                # Entreprises sans contact : avec site, ou sans site si la recherche de site est active.
                # Celles déjà traitées ("enriched") sont sautées, sauf retry=true.
                no_contact = ~exists(select(Contact.id).where(Contact.company_id == Company.id))
                rows = db.execute(select(Company).where(no_contact).order_by(Company.id.desc())).scalars().all()
                retry = bool(p.get("retry"))

                def eligible(c: Company) -> bool:
                    ex = c.extra or {}
                    if ex.get("enriched") and not retry:
                        return False
                    return bool(c.domain) or (settings.SITE_FINDER_ENABLED and (retry or not ex.get("site_search")))

                ids = [c.id for c in rows if eligible(c)][: p["limit"]]
            prog.update(company_ids=ids, done_ids=[], new_ids=[], phase="enrich", percent=0,
                        message=f"{len(ids)} entreprises à traiter")
            jobs.checkpoint(db, job, prog)
            jl.info("EVENT enrich.selected count=%d", len(ids))

        ids = prog["company_ids"]
        done = set(prog.get("done_ids") or [])
        new_ids = list(prog.get("new_ids") or [])
        bl = load_blacklist(db)
        todo = [i for i in ids if i not in done]
        for b in range(0, len(todo), BATCH):
            chunk = todo[b:b + BATCH]
            comps = db.execute(select(Company).where(Company.id.in_(chunk))).scalars().all()
            with applog.timed(jl, "enrich_batch", f"{len(chunk)} entreprises", timings,
                              warn_after=settings.SLOW_BATCH_S):
                new_ids += enrich_companies(db, comps, p["crawl_websites"], p["discover_emails"],
                                            p.get("use_smtp"), bl, stats, timings, job_id, pcfg)
            done.update(chunk)
            prog.update(done_ids=sorted(done), new_ids=new_ids, stats=dict(stats), timings=timings.summary(),
                        elapsed_s=round(base_elapsed + time.time() - t_start, 1), phase="enrich",
                        message=f"Enrichissement {len(done)}/{len(ids)}",
                        percent=int(90 * len(done) / max(1, len(ids))))
            jobs.checkpoint(db, job, prog)

        result = {"companies_processed": len(ids), **stats}
        if p["verify"] and new_ids:
            result["verification"] = verify_batches(db, job, prog, new_ids, p.get("use_smtp"), timings,
                                                    pct_from=90, pct_to=99, statuses=("unverified", "unknown"))
        result["duration_s"] = round(base_elapsed + time.time() - t_start)
        result["timings"] = timings.summary()
        jobs.finish(db, job, result)
    except Exception as e:  # noqa: BLE001
        jl.exception("Tâche enrich plantée")
        jobs.fail(db, job, repr(e))
    finally:
        db.close()