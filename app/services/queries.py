from sqlalchemy import func, or_, select

from app.models import Company, Contact
from app.services.countries import to_iso


def _country_clause(country: str):
    iso = to_iso(country)
    if iso:
        return Company.country == iso
    return Company.country.ilike(f"%{country}%")


def contacts_stmt(q=None, status=None, country=None, city=None, sector=None, source=None,
                  company_id=None, has_phone=None, has_website=None, job_title=None, domain=None):
    stmt = select(Contact, Company).outerjoin(Company, Contact.company_id == Company.id)
    if status:
        stmt = stmt.where(Contact.email_status.in_([s.strip() for s in status.split(",")]))
    else:
        stmt = stmt.where(Contact.email_status != "blacklisted")
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Contact.email.ilike(like), Contact.full_name.ilike(like), Company.name.ilike(like)))
    if country:
        stmt = stmt.where(_country_clause(country))
    if city:
        stmt = stmt.where(Company.city.ilike(f"%{city}%"))
    if sector:
        stmt = stmt.where(Company.sector.ilike(f"%{sector}%"))
    if source:
        stmt = stmt.where(Contact.source == source)
    if company_id:
        stmt = stmt.where(Contact.company_id == company_id)
    if job_title:
        stmt = stmt.where(Contact.job_title.ilike(f"%{job_title}%"))
    if domain:
        stmt = stmt.where(Contact.email.ilike(f"%@{domain}"))
    if has_phone:
        stmt = stmt.where(or_(Contact.phone.isnot(None), Company.phone.isnot(None)))
    if has_website:
        stmt = stmt.where(Company.website.isnot(None))
    return stmt.order_by(Contact.id.desc())


def companies_stmt(q=None, country=None, city=None, sector=None, source=None,
                   has_website=None, has_contacts=None):
    n = func.count(Contact.id)
    stmt = select(Company, n).outerjoin(Contact, Contact.company_id == Company.id).group_by(Company.id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Company.name.ilike(like), Company.domain.ilike(like), Company.legal_id.ilike(like)))
    if country:
        stmt = stmt.where(_country_clause(country))
    if city:
        stmt = stmt.where(Company.city.ilike(f"%{city}%"))
    if sector:
        stmt = stmt.where(Company.sector.ilike(f"%{sector}%"))
    if has_website:
        stmt = stmt.where(Company.website.isnot(None))
    if has_contacts is True:
        stmt = stmt.having(n > 0)
    elif has_contacts is False:
        stmt = stmt.having(n == 0)
    stmt = stmt.order_by(Company.id.desc())
    return stmt, (source or None)  # filtre 'source' (colonne JSON) appliqué en Python par les routeurs