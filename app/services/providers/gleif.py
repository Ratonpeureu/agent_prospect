import re

import httpx

from app.config import settings
from app.services.normalize import strip_accents
from app.services.providers.base import Provider, SearchParams

URL = "https://api.gleif.org/api/v1/lei-records"


def _n(s: str | None) -> str:
    return strip_accents(s or "").lower()


class GleifProvider(Provider):
    name = "gleif"
    label = "GLEIF (registre LEI)"
    description = "Entités juridiques disposant d'un LEI (grandes sociétés, banques, fonds). Données ouvertes CC0, sans clé."
    countries = None
    filters = {"category": "GENERAL | FUND | BRANCH | SOLE_PROPRIETOR | INFRASTRUCTURE_ENTITY"}

    def search(self, p: SearchParams) -> list[dict]:
        if not (p.country or p.query):
            return []
        loc = _n(p.location)
        size = 200 if loc else min(200, p.limit)
        out: list[dict] = []
        page = 1
        while len(out) < p.limit and page <= 8:
            params = {"page[size]": size, "page[number]": page, "filter[entity.status]": "ACTIVE"}
            if p.country:
                params["filter[entity.legalAddress.country]"] = p.country
            if p.query:
                params["filter[fulltext]"] = p.query
            if p.filters.get("category"):
                params["filter[entity.category]"] = str(p.filters["category"]).upper()
            try:
                r = httpx.get(URL, params=params, timeout=settings.PROVIDER_TIMEOUT,
                              headers={**self.headers(), "Accept": "application/vnd.api+json"})
                if r.status_code != 200:
                    break
                data = r.json().get("data", [])
            except (httpx.HTTPError, ValueError):
                break
            if not data:
                break
            for rec in data:
                a = rec.get("attributes", {})
                ent = a.get("entity", {})
                addr = ent.get("legalAddress", {}) or {}
                city = addr.get("city")
                if loc and loc not in _n(city):
                    continue
                name = (ent.get("legalName") or {}).get("name")
                if not name:
                    continue
                lei = a.get("lei")
                reg = ent.get("registeredAs")
                country = addr.get("country")
                legal_id = reg if (country == "FR" and reg and re.fullmatch(r"\d{9}", reg)) else lei
                lines = [x for x in (addr.get("addressLines") or []) if x]
                out.append({
                    "name": name, "legal_id": legal_id, "country": country, "city": city,
                    "address": ", ".join(lines + [x for x in (addr.get("postalCode"),) if x]) or None,
                    "sector": ent.get("category"), "source": self.name,
                    "extra": {"lei": lei, "legal_form": (ent.get("legalForm") or {}).get("id"),
                              "registered_as": reg, "jurisdiction": ent.get("jurisdiction"),
                              "status": ent.get("status"), "creation_date": (ent.get("creationDate") or "")[:10] or None},
                })
                if len(out) >= p.limit:
                    break
            if len(data) < size:
                break
            page += 1
        return out


provider = GleifProvider()