from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.services import jobs
from app.services.prospecting import run_enrich_job

router = APIRouter(prefix="/api/enrich", tags=["Enrichissement"])


class EnrichIn(BaseModel):
    company_ids: list[int] | None = Field(None, description="Vide = toutes les entreprises avec domaine mais sans contact")
    limit: int = Field(200, ge=1, le=2000)
    crawl_websites: bool = True
    discover_emails: bool = True
    verify: bool = True
    use_smtp: bool | None = None


@router.post("", status_code=202)
def start_enrich(body: EnrichIn, bg: BackgroundTasks, db: Session = Depends(get_db)):
    """Cherche emails/téléphones des entreprises déjà en base (ex. venant des registres : renseigne d'abord
    le site via PATCH /api/companies/{id} {"website": "..."} puis lance l'enrichissement)."""
    job = jobs.create_job(db, "enrich", body.model_dump())
    bg.add_task(run_enrich_job, job.id)
    return {"job_id": job.id, "status": job.status}