import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Job
from app.schemas import SearchRequest
from app.services import jobs
from app.services.presets import PRESETS
from app.services.providers import all_providers
from app.services.prospecting import run_search_job

router = APIRouter(prefix="/api", tags=["Recherche & jobs"])


def _job(j: Job) -> dict:
    return {"id": j.id, "kind": j.kind, "status": j.status, "params": j.params, "result": j.result,
            "error": j.error, "has_file": bool(j.file_path), "created_at": j.created_at,
            "finished_at": j.finished_at}


@router.get("/sources")
def list_sources():
    """Sources disponibles : pays couverts, clé requise ou non, filtres dynamiques acceptés."""
    return [p.info() for p in all_providers().values()]


@router.get("/presets")
def list_presets():
    """Secteurs prédéfinis (traduits automatiquement en tags OSM, codes NAF, codes SIC)."""
    return [{"id": k, "label": v["label"], "aliases": v["aliases"], "osm": v["osm"],
             "naf": v["naf"], "sic": v["sic"]} for k, v in PRESETS.items()]


@router.post("/search", status_code=202)
def start_search(req: SearchRequest, bg: BackgroundTasks, db: Session = Depends(get_db)):
    """Lance une recherche multi-sources (tâche de fond). Suivi : GET /api/jobs/{id}."""
    known = set(all_providers())
    bad = [s for s in req.sources if s != "auto" and s not in known]
    if bad:
        raise HTTPException(422, f"Sources inconnues : {bad}. Disponibles : {sorted(known)}")
    job = jobs.create_job(db, "search", req.model_dump())
    bg.add_task(run_search_job, job.id)
    return {"job_id": job.id, "status": job.status}


@router.get("/jobs")
def list_jobs(limit: int = 30, db: Session = Depends(get_db)):
    rows = db.execute(select(Job).order_by(Job.id.desc()).limit(limit)).scalars().all()
    return [_job(j) for j in rows]


@router.get("/jobs/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_db)):
    j = db.get(Job, job_id)
    if not j:
        raise HTTPException(404, "Job introuvable")
    return _job(j)


@router.get("/jobs/{job_id}/download")
def download_job_file(job_id: int, db: Session = Depends(get_db)):
    j = db.get(Job, job_id)
    if not j or not j.file_path or not os.path.exists(j.file_path):
        raise HTTPException(404, "Aucun fichier pour ce job (pas terminé ?)")
    return FileResponse(j.file_path, filename=os.path.basename(j.file_path),
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")