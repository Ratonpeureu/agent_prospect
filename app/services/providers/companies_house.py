import time

import httpx

from app.config import settings
from app.services.presets import find_preset
from app.services.providers.base import Provider, SearchParams

BASE = "https://api.company-information.service.gov.uk"


def _parse_officer(o: dict) -> dict | None:
    if o.get("resigned_on"):
        return None
    name = o.get("name") or ""
    if "," in name:
        last, first = [x.strip() for x in name.split(",", 1)]
    else:
        parts = name.split()
        first, last = (parts[0], " ".join(parts[1:])) if parts else ("", "")
    return {"first_name": first.title(), "last_name": last.title(), "role": o.get("officer_role")}


class CompaniesHouseProvider(Provider):
    name = "companies_house"
    label = "Companies House (Royaume-Uni)"
    description = "Registre officiel britannique : sièges, dates de création, codes SIC, dirigeants. Clé gratuite."
    countries = {"GB"}
    key_env = "COMPANIES_HOUSE_API_KEY"
    signup_url = "https://developer.company-information.service.gov.uk/"
    filters = {
        "sic_codes": "liste de codes SIC (sinon déduits du secteur)",
        "status": "active (défaut) | dissolved | liquidation...",
        "company_type": "ltd | plc | llp...",
        "incorporated_from": "YYYY-MM-DD", "incorporated_to": "YYYY-MM-DD",
        "officers": "true pour récupérer les dirigeants (1 requête par société)",
    }

    def search(self, p: SearchParams) -> list[dict]:
        auth = (settings.COMPANIES_HOUSE_API_KEY, "")
        sic = p.filters.get("sic_codes")
        if isinstance(sic, str):
            sic = [sic]
        pre = find_preset(p.query)
        if not sic and pre:
            sic = pre[1]["sic"]
        size = min(100, p.limit)
        out: list[dict] = []
        start = 0
        with httpx.Client(auth=auth, timeout=settings.PROVIDER_TIMEOUT, headers=self.headers()) as client:
            while len(out) < p.limit:
                params = {"size": size, "start_index": start,
                          "company_status": p.filters.get("status", "active")}
                if p.location:
                    params["location"] = p.location
                if sic:
                    params["sic_codes"] = ",".join(sic)
                elif p.query:
                    params["company_name_includes"] = p.query
                for k in ("company_type", "incorporated_from", "incorporated_to"):
                    if p.filters.get(k):
                        params[k] = p.filters[k]
                try:
                    r = client.get(f"{BASE}/advanced-search/companies", params=params)
                except httpx.HTTPError:
                    break
                if r.status_code != 200:
                    break
                items = r.json().get("items", [])
                if not items:
                    break
                for it in items:
                    ad = it.get("registered_office_address") or {}
                    num = it.get("company_number")
                    out.append({
                        "name": it.get("company_name"), "legal_id": num, "country": "GB",
                        "city": ad.get("locality"),
                        "address": ", ".join(x for x in (ad.get("address_line_1"), ad.get("address_line_2"),
                                                         ad.get("postal_code")) if x) or None,
                        "sector": pre[1]["label"] if pre else ", ".join(it.get("sic_codes") or []) or None,
                        "source": self.name,
                        "extra": {"sic_codes": it.get("sic_codes"), "legal_form": it.get("company_type"),
                                  "status": it.get("company_status"), "creation_date": it.get("date_of_creation")},
                    })
                    if len(out) >= p.limit:
                        break
                if len(items) < size:
                    break
                start += size
                time.sleep(0.2)

            if str(p.filters.get("officers", "")).lower() in ("1", "true", "yes"):
                for c in out:
                    try:
                        r = client.get(f"{BASE}/company/{c['legal_id']}/officers", params={"items_per_page": 10})
                        if r.status_code == 200:
                            offs = [_parse_officer(o) for o in r.json().get("items", [])]
                            c["extra"]["officers"] = [o for o in offs if o and o["last_name"]]
                    except httpx.HTTPError:
                        pass
                    time.sleep(0.2)
        return [c for c in out if c.get("name")]


provider = CompaniesHouseProvider()