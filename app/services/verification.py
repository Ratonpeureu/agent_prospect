import time
from collections import Counter
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models import Contact, Job
from app.services import applog, jobs
from app.services.blacklist import add_entries
from app.services.email_verifier import verify_many

VERIFY_KEYS = ("verified", "valid", "risky", "unknown", "invalid", "auto_blacklisted")


def verify_contacts(db: Session, contact_ids: list[int] | None = None, limit: int = 1000,
                    use_smtp: bool | None = None, statuses: tuple = ("unverified", "unknown")) -> dict:
    stmt = select(Contact).where(Contact.email_status.in_(statuses))
    if contact_ids is not None:
        stmt = select(Contact).where(Contact.id.in_(contact_ids))
    contacts = db.execute(stmt.limit(limit)).scalars().all()

    results = verify_many([c.email for c in contacts], use_smtp)
    counts = {"valid": 0, "risky": 0, "unknown": 0, "invalid": 0}
    rejected = []
    for c in contacts:
        r = results[c.email.lower()]
        c.email_status, c.email_reason = r["status"], r["reason"]
        c.email_score, c.is_role = r["score"], r["is_role"]
        c.verified_at = datetime.utcnow()
        counts[r["status"]] += 1
        if r["status"] == "invalid":
            rejected.append(c.email)
    db.commit()
    # Les adresses rejetées vont automatiquement en blacklist (pas de re-prospection)
    if rejected:
        add_entries(db, "email", rejected, "auto:invalid", update_contacts=False)
    return {"verified": len(contacts), **counts, "auto_blacklisted": len(rejected)}


def verify_batches(db: Session, job: Job, prog: dict, ids: list[int], use_smtp: bool | None = None,
                   timings: applog.Timings | None = None, pct_from: int = 0, pct_to: int = 100,
                   statuses: tuple | None = None, batch: int = 100) -> dict:
    """Vérifie par lots de 100 avec checkpoint : après un arrêt, repart au dernier lot terminé.
    statuses=None : tout sauf blacklistés. Sinon : uniquement ces statuts."""
    jl = applog.jlog("verification", job.id)
    counts = Counter(prog.get("verif_counts") or {})
    total = len(ids)
    for i in range(int(prog.get("verified_upto") or 0), total, batch):
        chunk = ids[i:i + batch]
        cond = Contact.email_status.in_(statuses) if statuses else Contact.email_status != "blacklisted"
        todo = list(db.execute(select(Contact.id).where(Contact.id.in_(chunk), cond)).scalars())
        if todo:
            jobs.beat(job.id, f"vérification {i + len(chunk)}/{total}")
            with applog.timed(jl, "verify", f"{len(todo)} emails", timings, warn_after=settings.SLOW_BATCH_S):
                r = verify_contacts(db, todo, limit=len(todo), use_smtp=use_smtp)
            for k in VERIFY_KEYS:
                counts[k] += r.get(k, 0)
        done = min(i + batch, total)
        prog.update(phase="verify", verified_upto=done, verif_counts=dict(counts),
                    message=f"Vérification {done}/{total}",
                    percent=int(pct_from + (pct_to - pct_from) * done / max(1, total)))
        if timings is not None:
            prog["timings"] = timings.summary()
        jobs.checkpoint(db, job, prog)
    return {k: counts.get(k, 0) for k in VERIFY_KEYS}


@jobs.tracked("verify_pending")
def run_verify_pending_job(job_id: int) -> None:
    db = SessionLocal()
    job = db.get(Job, job_id)
    timings, t0 = applog.Timings(), time.time()
    try:
        jobs.start(db, job)
        p = job.params or {}
        prog = dict(job.progress or {})
        timings.load(prog.get("timings"))
        if "ids" not in prog:
            prog["ids"] = list(db.execute(
                select(Contact.id).where(Contact.email_status.in_(("unverified", "unknown")))
                .order_by(Contact.id).limit(p.get("limit", 1000))).scalars())
            prog.update(phase="verify", message=f"{len(prog['ids'])} contacts à vérifier", percent=0)
            jobs.checkpoint(db, job, prog)
        res = verify_batches(db, job, prog, prog["ids"], p.get("use_smtp"), timings,
                             statuses=("unverified", "unknown"))
        res.update(duration_s=round(time.time() - t0), timings=timings.summary())
        jobs.finish(db, job, res)
    except Exception as e:  # noqa: BLE001
        applog.jlog("verification", job_id).exception("Tâche verify_pending plantée")
        jobs.fail(db, job, repr(e))
    finally:
        db.close()


@jobs.tracked("verify_ids")
def run_verify_ids_job(job_id: int) -> None:
    db = SessionLocal()
    job = db.get(Job, job_id)
    timings, t0 = applog.Timings(), time.time()
    try:
        jobs.start(db, job)
        p = job.params or {}
        prog = dict(job.progress or {})
        timings.load(prog.get("timings"))
        res = verify_batches(db, job, prog, p.get("ids", []), p.get("use_smtp"), timings)
        res.update(duration_s=round(time.time() - t0), timings=timings.summary())
        jobs.finish(db, job, res)
    except Exception as e:  # noqa: BLE001
        applog.jlog("verification", job_id).exception("Tâche verify_ids plantée")
        jobs.fail(db, job, repr(e))
    finally:
        db.close()