import time

import httpx

from app.config import settings
from app.services.normalize import strip_accents
from app.services.presets import find_preset
from app.services.providers.base import Provider, SearchParams

URL = "https://api.insee.fr/api-sirene/3.11/siret"


class InseeSireneProvider(Provider):
    name = "insee_sirene"
    label = "France - API SIRENE (INSEE)"
    description = "Établissements SIRENE officiels (clé gratuite, 30 requêtes/min). Complément de l'API Recherche d'entreprises pour les gros volumes."
    countries = {"FR"}
    key_env = "INSEE_API_KEY"
    signup_url = "https://portail-api.insee.fr/"
    filters = {
        "naf": "code(s) NAF établissement (sinon déduits du secteur)",
        "effectif": "tranche(s) effectif unité légale, ex ['11','12']",
        "code_postal": "préfixe de code postal, ex '75' ou '69001'",
        "siege_only": "true (défaut) = uniquement les sièges",
    }

    def search(self, p: SearchParams) -> list[dict]:
        pre = find_preset(p.query)
        naf = p.filters.get("naf")
        if isinstance(naf, str):
            naf = [naf]
        if not naf and pre:
            naf = pre[1]["naf"]

        parts = ["etatAdministratifEtablissement:A"]
        if str(p.filters.get("siege_only", "true")).lower() not in ("0", "false", "no"):
            parts.append("etablissementSiege:true")
        if naf:
            parts.append("(" + " OR ".join(f'activitePrincipaleEtablissement:"{c}"' for c in naf) + ")")
        eff = p.filters.get("effectif")
        if eff:
            eff = [eff] if isinstance(eff, str) else eff
            parts.append("(" + " OR ".join(f"trancheEffectifsUniteLegale:{e}" for e in eff) + ")")
        cp = p.filters.get("code_postal")
        loc = (p.location or "").strip()
        if cp:
            parts.append(f"codePostalEtablissement:{cp}*")
        elif loc.isdigit():
            parts.append(f"codePostalEtablissement:{loc}*")
        elif loc:
            city = strip_accents(loc).upper().replace('"', "")
            parts.append(f'libelleCommuneEtablissement:"{city}"')
        if p.query and not naf:
            parts.append(f'denominationUniteLegale:{strip_accents(p.query).replace(" ", "?").replace(chr(34), "")}*')
        if len(parts) <= 2 and not (naf or cp or loc or p.query):
            return []

        headers = {**self.headers(), "X-INSEE-Api-Key-Integration": settings.INSEE_API_KEY,
                   "Accept": "application/json"}
        out: list[dict] = []
        cursor = "*"
        with httpx.Client(timeout=settings.PROVIDER_TIMEOUT, headers=headers) as client:
            while len(out) < p.limit:
                params = {"q": " AND ".join(parts), "nombre": min(p.limit - len(out), 1000), "curseur": cursor}
                try:
                    r = client.get(URL, params=params)
                except httpx.HTTPError:
                    break
                if r.status_code != 200:
                    break
                data = r.json()
                for e in data.get("etablissements", []):
                    ul = e.get("uniteLegale") or {}
                    ad = e.get("adresseEtablissement") or {}
                    name = (ul.get("denominationUniteLegale")
                            or " ".join(x for x in (ul.get("prenomUsuelUniteLegale"), ul.get("nomUniteLegale")) if x))
                    street = " ".join(x for x in (ad.get("numeroVoieEtablissement"), ad.get("typeVoieEtablissement"),
                                                   ad.get("libelleVoieEtablissement")) if x)
                    out.append({
                        "name": (name or "").title(), "legal_id": e.get("siren"), "country": "FR",
                        "address": ", ".join(x for x in (street, ad.get("codePostalEtablissement")) if x) or None,
                        "city": (ad.get("libelleCommuneEtablissement") or "").title() or None,
                        "sector": pre[1]["label"] if pre else ul.get("activitePrincipaleUniteLegale"),
                        "source": self.name,
                        "extra": {"naf": ul.get("activitePrincipaleUniteLegale"),
                                  "legal_form": ul.get("categorieJuridiqueUniteLegale"),
                                  "employees": ul.get("trancheEffectifsUniteLegale"),
                                  "creation_date": ul.get("dateCreationUniteLegale"), "siret": e.get("siret")},
                    })
                nxt = (data.get("header") or {}).get("curseurSuivant")
                if not data.get("etablissements") or not nxt or nxt == cursor:
                    break
                cursor = nxt
                time.sleep(2.2)  # limite open data : 30 requêtes/minute
        return [c for c in out if c["name"]][: p.limit]


provider = InseeSireneProvider()