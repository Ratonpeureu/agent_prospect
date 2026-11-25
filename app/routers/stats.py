from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import BlacklistEntry, Company, Contact, Job

router = APIRouter(prefix="/api/stats", tags=["Statistiques"])


@router.get("")
def stats(db: Session = Depends(get_db)):
    one = lambda stmt: db.execute(stmt).scalar_one()  # noqa: E731
    by_status = dict(db.execute(select(Contact.email_status, func.count()).group_by(Contact.email_status)).all())
    by_source = {(s or "inconnu"): n for s, n in
                 db.execute(select(Contact.source, func.count()).group_by(Contact.source)).all()}
    by_country = [{"country": c or "—", "count": n} for c, n in db.execute(
        select(Company.country, func.count()).group_by(Company.country).order_by(func.count().desc()).limit(8)).all()]

    since = datetime.utcnow() - timedelta(days=13)
    raw = {str(d)[:10]: n for d, n in db.execute(
        select(func.date(Contact.created_at), func.count()).where(Contact.created_at >= since)
        .group_by(func.date(Contact.created_at))).all()}
    per_day = [{"day": (since + timedelta(days=i)).date().isoformat(),
                "count": raw.get((since + timedelta(days=i)).date().isoformat(), 0)} for i in range(14)]

    no_contact = ~exists(select(Contact.id).where(Contact.company_id == Company.id))
    recent = db.execute(select(Job).order_by(Job.id.desc()).limit(6)).scalars().all()
    return {
        "companies": one(select(func.count(Company.id))),
        "contacts": one(select(func.count(Contact.id))),
        "blacklist": one(select(func.count(BlacklistEntry.id))),
        "companies_without_contacts": one(select(func.count(Company.id)).where(no_contact)),
        "contacts_by_status": by_status,
        "contacts_by_source": by_source,
        "companies_by_country": by_country,
        "contacts_per_day": per_day,
        "recent_jobs": [{"id": j.id, "kind": j.kind, "status": j.status, "created_at": j.created_at,
                         "params": j.params} for j in recent],
    }