from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Contact
from app.services import jobs
from app.services.blacklist import add_entries
from app.services.email_verifier import verify_many


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


def run_verify_pending_job(job_id: int) -> None:
    db = SessionLocal()
    job = db.get(jobs.Job, job_id)
    try:
        jobs.start(db, job)
        p = job.params or {}
        res = verify_contacts(db, None, p.get("limit", 1000), p.get("use_smtp"))
        jobs.finish(db, job, res)
    except Exception as e:  # noqa: BLE001
        jobs.fail(db, job, repr(e))
    finally:
        db.close()




def run_verify_ids_job(job_id: int) -> None:
    db = SessionLocal()
    job = db.get(jobs.Job, job_id)
    try:
        jobs.start(db, job)
        p = job.params or {}
        ids = p.get("ids", [])
        res = verify_contacts(db, ids, limit=len(ids), use_smtp=p.get("use_smtp"))
        jobs.finish(db, job, res)
    except Exception as e:  # noqa: BLE001
        jobs.fail(db, job, repr(e))
    finally:
        db.close()




