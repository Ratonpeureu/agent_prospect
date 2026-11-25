from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.exporter import companies_df, contacts_df, df_to_xlsx_bytes
from app.services.files import link_items, save_file
from app.services.queries import apply_company_sources, companies_stmt, contacts_stmt

router = APIRouter(prefix="/api/export", tags=["Exports"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _deliver(db: Session, df, name: str, fmt: str, category: str, entity_type: str,
             ids: list[int], filters: dict, record: bool) -> Response:
    if df.empty:
        raise HTTPException(404, "Aucune ligne à exporter avec ces filtres (tout est peut-être déjà exporté).")
    fmt = "csv" if fmt == "csv" else "xlsx"
    filename = f"{name}_{datetime.now():%Y%m%d_%H%M}.{fmt}"
    if fmt == "csv":
        data, media = df.to_csv(index=False).encode("utf-8-sig"), "text/csv"
    else:
        data, media = df_to_xlsx_bytes({name.capitalize(): df}), XLSX
    headers = {"Content-Disposition": f'attachment; filename="{filename}"',
               "X-Export-Count": str(len(df)), "X-Export-Id": ""}
    if record:
        rec = save_file(db, category, filename, data, fmt, len(df), filters)
        link_items(db, rec, entity_type, ids, "export")
        db.commit()
        headers["X-Export-Id"] = str(rec.id)
    return Response(data, media_type=media, headers=headers)


def _clean(d: dict) -> dict:
    return {k: v for k, v in d.items() if v not in (None, "", False)}


@router.get("/contacts")
def export_contacts(format: str = "xlsx", q: str | None = None, status: str | None = None,
                    country: str | None = None, city: str | None = None, sector: str | None = None,
                    source: str | None = None, exclude_source: str | None = None,
                    company_id: int | None = None, has_phone: bool | None = None,
                    has_website: bool | None = None, job_title: str | None = None,
                    domain: str | None = None, exported: str | None = None, file_id: int | None = None,
                    ids: str | None = None, limit: int | None = None, record: bool = True,
                    db: Session = Depends(get_db)):
    """Export filtré. exported=no : seulement les contacts jamais exportés. ids=1,2,3 : sélection précise.
    record=false : exporte sans marquer les lignes ni conserver le fichier."""
    id_list = [int(x) for x in ids.split(",") if x.strip().isdigit()] if ids else None
    stmt = contacts_stmt(q=q, status=status, country=country, city=city, sector=sector, source=source,
                         company_id=company_id, has_phone=has_phone, has_website=has_website,
                         job_title=job_title, domain=domain, exclude_source=exclude_source,
                         exported=exported, file_id=file_id, ids=id_list)
    if limit:
        stmt = stmt.limit(limit)
    pairs = db.execute(stmt).all()
    filters = _clean(dict(q=q, status=status, country=country, city=city, sector=sector, source=source,
                          exclude_source=exclude_source, job_title=job_title, domain=domain,
                          exported=exported, limit=limit, selection=len(id_list) if id_list else None))
    return _deliver(db, contacts_df(pairs), "prospects", format, "export_contacts", "contact",
                    [c.id for c, _ in pairs], filters, record)


@router.get("/companies")
def export_companies(format: str = "xlsx", q: str | None = None, country: str | None = None,
                     city: str | None = None, sector: str | None = None, source: str | None = None,
                     exclude_source: str | None = None, has_website: bool | None = None,
                     has_contacts: bool | None = None, exported: str | None = None,
                     file_id: int | None = None, limit: int | None = None, record: bool = True,
                     db: Session = Depends(get_db)):
    stmt, flt = companies_stmt(q, country, city, sector, source, has_website, has_contacts,
                               exclude_source, exported, file_id)
    rows = apply_company_sources(db.execute(stmt).all(), flt)
    if limit:
        rows = rows[:limit]
    filters = _clean(dict(q=q, country=country, city=city, sector=sector, source=source,
                          exclude_source=exclude_source, has_website=has_website, has_contacts=has_contacts,
                          exported=exported, limit=limit))
    return _deliver(db, companies_df(rows), "entreprises", format, "export_companies", "company",
                    [r[0].id for r in rows], filters, record)