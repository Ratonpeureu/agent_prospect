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
from app.services.email_verifier import probe_domain, verify_many
from app.services.providers import resolve
from app.services.providers.base import SearchParams
from app.services.sources.crawler import crawl_site
from app.services.verification import verify_contacts


def _smtp_enabled(use_smtp: bool | None) -> bool:
    return settings.SMTP_CHECK_ENABLED if use_smtp is None else use_smtp


def _discover(db: Session, company: Company, bl: BlacklistSets, stats: Counter) -> None:
    """Génère contact@, info@, prenom.nom@... et ne garde que les adresses confirmées par SMTP."""
    cands = discover_candidates(company.domain, (company.extra or {}).get("officers", []),
                                settings.DISCOVERY_MAX_ROLE)
    if not cands:
        return
    info = probe_domain(company.domain)
    # On ne peut confirmer une adresse que si le serveur rejette les adresses inexistantes (catch_all == False)
    if not info["has_mx"] or info["catch_all"] is not False:
        stats["discovery_domain_unverifiable"] += 1
        return
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


def enrich_companies(db: Session, companies: list[Company], crawl: bool, discover: bool,
                     use_smtp: bool | None, bl: BlacklistSets, stats: Counter) -> list[int]:
    """Cherche les emails/téléphones des entreprises. Retourne les ids des contacts à vérifier."""
    new_ids: list[int] = []
    crawled: dict[str, dict] = {}
    if crawl:
        sites = list({c.website for c in companies if c.website and c.domain})
        with ThreadPoolExecutor(max_workers=settings.CRAWL_WORKERS) as ex:
            for site, res in zip(sites, ex.map(crawl_site, sites)):
                crawled[site] = res

    smtp_ok = _smtp_enabled(use_smtp)
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
            if smtp_ok:
                _discover(db, c, bl, stats)
            else:
                stats["discovery_skipped_smtp_disabled"] += 1
    db.commit()
    return new_ids


def run_search_job(job_id: int) -> None:
    db = SessionLocal()
    job = db.get(Job, job_id)
    try:
        jobs.start(db, job)
        p = job.params
        country = to_iso(p.get("country")) if p.get("country") else None
        sp = SearchParams(query=p.get("query", ""), location=p.get("location", ""), country=country,
                          limit=p["limit"], filters=p.get("filters") or {})
        providers, skipped = resolve(p["sources"], country)

        def run(prov):
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
            for name, items, err in ex.map(run, providers):
                per_source[name] = len(items)
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

        result = {"sources_used": [x.name for x in providers], "sources_skipped": skipped,
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
            no_contact = ~exists(select(Contact.id).where(Contact.company_id == Company.id))
            companies = db.execute(select(Company).where(Company.domain.isnot(None), no_contact)
                                   .limit(p["limit"])).scalars().all()
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