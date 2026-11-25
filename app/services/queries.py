from sqlalchemy import exists, func, or_, select

from app.models import Company, Contact, FileItem
from app.services.countries import to_iso


def split_csv(value) -> list[str]:
    """'osm,wikidata' -> ['osm', 'wikidata'] (accepte aussi une liste)."""
    if not value:
        return []
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    return [v.strip() for v in str(value).split(",") if v.strip()]


def _country_clause(country: str):
    iso = to_iso(country)
    if iso:
        return Company.country == iso
    return Company.country.ilike(f"%{country}%")


def _apply_export(stmt, entity_type: str, col, exported, file_id):
    """exported : 'no' = jamais exporté, 'yes' = déjà exporté. file_id : lignes d'un fichier précis."""
    was_exported = exists().where(FileItem.entity_type == entity_type, FileItem.role == "export",
                                  FileItem.entity_id == col)
    if exported == "no":
        stmt = stmt.where(~was_exported)
    elif exported == "yes":
        stmt = stmt.where(was_exported)
    if file_id:
        stmt = stmt.where(exists().where(FileItem.file_id == file_id, FileItem.entity_type == entity_type,
                                         FileItem.entity_id == col))
    return stmt


def contacts_stmt(q=None, status=None, country=None, city=None, sector=None, source=None,
                  company_id=None, has_phone=None, has_website=None, job_title=None, domain=None,
                  exclude_source=None, exported=None, file_id=None, ids=None):
    stmt = select(Contact, Company).outerjoin(Company, Contact.company_id == Company.id)
    if status:
        stmt = stmt.where(Contact.email_status.in_(split_csv(status)))
    else:
        stmt = stmt.where(Contact.email_status != "blacklisted")
    if ids:
        stmt = stmt.where(Contact.id.in_(ids))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Contact.email.ilike(like), Contact.full_name.ilike(like), Company.name.ilike(like)))
    if country:
        stmt = stmt.where(_country_clause(country))
    if city:
        stmt = stmt.where(Company.city.ilike(f"%{city}%"))
    if sector:
        stmt = stmt.where(Company.sector.ilike(f"%{sector}%"))
    inc, exc = split_csv(source), split_csv(exclude_source)
    if inc:
        stmt = stmt.where(Contact.source.in_(inc))
    if exc:  # les contacts sans source (NULL) ne sont pas exclus
        stmt = stmt.where(or_(Contact.source.is_(None), Contact.source.not_in(exc)))
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
    stmt = _apply_export(stmt, "contact", Contact.id, exported, file_id)
    return stmt.order_by(Contact.id.desc())


def companies_stmt(q=None, country=None, city=None, sector=None, source=None,
                   has_website=None, has_contacts=None, exclude_source=None, exported=None, file_id=None):
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
    stmt = _apply_export(stmt, "company", Company.id, exported, file_id)
    if has_contacts is True:
        stmt = stmt.having(n > 0)
    elif has_contacts is False:
        stmt = stmt.having(n == 0)
    stmt = stmt.order_by(Company.id.desc())
    inc, exc = split_csv(source), split_csv(exclude_source)
    # 'sources' est une colonne JSON : le filtre est appliqué en Python par les routeurs
    return stmt, ((inc, exc) if (inc or exc) else None)


def apply_company_sources(rows, flt):
    """flt = (inclure, ignorer). Garde une entreprise si elle a AU MOINS UNE source incluse
    (si la liste n'est pas vide) et AUCUNE source ignorée."""
    if not flt:
        return rows
    inc, exc = set(flt[0]), set(flt[1])
    out = []
    for row in rows:
        s = set(row[0].sources or [])
        if inc and not (s & inc):
            continue
        if exc and (s & exc):
            continue
        out.append(row)
    return out