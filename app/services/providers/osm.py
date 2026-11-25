import re

import httpx

from app.config import settings
from app.services.countries import AFRICA
from app.services.normalize import ensure_url, extract_domain
from app.services.presets import find_preset
from app.services.providers.base import Provider, SearchParams

MAIN = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
AFRICA_EP = "https://ovp.dresel.systems/api-af/interpreter"
TAG_RE = re.compile(r"^[A-Za-z0-9_:\-]+(=[A-Za-z0-9_:\-\.]+)?$")


def _esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def _rx(s: str) -> str:
    return _esc(re.escape(s))


def _sel(tag: str) -> str:
    if "=" in tag:
        k, v = tag.split("=", 1)
        return f'["{k}"="{v}"]'
    return f'["{tag}"]'


class OSMProvider(Provider):
    name = "osm"
    label = "OpenStreetMap (Overpass)"
    description = "Entreprises, bureaux, banques, écoles, ONG... cartographiés. Sans clé. Endpoint Afrique prioritaire pour l'Afrique."
    countries = None
    filters = {
        "osm_tags": "liste de tags 'clé=valeur', ex ['office=it','amenity=bank'] (sinon déduit du secteur)",
        "name_contains": "texte à trouver dans le nom",
    }

    def _tags(self, p: SearchParams) -> list[str]:
        raw = p.filters.get("osm_tags")
        if isinstance(raw, str):
            raw = [raw]
        tags = [t for t in (raw or []) if TAG_RE.match(str(t))]
        if tags:
            return tags
        pre = find_preset(p.query)
        if pre:
            return pre[1]["osm"]
        return []

    def search(self, p: SearchParams) -> list[dict]:
        if p.location:
            area = f'area[~"^name(:fr|:en)?$"~"^{_rx(p.location)}$",i]'
        elif p.country:
            area = f'area["ISO3166-1"="{p.country}"]'
        else:
            return []

        tags = self._tags(p)
        nc = p.filters.get("name_contains")
        name_f = f'["name"~"{_rx(str(nc))}",i]' if nc else ""
        if tags:
            body = "\n".join(f"  nwr(area.a){_sel(t)}{name_f};" for t in tags)
        elif p.query:
            kw = _rx(p.query)
            body = (f'  nwr(area.a)["name"~"{kw}",i];\n'
                    f'  nwr(area.a)[~"^(amenity|shop|office|craft|tourism|healthcare|industrial|leisure)$"~"{kw}",i];')
        else:
            body = f"  nwr(area.a)[\"office\"=\"company\"]{name_f};"

        cap = min(p.limit * 4, 2000)
        query = f"[out:json][timeout:90];\n{area}->.a;\n(\n{body}\n);\nout tags center {cap};"

        endpoints = ([AFRICA_EP] + MAIN) if (p.country in AFRICA) else MAIN
        data = None
        for url in endpoints:
            try:
                r = httpx.post(url, data={"data": query}, headers=self.headers(),
                               timeout=settings.PROVIDER_TIMEOUT + 40)
                if r.status_code == 200:
                    data = r.json()
                    break
            except (httpx.HTTPError, ValueError):
                continue
        if not data:
            return []

        pre = find_preset(p.query)
        results, seen = [], set()
        for el in data.get("elements", []):
            t = el.get("tags", {})
            name = t.get("name")
            if not name:
                continue
            website = ensure_url(t.get("website") or t.get("contact:website") or t.get("url"))
            phone = t.get("phone") or t.get("contact:phone") or t.get("contact:mobile")
            email = t.get("email") or t.get("contact:email")
            key = (name.lower(), website or phone or email or el.get("id"))
            if key in seen:
                continue
            seen.add(key)
            street = " ".join(x for x in (t.get("addr:housenumber"), t.get("addr:street")) if x)
            sector = pre[1]["label"] if pre else next(
                (t[k] for k in ("office", "amenity", "shop", "craft", "tourism", "healthcare") if k in t), None)
            results.append({
                "name": name, "website": website, "domain": extract_domain(website), "phone": phone,
                "email": email.split(";")[0].strip() if email else None,
                "address": ", ".join(x for x in (street, t.get("addr:postcode")) if x) or None,
                "city": t.get("addr:city") or p.location or None, "country": p.country,
                "sector": sector, "source": self.name,
                "extra": {"osm_ref": f"{el.get('type')}/{el.get('id')}"},
            })
        # les fiches les plus riches en contacts d'abord
        results.sort(key=lambda r: -((2 if r["website"] else 0) + (3 if r["email"] else 0) + (1 if r["phone"] else 0)))
        return results[: p.limit]


provider = OSMProvider()