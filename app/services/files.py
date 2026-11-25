import os
import re
import uuid
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import FileItem, FileRecord


def _safe(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name or "")[:80] or "fichier"


def fmt_of(filename: str) -> str:
    ext = os.path.splitext((filename or "").lower())[1].lstrip(".")
    if ext == "xlsm":
        return "xlsx"
    return ext if ext in ("xlsx", "csv", "txt") else "txt"


def save_file(db: Session, category: str, filename: str, data: bytes, fmt: str, row_count: int = 0,
              filters: dict | None = None, job_id: int | None = None, note: str | None = None) -> FileRecord:
    """Écrit le fichier dans DATA_DIR (volume persistant) et crée sa fiche. L'appelant fait le commit."""
    folder = os.path.join(settings.DATA_DIR, "imports" if category == "import" else "exports")
    os.makedirs(folder, exist_ok=True)
    stored = f"{datetime.utcnow():%Y%m%d%H%M%S}_{uuid.uuid4().hex[:6]}_{_safe(filename)}"
    path = os.path.join(folder, stored)
    with open(path, "wb") as fh:
        fh.write(data)
    rec = FileRecord(category=category, format=fmt, filename=filename, path=path, size=len(data),
                     row_count=row_count, filters=filters or {}, note=note, job_id=job_id)
    db.add(rec)
    db.flush()
    return rec


def link_items(db: Session, rec: FileRecord, entity_type: str, ids: list[int], role: str) -> None:
    ids = list(dict.fromkeys(ids))
    for i in range(0, len(ids), 5000):
        db.bulk_insert_mappings(FileItem, [
            {"file_id": rec.id, "entity_type": entity_type, "entity_id": x, "role": role}
            for x in ids[i:i + 5000]])


def export_info(db: Session, entity_type: str, ids: list[int]) -> dict[int, tuple[int, datetime]]:
    """{id: (nombre d'exports, date du dernier export)} pour une page de résultats."""
    if not ids:
        return {}
    rows = db.execute(
        select(FileItem.entity_id, func.count(), func.max(FileRecord.created_at))
        .join(FileRecord, FileRecord.id == FileItem.file_id)
        .where(FileItem.entity_type == entity_type, FileItem.role == "export", FileItem.entity_id.in_(ids))
        .group_by(FileItem.entity_id)).all()
    return {i: (n, d) for i, n, d in rows}


def remove_file(db: Session, rec: FileRecord) -> None:
    db.execute(delete(FileItem).where(FileItem.file_id == rec.id))
    if rec.path and os.path.exists(rec.path):
        try:
            os.remove(rec.path)
        except OSError:
            pass
    db.delete(rec)
    db.commit()