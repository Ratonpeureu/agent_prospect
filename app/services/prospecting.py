from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import Company, Contact, Job
from app.services import jobs

from app.services.blacklist import BlacklistSets, load_blacklist
from app.services.countries import to_iso
from app.services.dedup import upsert_company, upsert_contact
from app.services.email_discovery import discover_candidates
from app.services.email_verifier import _resolve_mx, probe_domain, verify_many
from app.services.normalize import extract_domain
from app.services.providers import resolve
from app.services.providers.base import SearchParams
from app.services.sources.crawler import crawl_site
from app.services.sources.site_finder import find_site
from app.services.verification import verify_contacts


def _smtp_enabled(use_smtp: bool | None) -> bool:
    return settings.SMTP_CHECK_ENABLED if use_smtp is None else use_smtp


def _discover(db: Session, company: Company, bl: BlacklistSets, stats: Counter) -> int:
    """Génère contact@, info@, prenom.nom@... et ne garde que les adresses confirmées par SMTP. Retourne le nombre créé."""
    cands = discover_candidates(company.domain, (company.extra or {}).get("officers", []),
                                settings.DISCOVERY_MAX_ROLE)
    if not cands:
        return 0
    info = probe_domain(company.domain)
    # On ne peut confirmer une adresse que si le serveur rejette les adresses inexistantes (catch_all == False)
    if not info["has_mx"] or info["catch_all"] is not False:
        stats["discovery_domain_unverifiable"] += 1
        return 0
    created = 0
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


def _find_sites(companies: list[Company], stats: Counter) -> None:
    """Retrouve le site des entreprises qui n'en ont pas (une seule tentative par entreprise)."""
    todo = [(c, c.name, c.country, c.city) for c in companies
            if not c.website and not (c.extra or {}).get("site_search")]
    if not todo:
        return

    def work(t):
        try:
            return find_site(t[1], t[2], t[3], settings.SITE_FINDER_WEB)
        except Exception:  # noqa: BLE001
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
                     use_smtp: bool | None, bl: BlacklistSets, stats: Counter) -> list[int]:
    """Trouve le site, lit les pages, cherche emails/téléphones. Retourne les ids des contacts à vérifier."""
    new_ids: list[int] = []
    if settings.SITE_FINDER_ENABLED and (crawl or discover):
        _find_sites(companies, stats)
        db.commit()

    crawled: dict[str, dict] = {}
    if crawl:
        sites = list({c.website for c in companies if c.website and c.domain})
        with ThreadPoolExecutor(max_workers=settings.CRAWL_WORKERS) as ex:
            for site, res in zip(sites, ex.map(crawl_site, sites)):
                crawled[site] = res

    smtp_ok = _smtp_enabled(use_smtp)
    today = datetime.utcnow().strftime("%Y-%m-%d")
    for c in companies:
        found = 0
        res = crawled.get(c.website or "", {})
        if res.get("phones") and not c.phone:
            c.phone = res["phones"][0]
        for email in res.get("emails", []):
            ct, st = upsert_contact(db, {"email": email, "company_id": c.id, "source": "website"}, bl)
            stats[f"contacts_{st}"] += 1
            if st == "created":
                new_ids.append(ct.id)
                found += 1
            elif st == "duplicate":
                found += 1
        if discover and c.domain and not found:
            created = 0
            if smtp_ok:
                created = _discover(db, c, bl, stats)
            else:
                stats["discovery_skipped_smtp_disabled"] += 1
            if not created and settings.DISCOVERY_FALLBACK_GENERIC:
                _generic_fallback(db, c, bl, stats)
        c.extra = {**(c.extra or {}), "enriched": today}
    db.commit()
    return new_ids


def run_search_job(job_id: int) -> None:
    db = SessionLocal()
    job = db.get(Job, job_id)
    try:
        jobs.start(db, job)
        p = job.params
        queries = p.get("queries") or ([p["query"]] if p.get("query") else [""])
        raw_countries = p.get("countries") or ([p["country"]] if p.get("country") else [])
        countries = [to_iso(c) or c for c in raw_countries] or [None]

        tasks: list[tuple] = []
        excluded = set(p.get("exclude_sources") or [])
        skipped: dict[str, str] = {}
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

        def run(task):
            prov, sp = task
            try:
                items = prov.search(sp)
                for it in items:
                    it.setdefault("source", prov.name)
                return prov.name, items, None
            except Exception as e:  # noqa: BLE001
                return prov.name, [], repr(e)

        raw: list[dict] = []
        per_source: dict[str, int] = {}
        errors: dict[str, str] = {}
        with ThreadPoolExecutor(max_workers=max(1, settings.PROVIDER_WORKERS)) as ex:
            for name, items, err in ex.map(run, tasks):
                per_source[name] = per_source.get(name, 0) + len(items)
                if err:
                    errors[name] = err
                raw += items

        stats: Counter = Counter()
        bl = load_blacklist(db)
        companies: dict[int, Company] = {}
        new_ids: list[int] = []

        for r in raw:
            try:
                company, created = upsert_company(db, r, r["source"])
            except ValueError:
                continue
            stats["companies_new" if created else "companies_duplicates"] += 1
            companies[company.id] = company
            if r.get("email"):
                ct, st = upsert_contact(db, {"email": r["email"], "company_id": company.id,
                                             "source": r["source"]}, bl)
                stats[f"contacts_{st}"] += 1
                if st == "created":
                    new_ids.append(ct.id)
        db.commit()

        if p["enrich_websites"] or p["discover_emails"]:
            new_ids += enrich_companies(db, list(companies.values()), p["enrich_websites"],
                                        p["discover_emails"], p.get("use_smtp"), bl, stats)

        result = {"sources_used": sorted({t[0].name for t in tasks}), "sources_skipped": skipped,
                  "results_per_source": per_source, "source_errors": errors,
                  "raw_results": len(raw), **stats}
        if p["verify"] and new_ids:
            result["verification"] = verify_contacts(db, new_ids, use_smtp=p.get("use_smtp"))
        jobs.finish(db, job, result)
    except Exception as e:  # noqa: BLE001
        jobs.fail(db, job, repr(e))
    finally:
        db.close()


def run_enrich_job(job_id: int) -> None:
    db = SessionLocal()
    job = db.get(Job, job_id)
    try:
        jobs.start(db, job)
        p = job.params
        if p.get("company_ids"):
            companies = db.execute(select(Company).where(Company.id.in_(p["company_ids"]))).scalars().all()
        else:
            # Toutes les entreprises sans contact : avec site, ou sans site si la recherche de site est active.
            # Celles déjà traitées ("enriched") sont sautées, sauf retry=true.
            no_contact = ~exists(select(Contact.id).where(Contact.company_id == Company.id))
            rows = db.execute(select(Company).where(no_contact).order_by(Company.id.desc())).scalars().all()
            retry = bool(p.get("retry"))

            def eligible(c: Company) -> bool:
                ex = c.extra or {}
                if ex.get("enriched") and not retry:
                    return False
                return bool(c.domain) or (settings.SITE_FINDER_ENABLED and (retry or not ex.get("site_search")))

            companies = [c for c in rows if eligible(c)][: p["limit"]]
        stats: Counter = Counter()
        bl = load_blacklist(db)
        new_ids = enrich_companies(db, companies, p["crawl_websites"], p["discover_emails"],
                                   p.get("use_smtp"), bl, stats)
        result = {"companies_processed": len(companies), **stats}
        if p["verify"] and new_ids:
            result["verification"] = verify_contacts(db, new_ids, use_smtp=p.get("use_smtp"))
        jobs.finish(db, job, result)
    except Exception as e:  # noqa: BLE001
        jobs.fail(db, job, repr(e))
    finally:
        db.close()