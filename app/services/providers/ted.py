import httpx

from app.config import settings
from app.services.providers.base import Provider, SearchParams

URL = "https://api.ted.europa.eu/v3/notices/search"
F_NAME, F_COUNTRY, F_CITY = "winner-name", "winner-country", "winner-city"
ISO3 = {"FR": "FRA", "BE": "BEL", "LU": "LUX", "DE": "DEU", "ES": "ESP", "IT": "ITA", "PT": "PRT", "NL": "NLD"}


def _strings(v) -> list[str]:
    if isinstance(v, str):
        return [v]
    if isinstance(v, list):
        return [s for x in v for s in _strings(x)]
    if isinstance(v, dict):
        return [s for x in v.values() for s in _strings(x)]
    return []


class TedProvider(Provider):
    name = "ted"
    label = "TED (marchés publics européens)"
    description = "Attributaires d'avis d'attribution publiés au Journal officiel de l'UE. Sans clé."
    countries = set(ISO3)
    filters = {"cpv": "code CPV (ex. 72000000 = services informatiques)", "extra_query": "clause TED supplémentaire (syntaxe expert)"}

    def search(self, p: SearchParams) -> list[dict]:
        iso3 = ISO3.get(p.country or "")
        if not iso3:
            return []
        q = f"notice-type=can-standard AND {F_COUNTRY}={iso3}"
        if p.filters.get("cpv"):
            q += f" AND classification-cpv={p.filters['cpv']}"
        if p.filters.get("extra_query"):
            q += f" AND ({p.filters['extra_query']})"
        out, seen, page = [], set(), 1
        while len(out) < p.limit and page <= 20:
            body = {"query": q, "fields": [F_NAME, F_CITY], "limit": min(250, max(25, p.limit)),
                    "page": page, "scope": "ALL", "paginationMode": "PAGE_NUMBER"}
            try:
                r = httpx.post(URL, json=body, headers=self.headers(), timeout=settings.PROVIDER_TIMEOUT)
                if r.status_code != 200:
                    raise RuntimeError(f"TED HTTP {r.status_code} : {r.text[:300]}")
                notices = r.json().get("notices", [])
            except (httpx.HTTPError, ValueError):
                break
            if not notices:
                break
            for n in notices:
                cities = _strings(n.get(F_CITY))
                for i, nm in enumerate(dict.fromkeys(_strings(n.get(F_NAME)))):
                    key = nm.strip().lower()
                    if not key or key in seen:
                        continue
                    seen.add(key)
                    out.append({"name": nm.strip(), "country": p.country, "city": cities[i] if i < len(cities) else None,
                                "source": self.name, "extra": {"description": "Attributaire d'un marché public (TED)"}})
            page += 1
        return out[: p.limit]


provider = TedProvider()