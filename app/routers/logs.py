import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.services import applog

router = APIRouter(prefix="/api/logs", tags=["Journal"])


@router.get("")
def read_logs(level: str = "INFO", job_id: int | None = None, q: str | None = None,
              slow: bool = False, limit: int = 300):
    """Fin du journal, du plus récent au plus ancien. slow=true : lenteurs, blocages et saturation uniquement."""
    entries, size = applog.read_entries(level, job_id, q, slow, max(1, min(limit, 1000)))
    return {"entries": entries, "file_size": size, "path": applog.log_path()}


@router.get("/download")
def download_logs():
    path = applog.log_path()
    if not os.path.exists(path):
        raise HTTPException(404, "Aucun journal")
    return FileResponse(path, filename="app.log", media_type="text/plain")