from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Company, Contact
from app.schemas import ContactIn, ContactOut, ContactPatch
from app.services import jobs
from app.services.blacklist import load_blacklist
from app.services.dedup import upsert_contact
from app.services.queries import contacts_stmt
from app.services.verification import run_verify_pending_job, verify_contacts

router = APIRouter(prefix="/api/contacts", tags=["Contacts"])


class BatchIn(BaseModel):
    ids: list[int]
    use_smtp: bool | None = None


def out(c: Contact, co: Company | None) -> ContactOut:
    return ContactOut(
        id=c.id, email=c.email, first_name=c.first_name, last_name=c.last_name, full_name=c.full_name,
        job_title=c.job_title, phone=c.phone, company_id=c.company_id, company_name=co.name if co else None,
        source=c.source, email_status=c.email_status, email_reason=c.email_reason,
        email_score=c.email_score, is_role=c.is_role, verified_at=c.verified_at, created_at=c.created_at)


@router.get("", response_model=list[ContactOut])
def list_contacts(response: Response, q: str | None = None, status: str | None = None,
                  country: str | None = None, city: str | None = None, sector: str | None = None,
                  source: str | None = None, company_id: int | None = None, has_phone: bool | None = None,
                  has_website: bool | None = None, job_title: str | None = None, domain: str | None = None,
                  limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    stmt = contacts_stmt(q, status, country, city, sector, source, company_id,
                         has_phone, has_website, job_title, domain)
    total = db.execute(stmt.with_only_columns(func.count(Contact.id), maintain_column_froms=True)
                       .order_by(None)).scalar_one()
    response.headers["X-Total-Count"] = str(total)
    return [out(c, co) for c, co in db.execute(stmt.limit(limit).offset(offset)).all()]


@router.post("", response_model=ContactOut, status_code=201)
def create_contact(body: ContactIn, db: Session = Depends(get_db)):
    bl = load_blacklist(db)
    data = body.model_dump(exclude={"verify"})
    data["source"] = "manual"
    c, st = upsert_contact(db, data, bl)
    if st == "invalid_syntax":
        raise HTTPException(422, "Syntaxe d'email invalide")
    if st == "blacklisted":
        raise HTTPException(409, "Adresse ou domaine en blacklist")
    db.commit()
    if body.verify:
        verify_contacts(db, [c.id])
        db.refresh(c)
    return out(c, c.company)


@router.post("/verify-pending", status_code=202)
def verify_pending(bg: BackgroundTasks, limit: int = 1000, use_smtp: bool | None = None,
                   db: Session = Depends(get_db)):
    """Vérifie en tâche de fond tous les contacts 'unverified'/'unknown'."""
    job = jobs.create_job(db, "verify_pending", {"limit": limit, "use_smtp": use_smtp})
    bg.add_task(run_verify_pending_job, job.id)
    return {"job_id": job.id, "status": job.status}


@router.post("/verify-batch")
def verify_batch(body: BatchIn, db: Session = Depends(get_db)):
    ids = db.execute(select(Contact.id).where(Contact.id.in_(body.ids), Contact.email_status != "blacklisted")
                     ).scalars().all()
    if not ids:
        return {"verified": 0}
    return verify_contacts(db, list(ids), limit=len(ids), use_smtp=body.use_smtp)


@router.post("/delete-batch")
def delete_batch(body: BatchIn, db: Session = Depends(get_db)):
    res = db.execute(delete(Contact).where(Contact.id.in_(body.ids)))
    db.commit()
    return {"deleted": res.rowcount}


@router.patch("/{contact_id}", response_model=ContactOut)
def patch_contact(contact_id: int, body: ContactPatch, db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if not c:
        raise HTTPException(404, "Contact introuvable")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    c.full_name = " ".join(p for p in (c.first_name, c.last_name) if p) or c.full_name
    db.commit()
    return out(c, c.company)


@router.delete("/{contact_id}", status_code=204)
def delete_contact(contact_id: int, db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if not c:
        raise HTTPException(404, "Contact introuvable")
    db.delete(c)
    db.commit()


@router.post("/{contact_id}/verify", response_model=ContactOut)
def verify_one(contact_id: int, use_smtp: bool | None = None, db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if not c:
        raise HTTPException(404, "Contact introuvable")
    if c.email_status == "blacklisted":
        raise HTTPException(409, "Contact blacklisté : retire-le de la blacklist avant de le vérifier")
    verify_contacts(db, [c.id], use_smtp=use_smtp)
    db.refresh(c)
    return out(c, c.company)