import httpx

from app.config import settings
from app.services.countries import EN_NAMES
from app.services.presets import find_preset
from app.services.providers.base import Provider, SearchParams

URL = "https://finances.worldbank.org/resource/kdui-wcs3.json"
# les descriptions de contrats sont en anglais : traduction des secteurs prédéfinis
EN_KW = {"it": ["software", "information technology", "ICT", "computer", "information system"],
         "consulting": ["consult", "advisory", "technical assistance"], "accounting": ["audit", "accounting"],
         "education": ["training", "education", "school"], "construction": ["construction", "civil works", "rehabilitation"],
         "health": ["medical", "health", "hospital", "pharmaceutical"], "transport": ["transport", "logistics"],
         "advertising": ["communication", "media", "awareness", "marketing"], "legal": ["legal"],
         "real_estate": ["real estate", "building"], "hotel": ["hotel", "accommodation"], "restaurant": ["catering"]}


def _q(s: str) -> str:
    return s.replace("'", "''").replace("%", "")


class WorldBankProvider(Provider):
    name = "worldbank"
    label = "Banque mondiale (contrats attribués)"
    description = "Fournisseurs attributaires de marchés financés par la Banque mondiale, depuis FY2014. Sans clé. Pays obligatoire."
    countries = None
    filters = {"scope": "supplier (défaut : sociétés établies dans le pays) | borrower (marchés financés dans le pays)"}

    def search(self, p: SearchParams) -> list[dict]:
        if not p.country:
            return []
        col = "borrower_country" if p.filters.get("scope") == "borrower" else "supplier_country"
        en = EN_NAMES.get(p.country, p.country)
        geo_variants = [f"upper({col}_code)='{p.country}'", f"upper({col}) like upper('%{_q(en)}%')"]

        kw = []
        pre = find_preset(p.query)
        if pre and pre[0] in EN_KW:
            kw = EN_KW[pre[0]]
        elif p.query:
            kw = [p.query]
        kw_clause = ""
        if kw:
            ors = " OR ".join(f"upper(wb_contract_description) like upper('%{_q(k)}%') OR upper(major_sector) like upper('%{_q(k)}%')"
                              for k in kw)
            kw_clause = f" AND ({ors})"

        for geo in geo_variants:  # le code pays peut être ISO2, ISO3 ou absent : on essaie ensuite le nom
            out, offset = [], 0
            while len(out) < p.limit:
                params = {"$select": "supplier, supplier_country, count(*) as n, max(major_sector) as sector, "
                                     "max(wb_contract_description) as descr",
                          "$where": geo + kw_clause + " AND supplier IS NOT NULL",
                          "$group": "supplier, supplier_country", "$order": "n DESC",
                          "$limit": min(500, p.limit), "$offset": offset}
                try:
                    r = httpx.get(URL, params=params, headers=self.headers(), timeout=settings.PROVIDER_TIMEOUT)
                    rows = r.json() if r.status_code == 200 else []
                except (httpx.HTTPError, ValueError):
                    rows = []
                if not isinstance(rows, list) or not rows:
                    break
                for x in rows:
                    nm = (x.get("supplier") or "").strip()
                    if not nm:
                        continue
                    out.append({"name": nm.title() if nm.isupper() else nm, "country": p.country,
                                "sector": x.get("sector"), "source": self.name,
                                "extra": {"description": f"Attributaire Banque mondiale ({x.get('n')} contrat(s)) : "
                                                         f"{(x.get('descr') or '')[:160]}"}})
                if len(rows) < min(500, p.limit):
                    break
                offset += len(rows)
            if out:
                return out[: p.limit]
        return []


provider = WorldBankProvider()