from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.exporter import companies_df, contacts_df, df_to_xlsx_bytes
from app.services.queries import companies_stmt, contacts_stmt

router = APIRouter(prefix="/api/export", tags=["Exports"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _send(df, name: str, fmt: str) -> Response:
    stamp = datetime.now().strftime("%Y%m%d_%H%M")
    if fmt == "csv":
        return Response(df.to_csv(index=False).encode("utf-8-sig"), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{name}_{stamp}.csv"'})
    return Response(df_to_xlsx_bytes({name.capitalize(): df}), media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="{name}_{stamp}.xlsx"'})


@router.get("/contacts")
def export_contacts(format: str = "xlsx", q: str | None = None, status: str | None = None,
                    country: str | None = None, city: str | None = None, sector: str | None = None,
                    source: str | None = None, company_id: int | None = None,
                    has_phone: bool | None = None, has_website: bool | None = None,
                    job_title: str | None = None, domain: str | None = None,
                    db: Session = Depends(get_db)):
    """Export filtré. Exemple prospects propres : ?status=valid&country=Senegal&sector=restaurant"""
    stmt = contacts_stmt(q, status, country, city, sector, source, company_id,
                         has_phone, has_website, job_title, domain)
    return _send(contacts_df(db.execute(stmt).all()), "prospects", format)


@router.get("/companies")
def export_companies(format: str = "xlsx", q: str | None = None, country: str | None = None,
                     city: str | None = None, sector: str | None = None, source: str | None = None,
                     has_website: bool | None = None, has_contacts: bool | None = None,
                     db: Session = Depends(get_db)):
    stmt, src = companies_stmt(q, country, city, sector, source, has_website, has_contacts)
    rows = db.execute(stmt).all()
    if src:
        rows = [r for r in rows if src in (r[0].sources or [])]
    return _send(companies_df(rows), "entreprises", format)