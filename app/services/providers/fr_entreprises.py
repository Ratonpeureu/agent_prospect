import re
import time

import httpx

from app.config import settings
from app.services.presets import find_preset
from app.services.providers.base import Provider, SearchParams

BASE = "https://recherche-entreprises.api.gouv.fr/search"
GEO = "https://geo.api.gouv.fr/communes"

EFFECTIF = {"00": "0", "01": "1-2", "02": "3-5", "03": "6-9", "11": "10-19", "12": "20-49", "21": "50-99",
            "22": "100-199", "31": "200-249", "32": "250-499", "41": "500-999", "42": "1000-1999",
            "51": "2000-4999", "52": "5000-9999", "53": "10000+"}


def _location_params(loc: str) -> dict:
    loc = (loc or "").strip()
    if not loc:
        return {}
    if re.fullmatch(r"\d{5}", loc):
        return {"code_postal": loc}
    if re.fullmatch(r"\d{2,3}|2[AaBb]", loc):
        return {"departement": loc.upper()}
    try:
        r = httpx.get(GEO, params={"nom": loc, "fields": "code", "boost": "population", "limit": 1},
                      timeout=15, headers={"User-Agent": settings.USER_AGENT})
        if r.status_code == 200 and r.json():
            return {"code_commune": r.json()[0]["code"]}
    except (httpx.HTTPError, ValueError, KeyError, IndexError):
        pass
    return {"_q_extra": loc}


class FrEntreprisesProvider(Provider):
    name = "fr_recherche_entreprises"
    label = "France - API Recherche d'entreprises"
    description = "Base SIRENE/RNE ouverte (data.gouv) : toutes les entreprises françaises, dirigeants, NAF, effectif. Sans clé."
    countries = {"FR"}
    filters = {
        "naf": "code(s) NAF, ex ['62.01Z','62.02A'] (sinon déduits du secteur)",
        "effectif": "tranche(s) INSEE, ex '11,12,21' (10-19, 20-49, 50-99)",
        "categorie": "PME | ETI | GE",
        "departement": "ex '75', '2A'", "code_postal": "ex '69001'", "region": "code région INSEE",
        "etat": "A (actif, défaut) | C (cessé)",
        "nature_juridique": "code catégorie juridique, ex '5710' (SAS)",
        "ess": "true = économie sociale et solidaire",
        "officers": "true (défaut) pour garder les dirigeants personnes physiques",
    }

    def search(self, p: SearchParams) -> list[dict]:
        params: dict = {"per_page": 25, "etat_administratif": p.filters.get("etat", "A")}
        pre = find_preset(p.query)
        naf = p.filters.get("naf")
        if isinstance(naf, list):
            naf = ",".join(naf)
        if not naf and pre and pre[1]["naf"]:
            naf = ",".join(pre[1]["naf"])
        if naf:
            params["activite_principale"] = naf
        q_parts = []
        if p.query and not naf:
            q_parts.append(p.query)

        loc = _location_params(p.location)
        q_extra = loc.pop("_q_extra", None)
        if q_extra:
            q_parts.append(q_extra)
        params.update(loc)
        for fkey, api in (("effectif", "tranche_effectif_salarie"), ("categorie", "categorie_entreprise"),
                          ("departement", "departement"), ("code_postal", "code_postal"),
                          ("region", "region"), ("nature_juridique", "nature_juridique")):
            if p.filters.get(fkey):
                params[api] = p.filters[fkey]
        if str(p.filters.get("ess", "")).lower() in ("1", "true", "yes"):
            params["est_ess"] = "true"
        if q_parts:
            params["q"] = " ".join(q_parts)
        if not any(k in params for k in ("q", "activite_principale", "code_postal", "departement",
                                         "code_commune", "region", "tranche_effectif_salarie",
                                         "categorie_entreprise", "nature_juridique", "est_ess")):
            return []

        keep_officers = str(p.filters.get("officers", "true")).lower() not in ("0", "false", "no")
        out: list[dict] = []
        page = 1
        with httpx.Client(timeout=settings.PROVIDER_TIMEOUT, headers=self.headers()) as client:
            while len(out) < p.limit:
                try:
                    r = client.get(BASE, params={**params, "page": page})
                except httpx.HTTPError:
                    break
                if r.status_code == 429:
                    time.sleep(1.5)
                    continue
                if r.status_code != 200:
                    break
                data = r.json()
                for it in data.get("results", []):
                    siege = it.get("siege") or {}
                    officers = []
                    if keep_officers:
                        for d in it.get("dirigeants") or []:
                            if d.get("type_dirigeant") == "personne physique" and d.get("nom"):
                                officers.append({"first_name": (d.get("prenoms") or "").split(",")[0].title(),
                                                 "last_name": (d.get("nom") or "").title(),
                                                 "role": d.get("qualite")})
                    out.append({
                        "name": it.get("nom_complet") or it.get("nom_raison_sociale"),
                        "legal_id": it.get("siren"), "country": "FR",
                        "address": siege.get("adresse"),
                        "city": (siege.get("libelle_commune") or "").title() or None,
                        "sector": pre[1]["label"] if pre else (it.get("activite_principale") or None),
                        "source": self.name,
                        "extra": {"naf": it.get("activite_principale"), "legal_form": it.get("nature_juridique"),
                                  "employees": EFFECTIF.get(it.get("tranche_effectif_salarie") or ""),
                                  "category": it.get("categorie_entreprise"),
                                  "creation_date": it.get("date_creation"),
                                  "status": it.get("etat_administratif"), "officers": officers},
                    })
                    if len(out) >= p.limit:
                        break
                if page >= data.get("total_pages", 1) or not data.get("results"):
                    break
                page += 1
                time.sleep(0.2)  # limite : 7 requêtes/seconde
        return [c for c in out if c.get("name")]


provider = FrEntreprisesProvider()