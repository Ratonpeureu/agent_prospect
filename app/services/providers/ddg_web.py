from urllib.parse import urlparse

from app.services.countries import country_terms
from app.services.dedup import SOCIAL_DOMAINS
from app.services.normalize import FREE_DOMAINS, extract_domain
from app.services.presets import find_preset
from app.services.providers.base import Provider, SearchParams
from app.services.sources import ddg

SKIP = SOCIAL_DOMAINS | FREE_DOMAINS | {"youtube.com", "bing.com", "indeed.com", "glassdoor.com",
                                       "jumia.com", "alibaba.com", "amazon.com", "booking.com"}


class DuckDuckGoProvider(Provider):
    name = "ddg_web"
    label = "Recherche web (DuckDuckGo)"
    description = "Trouve des sites d'entreprises par secteur + ville + pays. Gratuit, sans clé. Non officiel : se met en pause s'il limite les requêtes."
    countries = None
    filters = {"ddg_pages": "pages de résultats par variante de requête (1 à 5, défaut 2)"}

    def search(self, p: SearchParams) -> list[dict]:
        if not (p.query or p.location):
            return []
        pre = find_preset(p.query)
        geo = (country_terms(p.country) or [""])[0] if p.country else ""
        base = " ".join(x for x in (p.query, p.location, geo) if x)
        pages = max(1, min(5, int(p.filters.get("ddg_pages", 2) or 2)))
        out: dict[str, dict] = {}
        for q in (base, f"{base} contact"):
            for title, url in ddg.search(q, pages=pages):
                pu = urlparse(url)
                host = extract_domain(url)
                if not host or host in SKIP or any(host.endswith("." + d) for d in SKIP):
                    continue
                if len([s for s in pu.path.split("/") if s]) > 1 or pu.path.lower().endswith((".pdf", ".doc", ".docx")):
                    continue  # pages profondes = articles / annuaires, pas un site d'entreprise
                name = (title or "").replace("–", "-").replace("|", "-").split(" - ")[0].strip()[:80]
                if len(name) < 3:
                    name = host.split(".")[0].replace("-", " ").title()
                out.setdefault(host, {"name": name, "website": f"{pu.scheme}://{pu.netloc}", "domain": host,
                                      "country": p.country, "city": p.location or None,
                                      "sector": pre[1]["label"] if pre else (p.query or None),
                                      "source": self.name, "extra": {}})
            if len(out) >= p.limit:
                break
        return list(out.values())[: p.limit]


provider = DuckDuckGoProvider()