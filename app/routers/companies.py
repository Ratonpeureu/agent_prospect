from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Company
from app.schemas import CompanyIn, CompanyOut
from app.services.dedup import upsert_company
from app.services.normalize import ensure_url, extract_domain
from app.services.queries import companies_stmt

router = APIRouter(prefix="/api/companies", tags=["Entreprises"])


def _out(c: Company, n: int) -> CompanyOut:
    o = CompanyOut.model_validate(c)
    o.contacts_count = n
    return o


@router.get("", response_model=list[CompanyOut])
def list_companies(response: Response, q: str | None = None, country: str | None = None,
                   city: str | None = None, sector: str | None = None, source: str | None = None,
                   has_website: bool | None = None, has_contacts: bool | None = None,
                   limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    stmt, src = companies_stmt(q, country, city, sector, source, has_website, has_contacts)
    if src:
        rows = [r for r in db.execute(stmt).all() if src in (r[0].sources or [])]
        response.headers["X-Total-Count"] = str(len(rows))
        rows = rows[offset:offset + limit]
    else:
        total = db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar_one()
        response.headers["X-Total-Count"] = str(total)
        rows = db.execute(stmt.limit(limit).offset(offset)).all()
    return [_out(c, n) for c, n in rows]


@router.post("", response_model=CompanyOut, status_code=201)
def create_company(body: CompanyIn, db: Session = Depends(get_db)):
    """Crée l'entreprise ou la fusionne si elle existe déjà."""
    try:
        company, _ = upsert_company(db, body.model_dump(), "manual")
    except ValueError as e:
        raise HTTPException(422, str(e))
    db.commit()
    return _out(company, len(company.contacts))


@router.get("/{company_id}", response_model=CompanyOut)
def get_company(company_id: int, db: Session = Depends(get_db)):
    c = db.get(Company, company_id)
    if not c:
        raise HTTPException(404, "Entreprise introuvable")
    return _out(c, len(c.contacts))


@router.patch("/{company_id}", response_model=CompanyOut)
def patch_company(company_id: int, body: CompanyIn, db: Session = Depends(get_db)):
    c = db.get(Company, company_id)
    if not c:
        raise HTTPException(404, "Entreprise introuvable")
    for k, v in body.model_dump(exclude_unset=True).items():
        if k == "name" and not v:
            continue
        if k == "website":
            v = ensure_url(v)
            c.domain = extract_domain(v)
        setattr(c, k, v or None if k != "name" else v)
    db.commit()
    return _out(c, len(c.contacts))


@router.delete("/{company_id}", status_code=204)
def delete_company(company_id: int, db: Session = Depends(get_db)):
    c = db.get(Company, company_id)
    if not c:
        raise HTTPException(404, "Entreprise introuvable")
    db.delete(c)
    db.commit()


@router.post("/merge/{keep_id}/{remove_id}", response_model=CompanyOut)
def merge_companies(keep_id: int, remove_id: int, db: Session = Depends(get_db)):
    """Fusion manuelle de deux doublons : les contacts sont rattachés à keep_id."""
    keep, rem = db.get(Company, keep_id), db.get(Company, remove_id)
    if not keep or not rem or keep_id == remove_id:
        raise HTTPException(404, "Entreprises invalides")
    for f in ("website", "domain", "address", "city", "country", "phone", "sector", "legal_id"):
        if not getattr(keep, f) and getattr(rem, f):
            setattr(keep, f, getattr(rem, f))
    keep.sources = sorted(set((keep.sources or []) + (rem.sources or [])))
    for c in list(rem.contacts):
        c.company_id = keep.id
    db.flush()
    db.refresh(rem)
    db.delete(rem)
    db.commit()
    db.refresh(keep)
    return _out(keep, len(keep.contacts))