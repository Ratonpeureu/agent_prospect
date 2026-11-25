from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CompanyIn(BaseModel):
    name: str | None = None
    website: str | None = None
    address: str | None = None
    city: str | None = None
    country: str | None = None
    phone: str | None = None
    sector: str | None = None
    legal_id: str | None = None
    notes: str | None = None


class CompanyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    legal_id: str | None
    domain: str | None
    website: str | None
    address: str | None
    city: str | None
    country: str | None
    phone: str | None
    sector: str | None
    sources: list
    extra: dict | None
    notes: str | None
    contacts_count: int = 0
    created_at: datetime


class ContactIn(BaseModel):
    email: str
    first_name: str | None = None
    last_name: str | None = None
    job_title: str | None = None
    phone: str | None = None
    company_id: int | None = None
    verify: bool = False


class ContactPatch(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    job_title: str | None = None
    phone: str | None = None
    company_id: int | None = None


class ContactOut(BaseModel):
    id: int
    email: str
    first_name: str | None
    last_name: str | None
    full_name: str | None
    job_title: str | None
    phone: str | None
    company_id: int | None
    company_name: str | None
    source: str | None
    email_status: str
    email_reason: str | None
    email_score: int | None
    is_role: bool
    verified_at: datetime | None
    created_at: datetime


class BlacklistIn(BaseModel):
    kind: Literal["email", "domain"]
    values: list[str] = Field(..., min_length=1)
    reason: str | None = None


class BlacklistOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    value: str
    reason: str | None
    created_at: datetime


class SearchRequest(BaseModel):
    query: str = Field("", description="Mot-clé ou secteur : 'informatique', 'comptabilité', 'banque'... (voir GET /api/presets)")
    location: str = Field("", description="Ville, code postal ou département selon la source")
    country: str | None = Field(None, description="Pays : 'SN', 'Sénégal', 'France'...")
    sources: list[str] = Field(["auto"], description="'auto' = toutes les sources adaptées au pays ; sinon noms (GET /api/sources)")
    limit: int = Field(50, ge=1, le=500, description="Limite PAR source")
    filters: dict[str, Any] = Field({}, description="Filtres dynamiques propres aux sources (naf, effectif, osm_tags...)")
    enrich_websites: bool = True    # lit les pages contact des sites (httpx simple)
    discover_emails: bool = True    # génère contact@, prenom.nom@... et ne garde que les valides (SMTP)
    verify: bool = True             # vérifie les emails trouvés
    use_smtp: bool | None = None

    @model_validator(mode="after")
    def _need_something(self):
        if not (self.query or self.location or self.country or self.filters):
            raise ValueError("Précise au moins query, location, country ou filters")
        return self