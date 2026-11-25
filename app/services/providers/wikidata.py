import re
from collections import OrderedDict

import httpx

from app.config import settings
from app.services.normalize import ensure_url, extract_domain, strip_accents
from app.services.providers.base import Provider, SearchParams

ENDPOINT = "https://query.wikidata.org/sparql"


def _n(s: str | None) -> str:
    return strip_accents(s or "").lower()


class WikidataProvider(Provider):
    name = "wikidata"
    label = "Wikidata (SPARQL)"
    description = "Organisations/entreprises avec site officiel, secteur et siège. CC0, sans clé. Pays obligatoire."
    countries = None
    filters = {"wikidata_class": "QID du type d'entité (défaut Q4830453 = entreprise ; Q43229 = organisation ; Q163740 = ONG)"}

    def search(self, p: SearchParams) -> list[dict]:
        if not p.country:
            return []
        cls = str(p.filters.get("wikidata_class", "Q4830453"))
        if not re.fullmatch(r"Q\d+", cls) or not re.fullmatch(r"[A-Z]{2}", p.country):
            return []
        fetch = min(p.limit * 6, 1500)
        sparql = f"""SELECT ?item ?itemLabel ?itemDescription ?website ?industryLabel ?hqLabel ?inception WHERE {{
  ?country wdt:P297 "{p.country}" .
  ?item wdt:P17 ?country .
  ?item wdt:P31/wdt:P279* wd:{cls} .
  OPTIONAL {{ ?item wdt:P856 ?website }}
  OPTIONAL {{ ?item wdt:P452 ?industry }}
  OPTIONAL {{ ?item wdt:P159 ?hq }}
  OPTIONAL {{ ?item wdt:P571 ?inception }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "fr,en". }}
}} LIMIT {fetch}"""
        try:
            r = httpx.get(ENDPOINT, params={"query": sparql, "format": "json"},
                          headers={**self.headers(), "Accept": "application/sparql-results+json"},
                          timeout=settings.PROVIDER_TIMEOUT + 30)
            if r.status_code != 200:
                return []
            rows = r.json()["results"]["bindings"]
        except (httpx.HTTPError, ValueError, KeyError):
            return []

        items: "OrderedDict[str, dict]" = OrderedDict()
        for row in rows:
            uri = row["item"]["value"]
            it = items.setdefault(uri, {"label": None, "desc": None, "sites": set(), "industries": set(),
                                        "hq": None, "inception": None})
            it["label"] = row.get("itemLabel", {}).get("value")
            it["desc"] = row.get("itemDescription", {}).get("value")
            if "website" in row:
                it["sites"].add(row["website"]["value"])
            if "industryLabel" in row:
                it["industries"].add(row["industryLabel"]["value"])
            if "hqLabel" in row:
                it["hq"] = row["hqLabel"]["value"]
            if "inception" in row:
                it["inception"] = row["inception"]["value"][:10]

        kw, loc = _n(p.query), _n(p.location)
        out = []
        for uri, it in items.items():
            label = it["label"]
            if not label or re.fullmatch(r"Q\d+", label):
                continue
            hay = _n(" ".join([label, it["desc"] or "", " ".join(it["industries"])]))
            if kw and kw not in hay:
                continue
            if loc and loc not in _n(it["hq"]) and loc not in hay:
                continue
            website = ensure_url(sorted(it["sites"])[0]) if it["sites"] else None
            out.append({
                "name": label, "website": website, "domain": extract_domain(website),
                "city": it["hq"], "country": p.country,
                "sector": ", ".join(sorted(it["industries"]))[:150] or None, "source": self.name,
                "extra": {"wikidata": uri.rsplit("/", 1)[-1], "creation_date": it["inception"],
                          "description": it["desc"]},
            })
            if len(out) >= p.limit:
                break
        return out


provider = WikidataProvider()