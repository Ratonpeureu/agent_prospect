import csv
import os
from datetime import datetime
from itertools import islice

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Contact, FileRecord
from app.services.file_import import parse_rows
from app.services.files import fmt_of, link_items, remove_file, save_file

router = APIRouter(prefix="/api/files", tags=["Fichiers"])
MEDIA = {"xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
         "csv": "text/csv", "txt": "text/plain"}
MAX_UPLOAD = 50 * 1024 * 1024


def _out(f: FileRecord) -> dict:
    return {"id": f.id, "category": f.category, "format": f.format, "filename": f.filename,
            "size": f.size, "row_count": f.row_count, "filters": f.filters or {}, "note": f.note,
            "job_id": f.job_id, "created_at": f.created_at,
            "exists": bool(f.path and os.path.exists(f.path))}


def _get(db: Session, file_id: int) -> FileRecord:
    f = db.get(FileRecord, file_id)
    if not f:
        raise HTTPException(404, "Fichier introuvable")
    return f


def _cell(v):
    if v is None:
        return ""
    if isinstance(v, (int, float, bool)):
        return v
    if isinstance(v, datetime):
        return v.isoformat(sep=" ", timespec="minutes")
    return str(v)


@router.get("")
def list_files(response: Response, category: str | None = None, q: str | None = None,
               format: str | None = None, limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    stmt = select(FileRecord).order_by(FileRecord.id.desc())
    if category:
        stmt = stmt.where(FileRecord.category.in_([c.strip() for c in category.split(",") if c.strip()]))
    if format:
        stmt = stmt.where(FileRecord.format == format)
    if q:
        stmt = stmt.where(FileRecord.filename.ilike(f"%{q}%"))
    from sqlalchemy import func
    total = db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar_one()
    response.headers["X-Total-Count"] = str(total)
    return [_out(f) for f in db.execute(stmt.limit(limit).offset(offset)).scalars()]


@router.get("/{file_id}")
def get_file(file_id: int, db: Session = Depends(get_db)):
    return _out(_get(db, file_id))


@router.get("/{file_id}/download")
def download(file_id: int, db: Session = Depends(get_db)):
    f = _get(db, file_id)
    if not f.path or not os.path.exists(f.path):
        raise HTTPException(404, "Le fichier n'existe plus sur le disque")
    return FileResponse(f.path, filename=f.filename, media_type=MEDIA.get(f.format, "application/octet-stream"))


@router.get("/{file_id}/preview")
def preview(file_id: int, sheet: str | None = None, limit: int = 100, offset: int = 0,
            db: Session = Depends(get_db)):
    """Contenu paginé d'un fichier (toutes les feuilles pour un Excel)."""
    f = _get(db, file_id)
    if not f.path or not os.path.exists(f.path):
        raise HTTPException(404, "Le fichier n'existe plus sur le disque")
    limit = max(1, min(limit, 500))
    offset = max(0, offset)

    if f.format == "xlsx":
        try:
            wb = load_workbook(f.path, read_only=True, data_only=True)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(422, f"Fichier Excel illisible : {type(e).__name__}")
        try:
            sheets = [{"name": ws.title, "rows": max(0, (ws.max_row or 1) - 1)} for ws in wb.worksheets]
            if not sheets:
                return {"sheets": [], "sheet": "", "columns": [], "rows": [], "total": 0}
            names = [s["name"] for s in sheets]
            name = sheet if sheet in names else names[0]
            it = wb[name].iter_rows(values_only=True)
            columns = ["" if h is None else str(h) for h in next(it, ())]
            rows = [[_cell(c) for c in r] for r in islice(it, offset, offset + limit)]
            total = next(s["rows"] for s in sheets if s["name"] == name)
            return {"sheets": sheets, "sheet": name, "columns": columns, "rows": rows, "total": total}
        finally:
            wb.close()

    with open(f.path, encoding="utf-8-sig", errors="replace", newline="") as fh:
        if f.format == "txt":
            lines = [ln.strip() for ln in fh if ln.strip()]
            return {"sheets": [], "sheet": "", "columns": ["Contenu"],
                    "rows": [[ln] for ln in lines[offset:offset + limit]], "total": len(lines)}
        sample = fh.read(4096)
        fh.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        except csv.Error:
            dialect = csv.excel
        reader = csv.reader(fh, dialect)
        columns = next(reader, [])
        rows, total = [], 0
        for i, r in enumerate(reader):
            total += 1
            if offset <= i < offset + limit:
                rows.append(r)
    return {"sheets": [], "sheet": "", "columns": columns, "rows": rows, "total": total}


@router.post("/register-export", status_code=201)
def register_export(file: UploadFile = File(...), note: str = Form(""), db: Session = Depends(get_db)):
    """Enregistre un ANCIEN export (CSV / Excel / TXT) : les contacts dont l'email figure dans le fichier
    sont marqués « déjà exportés ». Sert à éviter les doublons avec ce que tu as déjà envoyé."""
    name = file.filename or "ancien_export.csv"
    if not name.lower().endswith((".csv", ".txt", ".xlsx", ".xlsm")):
        raise HTTPException(415, "Formats acceptés : .csv, .txt, .xlsx")
    content = file.file.read()
    if len(content) > MAX_UPLOAD:
        raise HTTPException(413, "Fichier trop volumineux (max 50 Mo)")
    emails = list({r["email"] for r in parse_rows(content, name)})
    if not emails:
        raise HTTPException(422, "Aucune adresse email détectée dans ce fichier")
    ids: list[int] = []
    for i in range(0, len(emails), 1000):
        ids += db.execute(select(Contact.id).where(Contact.email.in_(emails[i:i + 1000]))).scalars().all()
    rec = save_file(db, "export_contacts", name, content, fmt_of(name), len(emails),
                    note=note.strip() or "Ancien export enregistré")
    link_items(db, rec, "contact", ids, "export")
    db.commit()
    return {"file_id": rec.id, "emails_in_file": len(emails), "matched": len(ids),
            "unknown": len(emails) - len(ids)}


@router.delete("/{file_id}", status_code=204)
def delete_file(file_id: int, db: Session = Depends(get_db)):
    """Supprime le fichier ET les marques « exporté » qui lui sont liées."""
    remove_file(db, _get(db, file_id))