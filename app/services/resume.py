"""Reprise des tâches interrompues (redémarrage, rebuild, crash)."""
import threading
import time

from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models import Job
from app.services import applog, jobs

log = applog.get("resume")


def _runner(kind: str):
    from app.services.file_import import run_file_job_resume
    from app.services.prospecting import run_enrich_job, run_search_job
    from app.services.verification import run_verify_ids_job, run_verify_pending_job
    return {"search": run_search_job, "enrich": run_enrich_job, "verify_pending": run_verify_pending_job,
            "verify_ids": run_verify_ids_job, "verify_file": run_file_job_resume}.get(kind)


def resume_job(job_id: int, manual: bool = False) -> None:
    """Relance une tâche à partir de son dernier checkpoint (job.progress)."""
    db = SessionLocal()
    try:
        job = db.get(Job, job_id)
        if not job:
            return
        fn = _runner(job.kind)
        if fn is None:
            jobs.fail(db, job, f"Type de tâche non reprenable : {job.kind}")
            return
        if job_id in jobs.RUNNING:
            return
        if manual:
            job.attempts = 0
        elif (job.attempts or 0) >= settings.JOB_MAX_ATTEMPTS:
            jobs.fail(db, job, f"Abandonnée après {job.attempts} tentatives (le process s'est arrêté à chaque "
                               f"fois : voir le Journal). Utilise « Reprendre » pour réessayer.")
            return
        job.status, job.error, job.finished_at = "queued", None, None
        db.commit()
        pr = job.progress or {}
        log.warning("EVENT job.resume job=%s kind=%s manual=%s phase=%s percent=%s attempts=%s", job_id, job.kind,
                    manual, pr.get("phase"), pr.get("percent"), job.attempts)
    finally:
        db.close()
    fn(job_id)


def _resume_all() -> None:
    time.sleep(5)  # laisse l'API finir de démarrer
    db = SessionLocal()
    try:
        ids = list(db.execute(select(Job.id).where(Job.status.in_(("running", "queued"))).order_by(Job.id)).scalars())
    finally:
        db.close()
    if not ids:
        return
    log.warning("EVENT resume.found jobs=%s (interrompues par un redémarrage)", ids)
    for jid in ids:
        threading.Thread(target=_safe_resume, args=(jid,), name=f"resume-{jid}", daemon=True).start()
        time.sleep(3)  # démarrage échelonné


def _safe_resume(jid: int) -> None:
    try:
        resume_job(jid)
    except Exception:  # noqa: BLE001
        log.exception("Reprise du job %s impossible", jid)


def start_resume_thread() -> None:
    threading.Thread(target=_resume_all, name="resumer", daemon=True).start()