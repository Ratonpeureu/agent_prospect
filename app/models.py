from datetime import datetime

from sqlalchemy import (JSON, Boolean, DateTime, ForeignKey, Integer, String,
                        Text, UniqueConstraint, func)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from sqlalchemy import (JSON, Boolean, DateTime, ForeignKey, Index, Integer, String,
                        Text, UniqueConstraint, func)

class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(300), index=True)
    normalized_name: Mapped[str] = mapped_column(String(300), index=True, default="")
    legal_id: Mapped[str | None] = mapped_column(String(60), index=True)  # SIREN, n° Companies House, LEI...
    domain: Mapped[str | None] = mapped_column(String(255), index=True)
    website: Mapped[str | None] = mapped_column(String(500))
    address: Mapped[str | None] = mapped_column(String(500))
    city: Mapped[str | None] = mapped_column(String(150), index=True)
    country: Mapped[str | None] = mapped_column(String(100), index=True)  # code ISO2 si connu
    phone: Mapped[str | None] = mapped_column(String(80))
    sector: Mapped[str | None] = mapped_column(String(150), index=True)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    # infos libres : naf, effectif, forme juridique, date de création, statut, dirigeants, lei, wikidata...
    extra: Mapped[dict | None] = mapped_column(JSON, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
    dedup_key: Mapped[str] = mapped_column(String(450), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    contacts: Mapped[list["Contact"]] = relationship(
        back_populates="company", cascade="all, delete-orphan"
    )


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="CASCADE"), index=True)
    first_name: Mapped[str | None] = mapped_column(String(120))
    last_name: Mapped[str | None] = mapped_column(String(120))
    full_name: Mapped[str | None] = mapped_column(String(250), index=True)
    job_title: Mapped[str | None] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(80))
    source: Mapped[str | None] = mapped_column(String(60), index=True)

    # unverified | valid | risky | unknown | invalid | blacklisted
    email_status: Mapped[str] = mapped_column(String(20), default="unverified", index=True)
    email_reason: Mapped[str | None] = mapped_column(String(200))
    email_score: Mapped[int | None] = mapped_column(Integer)
    is_role: Mapped[bool] = mapped_column(Boolean, default=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    phone: Mapped[str | None] = mapped_column(String(80))
    profile_url: Mapped[str | None] = mapped_column(String(500))   # profil public (ex. LinkedIn)
    department: Mapped[str | None] = mapped_column(String(40))     # direction, commercial, marketing, finance, rh, it...
    seniority: Mapped[str | None] = mapped_column(String(20))      # c_level | director | manager | staff
    evidence: Mapped[str | None] = mapped_column(String(500))

    company: Mapped[Company | None] = relationship(back_populates="contacts")


class BlacklistEntry(Base):
    __tablename__ = "blacklist"
    __table_args__ = (UniqueConstraint("kind", "value", name="uq_blacklist_kind_value"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), index=True)  # email | domain
    value: Mapped[str] = mapped_column(String(320), index=True)
    reason: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(30), index=True)  # search | enrich | verify_file | verify_pending
    status: Mapped[str] = mapped_column(String(15), default="queued", index=True)
    params: Mapped[dict | None] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON)
    file_path: Mapped[str | None] = mapped_column(String(500))
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    progress: Mapped[dict | None] = mapped_column(JSON)          # checkpoint : permet la reprise
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime)
    attempts: Mapped[int | None] = mapped_column(Integer, default=0)





class FileRecord(Base):
    """Fichier conservé : export, import, résultat de vérification."""
    __tablename__ = "files"

    id: Mapped[int] = mapped_column(primary_key=True)
    # export_contacts | export_companies | import | verified
    category: Mapped[str] = mapped_column(String(30), index=True)
    format: Mapped[str] = mapped_column(String(10))  # xlsx | csv | txt
    filename: Mapped[str] = mapped_column(String(300), index=True)
    path: Mapped[str | None] = mapped_column(String(600))
    size: Mapped[int] = mapped_column(Integer, default=0)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    filters: Mapped[dict | None] = mapped_column(JSON, default=dict)
    note: Mapped[str | None] = mapped_column(String(300))
    job_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class FileItem(Base):
    """Lien fichier <-> ligne (contact ou entreprise) : sert à savoir ce qui a déjà été exporté."""
    __tablename__ = "file_items"
    __table_args__ = (Index("ix_file_items_entity", "entity_type", "entity_id", "role"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    file_id: Mapped[int] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), index=True)
    entity_type: Mapped[str] = mapped_column(String(10))  # contact | company
    entity_id: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(10))  # export | import








