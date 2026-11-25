from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import VerifyTextIn
from app.services import jobs
from app.services.file_import import build_workbook, process_rows, run_file_job
from app.services.normalize import EMAIL_RE

router = APIRouter(prefix="/api/verify", tags=["Vérification d'emails"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
MAX_TEXT = 500
MAX_FILE = 20 * 1024 * 1024


@router.post("/text")
def verify_text(body: VerifyTextIn, format: str = "json", include_risky: bool = False,
                db: Session = Depends(get_db)):
    """Colle une liste d'adresses (texte libre, une par ligne, séparées par virgules...).
    format=json (défaut) ou format=xlsx pour récupérer directement le fichier propre."""
    found = EMAIL_RE.findall((body.text or "") + " " + " ".join(body.emails))
    rows = [{"email": e.lower()} for e in found]
    if not rows:
        raise HTTPException(422, "Aucune adresse email détectée")
    if len(set(r["email"] for r in rows)) > MAX_TEXT:
        raise HTTPException(413, f"Maximum {MAX_TEXT} adresses en saisie directe : utilise /api/verify/file")
    done, excluded, summary = process_rows(db, rows, body.use_smtp, body.save_to_db)
    if format == "xlsx":
        data = build_workbook(done, excluded, summary, include_risky)
        return Response(data, media_type=XLSX,
                        headers={"Content-Disposition": 'attachment; filename="emails_verifies.xlsx"'})
    return {"summary": summary, "results": done + excluded}


@router.post("/file", status_code=202)
def verify_file(bg: BackgroundTasks, file: UploadFile = File(...), save_to_db: bool = Form(False),
                include_risky: bool = Form(False), use_smtp: bool | None = Form(None),
                db: Session = Depends(get_db)):
    """Upload CSV / TXT / XLSX : extrait les adresses + noms, dédoublonne, exclut la blacklist,
    vérifie, puis génère un Excel propre (GET /api/jobs/{id}/download)."""
    name = file.filename or "upload.csv"
    if not name.lower().endswith((".csv", ".txt", ".xlsx", ".xlsm")):
        raise HTTPException(415, "Formats acceptés : .csv, .txt, .xlsx")
    content = file.file.read()
    if len(content) > MAX_FILE:
        raise HTTPException(413, "Fichier trop volumineux (max 20 Mo)")
    job = jobs.create_job(db, "verify_file", {"filename": name, "save_to_db": save_to_db})
    bg.add_task(run_file_job, job.id, content, name, save_to_db, include_risky, use_smtp)
    return {"job_id": job.id, "status": job.status}