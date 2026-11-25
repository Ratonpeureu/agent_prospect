from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import BlacklistEntry, Contact


@dataclass
class BlacklistSets:
    emails: set[str] = field(default_factory=set)
    domains: set[str] = field(default_factory=set)


def load_blacklist(db: Session) -> BlacklistSets:
    bl = BlacklistSets()
    for kind, value in db.execute(select(BlacklistEntry.kind, BlacklistEntry.value)):
        (bl.emails if kind == "email" else bl.domains).add(value.lower())
    return bl


def is_blacklisted(bl: BlacklistSets, email: str) -> bool:
    email = email.lower()
    domain = email.rsplit("@", 1)[-1]
    return email in bl.emails or domain in bl.domains


def add_entries(db: Session, kind: str, values: list[str], reason: str | None = None,
                update_contacts: bool = True) -> int:
    """Ajoute des entrées à la blacklist (sans doublons). Retourne le nombre ajouté."""
    existing = {v for (v,) in db.execute(select(BlacklistEntry.value).where(BlacklistEntry.kind == kind))}
    added = 0
    for raw in values:
        v = raw.strip().lower().removeprefix("@")
        if not v or v in existing:
            continue
        db.add(BlacklistEntry(kind=kind, value=v, reason=reason))
        existing.add(v)
        added += 1
        if update_contacts:
            stmt = select(Contact).where(
                Contact.email == v if kind == "email" else Contact.email.like(f"%@{v}")
            )
            for c in db.execute(stmt).scalars():
                c.email_status = "blacklisted"
                c.email_reason = f"blacklist:{reason or kind}"
    db.commit()
    return added


def remove_entry(db: Session, entry: BlacklistEntry) -> None:
    """Supprime l'entrée et remet les contacts concernés en 'unverified'."""
    stmt = select(Contact).where(
        Contact.email == entry.value if entry.kind == "email" else Contact.email.like(f"%@{entry.value}")
    ).where(Contact.email_status == "blacklisted")
    for c in db.execute(stmt).scalars():
        c.email_status = "unverified"
        c.email_reason = None
    db.delete(entry)
    db.commit()