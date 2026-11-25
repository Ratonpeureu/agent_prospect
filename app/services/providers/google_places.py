import time

import httpx

from app.config import settings
from app.services.countries import EN_NAMES
from app.services.presets import find_preset
from app.services.providers.base import Provider, SearchParams

URL = "https://places.googleapis.com/v1/places:searchText"
MASK = ("places.displayName,places.websiteUri,places.internationalPhoneNumber,"
        "places.formattedAddress,nextPageToken")


class GooglePlacesProvider(Provider):
    name = "google_places"
    label = "Google Places"
    description = "Commerces et entreprises avec site web et téléphone. Meilleure couverture en Afrique. Clé requise, payant au-delà du quota gratuit."
    countries = None
    key_env = "GOOGLE_PLACES_API_KEY"
    signup_url = "https://console.cloud.google.com/apis/library/places.googleapis.com"
    filters = {"pages": "pages de 20 résultats (1 à 3, défaut 3)"}

    def search(self, p: SearchParams) -> list[dict]:
        if not (p.query or p.location):
            return []
        pre = find_preset(p.query)
        text = " ".join(x for x in (p.query, p.location, EN_NAMES.get(p.country or "", "")) if x)
        headers = {**self.headers(), "X-Goog-Api-Key": settings.GOOGLE_PLACES_API_KEY, "X-Goog-FieldMask": MASK}
        pages = max(1, min(3, int(p.filters.get("pages", 3) or 3)))
        out, token = [], None
        with httpx.Client(timeout=settings.PROVIDER_TIMEOUT, headers=headers) as c:
            for _ in range(pages):
                body = {"textQuery": text, "pageSize": 20, "languageCode": "fr"}
                if p.country:
                    body["regionCode"] = p.country
                if token:
                    body["pageToken"] = token
                try:
                    r = c.post(URL, json=body)
                    if r.status_code != 200:
                        raise RuntimeError(f"Google Places HTTP {r.status_code} : {r.text[:200]}")
                    data = r.json()
                except (httpx.HTTPError, ValueError):
                    break
                for pl in data.get("places", []):
                    name = (pl.get("displayName") or {}).get("text")
                    if name:
                        out.append({"name": name, "website": pl.get("websiteUri"),
                                    "phone": pl.get("internationalPhoneNumber"), "address": pl.get("formattedAddress"),
                                    "city": p.location or None, "country": p.country,
                                    "sector": pre[1]["label"] if pre else (p.query or None), "source": self.name})
                token = data.get("nextPageToken")
                if not token or len(out) >= p.limit:
                    break
                time.sleep(1.5)
        return out[: p.limit]


provider = GooglePlacesProvider()