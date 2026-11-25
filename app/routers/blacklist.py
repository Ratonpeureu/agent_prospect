from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BlacklistEntry
from app.schemas import BlacklistIn, BlacklistOut
from app.services.blacklist import add_entries, remove_entry

router = APIRouter(prefix="/api/blacklist", tags=["Blacklist"])


@router.get("", response_model=list[BlacklistOut])
def list_blacklist(kind: str | None = None, q: str | None = None, limit: int = 100,
                   offset: int = 0, db: Session = Depends(get_db)):
    stmt = select(BlacklistEntry).order_by(BlacklistEntry.id.desc())
    if kind:
        stmt = stmt.where(BlacklistEntry.kind == kind)
    if q:
        stmt = stmt.where(BlacklistEntry.value.ilike(f"%{q}%"))
    return db.execute(stmt.limit(limit).offset(offset)).scalars().all()


@router.post("", status_code=201)
def add_blacklist(body: BlacklistIn, db: Session = Depends(get_db)):
    """Ajoute des emails ou domaines. Les contacts existants passent en statut 'blacklisted'."""
    added = add_entries(db, body.kind, body.values, body.reason)
    return {"added": added, "ignored_duplicates": len(body.values) - added}


@router.delete("/{entry_id}", status_code=204)
def delete_blacklist(entry_id: int, db: Session = Depends(get_db)):
    e = db.get(BlacklistEntry, entry_id)
    if not e:
        raise HTTPException(404, "Entrée introuvable")
    remove_entry(db, e)