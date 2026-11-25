from datetime import datetime

from sqlalchemy.orm import Session

from app.models import Job


def create_job(db: Session, kind: str, params: dict | None = None) -> Job:
    job = Job(kind=kind, params=params or {}, status="queued")
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def start(db: Session, job: Job) -> None:
    job.status = "running"
    db.commit()


def finish(db: Session, job: Job, result: dict, file_path: str | None = None) -> None:
    job.status = "done"
    job.result = result
    job.file_path = file_path
    job.finished_at = datetime.utcnow()
    db.commit()


def fail(db: Session, job: Job, error: str) -> None:
    db.rollback()
    job.status = "error"
    job.error = error[:2000]
    job.finished_at = datetime.utcnow()
    db.commit()