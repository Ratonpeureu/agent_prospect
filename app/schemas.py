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
    exports_count: int = 0
    last_exported_at: datetime | None = None
    created_at: datetime


class ContactIn(BaseModel):
    email: str
    first_name: str | None = None
    last_name: str | None = None
    job_title: str | None = None
    phone: str | None = None
    profile_url: str | None = None
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
    profile_url: str | None = None
    department: str | None = None
    seniority: str | None = None
    evidence: str | None = None
    company_id: int | None
    company_name: str | None
    source: str | None
    email_status: str
    email_reason: str | None
    email_score: int | None
    is_role: bool
    verified_at: datetime | None
    created_at: datetime
    exports_count: int = 0
    last_exported_at: datetime | None = None


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
    query: str = ""
    queries: list[str] = Field([], description="Plusieurs mots-clés / secteurs")
    location: str = Field("", description="Ville, code postal ou département (appliqué à tous les pays)")
    country: str | None = None
    countries: list[str] = Field([], description="Plusieurs pays : 'SN', 'Côte d'Ivoire'...")
    sources: list[str] = Field(["auto"])
    exclude_sources: list[str] = Field([], description="Sources à ignorer, même en mode 'auto'")
    limit: int = Field(50, ge=1, le=500, description="Limite PAR source et PAR combinaison")
    filters: dict[str, Any] = {}
    enrich_websites: bool = True
    discover_emails: bool = True
    verify: bool = True
    use_smtp: bool | None = None
    find_people: bool = True
    person_titles: list[str] = Field([], description="Mots-clés de poste (ex. directeur, achats, marketing)")
    person_levels: list[Literal["c_level", "director", "manager", "staff"]] = []
    person_departments: list[str] = []
    people_sources: list[str] = Field(["website", "registry"], description="website | registry | web | profiles | github")

    @model_validator(mode="after")
    def _normalize(self):
        if self.query and self.query not in self.queries:
            self.queries = [self.query, *self.queries]
        if self.country and self.country not in self.countries:
            self.countries = [self.country, *self.countries]
        self.queries = list(dict.fromkeys(q.strip() for q in self.queries if q.strip()))
        self.countries = list(dict.fromkeys(self.countries))
        if not (self.queries or self.location or self.countries or self.filters):
            raise ValueError("Précise au moins un mot-clé, une zone, un pays ou des filtres")
        if max(1, len(self.queries)) * max(1, len(self.countries)) > 60:
            raise ValueError("Trop de combinaisons (mots-clés × pays > 60) : réduis la sélection")
        return self



class VerifyTextIn(BaseModel):
    text: str = ""
    emails: list[str] = []
    use_smtp: bool | None = None
    save_to_db: bool = False




