from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Company
from app.schemas import CompanyIn, CompanyOut
from app.services.dedup import upsert_company
from app.services.normalize import ensure_url, extract_domain
from app.services.queries import apply_company_sources, companies_stmt
from app.services.files import export_info
from fastapi import BackgroundTasks, File, Form, UploadFile
from pydantic import BaseModel
import httpx
from app.services import jobs
from app.services.company_import import fetch_url, import_rows, parse_bytes
from app.services.prospecting import run_enrich_job




router = APIRouter(prefix="/api/companies", tags=["Entreprises"])




class ImportUrlIn(BaseModel):
    url: str
    source: str = "import"
    country: str = ""
    enrich: bool = False



def _out(c: Company, n: int, ex: tuple | None = None) -> CompanyOut:
    o = CompanyOut.model_validate(c)
    o.contacts_count = n
    if ex:
        o.exports_count, o.last_exported_at = ex
    return o


@router.get("", response_model=list[CompanyOut])
def list_companies(response: Response, q: str | None = None, country: str | None = None,
                   city: str | None = None, sector: str | None = None, source: str | None = None,
                   exclude_source: str | None = None, has_website: bool | None = None,
                   has_contacts: bool | None = None, exported: str | None = None,
                   file_id: int | None = None, limit: int = 50, offset: int = 0,
                   db: Session = Depends(get_db)):
    stmt, flt = companies_stmt(q, country, city, sector, source, has_website, has_contacts,
                               exclude_source, exported, file_id)
    if flt:
        rows = apply_company_sources(db.execute(stmt).all(), flt)
        response.headers["X-Total-Count"] = str(len(rows))
        rows = rows[offset:offset + limit]
    else:
        total = db.execute(select(func.count()).select_from(stmt.order_by(None).subquery())).scalar_one()
        response.headers["X-Total-Count"] = str(total)
        rows = db.execute(stmt.limit(limit).offset(offset)).all()
    info = export_info(db, "company", [r[0].id for r in rows])
    return [_out(c, n, info.get(c.id)) for c, n in rows]


@router.post("", response_model=CompanyOut, status_code=201)
def create_company(body: CompanyIn, db: Session = Depends(get_db)):
    """Crée l'entreprise ou la fusionne si elle existe déjà."""
    try:
        company, _ = upsert_company(db, body.model_dump(), "manual")
    except ValueError as e:
        raise HTTPException(422, str(e))
    db.commit()
    return _out(company, len(company.contacts))




def _finish(db: Session, bg: BackgroundTasks, rows: list[dict], source: str, country: str, enrich: bool) -> dict:
    if not rows:
        raise HTTPException(422, "Aucune entreprise détectée : il faut au moins une colonne de nom (nom, entreprise, exposant...)")
    res = import_rows(db, rows, source.strip() or "import", country.strip())
    ids = res.pop("company_ids")
    if enrich and ids:
        job = jobs.create_job(db, "enrich", {"company_ids": ids, "limit": len(ids), "crawl_websites": True,
                                              "discover_emails": True, "verify": True, "use_smtp": None})
        bg.add_task(run_enrich_job, job.id)
        res["job_id"] = job.id
    return res


@router.get("/sources")
def company_sources(db: Session = Depends(get_db)):
    """Toutes les sources présentes en base (pour les filtres)."""
    return sorted({s for (srcs,) in db.execute(select(Company.sources)) for s in (srcs or [])})


@router.post("/import", status_code=201)
def import_file(bg: BackgroundTasks, file: UploadFile = File(...), source: str = Form("import"),
                country: str = Form(""), enrich: bool = Form(False), db: Session = Depends(get_db)):
    """Liste d'entreprises en CSV / Excel / PDF / HTML (exposants, annuaires, attributaires...)."""
    content = file.file.read()
    if len(content) > 30 * 1024 * 1024:
        raise HTTPException(413, "Fichier trop volumineux (max 30 Mo)")
    try:
        rows = parse_bytes(content, file.filename or "", file.content_type or "")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(422, f"Fichier illisible : {type(e).__name__}")
    return _finish(db, bg, rows, source, country, enrich)


@router.post("/import-url", status_code=201)
def import_from_url(body: ImportUrlIn, bg: BackgroundTasks, db: Session = Depends(get_db)):
    """Même chose depuis une URL : page web avec tableau, PDF, CSV ou Excel en ligne."""
    try:
        rows = fetch_url(body.url)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Téléchargement impossible : {type(e).__name__}")
    return _finish(db, bg, rows, body.source, body.country, body.enrich)


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