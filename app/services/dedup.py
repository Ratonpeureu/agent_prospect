from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Company, Contact
from app.services.blacklist import BlacklistSets, is_blacklisted
from app.services.countries import to_iso
from app.services.normalize import (EMAIL_RE, FREE_DOMAINS, ensure_url, extract_domain,
                        guess_name_from_email, normalize_name)

SOCIAL_DOMAINS = {
    "facebook.com", "fb.com", "instagram.com", "linkedin.com", "twitter.com", "x.com", "youtube.com",
    "tiktok.com", "wa.me", "whatsapp.com", "linktr.ee", "google.com", "goo.gl", "business.site",
    "pagesjaunes.fr", "yelp.com", "tripadvisor.com", "wikipedia.org",
}
MERGE_FIELDS = ("website", "address", "city", "country", "phone", "sector", "domain", "legal_id")
EMPTY = (None, "", [], {})


def company_key(name: str | None, domain: str | None, city: str | None, legal_id: str | None = None) -> str:
    if legal_id:
        return f"l:{legal_id}"
    if domain:
        return f"d:{domain}"
    return f"n:{normalize_name(name)}|{normalize_name(city)}"


def _merge_extra(old: dict | None, new: dict | None) -> dict:
    merged = dict(old or {})
    for k, v in (new or {}).items():
        if v in EMPTY:
            continue
        if k == "officers":
            cur = merged.get("officers", [])
            seen = {(o.get("first_name"), o.get("last_name")) for o in cur}
            merged["officers"] = cur + [o for o in v if (o.get("first_name"), o.get("last_name")) not in seen]
        elif not merged.get(k):
            merged[k] = v
    return merged


def _find(db: Session, legal_id, domain, name, city, country, key) -> Company | None:
    if legal_id:
        c = db.execute(select(Company).where(Company.legal_id == legal_id)).scalars().first()
        if c:
            return c
    if domain:
        c = db.execute(select(Company).where(Company.domain == domain)).scalars().first()
        if c:
            return c
    nn = normalize_name(name)
    if nn:
        stmt = select(Company).where(Company.normalized_name == nn)
        if city:
            stmt = stmt.where(func.lower(Company.city) == city.lower())
        elif country:
            stmt = stmt.where(Company.country == country)
        c = db.execute(stmt).scalars().first()
        if c:
            return c
    return db.execute(select(Company).where(Company.dedup_key == key)).scalars().first()


def upsert_company(db: Session, data: dict, source: str | None = None) -> tuple[Company, bool]:
    """Crée ou fusionne une entreprise (clé : n° légal > domaine > nom+ville). Retourne (company, created)."""
    website = ensure_url(data.get("website"))
    domain = data.get("domain") or extract_domain(website)
    if domain in FREE_DOMAINS or domain in SOCIAL_DOMAINS:
        domain = None
    name = (data.get("name") or domain or "").strip()
    if not name:
        raise ValueError("Une entreprise nécessite au moins un nom ou un site web")
    country = to_iso(data.get("country")) or (data.get("country") or None)
    city = data.get("city")
    legal_id = data.get("legal_id")
    key = company_key(name, domain, city, legal_id)

    company = _find(db, legal_id, domain, name, city, country, key)
    values = {**data, "website": website, "domain": domain, "country": country}

    if company:
        for f in MERGE_FIELDS:
            if not getattr(company, f) and values.get(f):
                setattr(company, f, values[f])
        company.extra = _merge_extra(company.extra, data.get("extra"))
        if source and source not in (company.sources or []):
            company.sources = [*(company.sources or []), source]
        db.flush()
        return company, False

    company = Company(
        name=name, normalized_name=normalize_name(name), legal_id=legal_id, domain=domain, website=website,
        address=data.get("address"), city=city, country=country, phone=data.get("phone"),
        sector=data.get("sector"), notes=data.get("notes"), extra=_merge_extra({}, data.get("extra")),
        sources=[source] if source else [], dedup_key=key,
    )
    db.add(company)
    db.flush()
    return company, True


def upsert_contact(db: Session, data: dict, bl: BlacklistSets) -> tuple[Contact | None, str]:
    """Statuts : created | duplicate | blacklisted | invalid_syntax."""
    email = (data.get("email") or "").strip().lower()
    if not EMAIL_RE.fullmatch(email):
        return None, "invalid_syntax"
    if is_blacklisted(bl, email):
        return None, "blacklisted"

    contact = db.execute(select(Contact).where(Contact.email == email)).scalar_one_or_none()
    if contact:
        for f in ("first_name", "last_name", "full_name", "job_title", "phone", "company_id"):
            if not getattr(contact, f) and data.get(f):
                setattr(contact, f, data[f])
        db.flush()
        return contact, "duplicate"

    first, last = data.get("first_name"), data.get("last_name")
    if not first and not last:
        first, last = guess_name_from_email(email)
    full = data.get("full_name") or " ".join(p for p in (first, last) if p) or None

    contact = Contact(
        email=email, first_name=first, last_name=last, full_name=full,
        job_title=data.get("job_title"), phone=data.get("phone"),
        company_id=data.get("company_id"), source=data.get("source"),
    )
    db.add(contact)
    db.flush()
    return contact, "created"