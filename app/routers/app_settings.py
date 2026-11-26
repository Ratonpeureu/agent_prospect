import socket
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.config import settings
from app.services.settings_store import checks, public_fields, save_updates

router = APIRouter(prefix="/api/settings", tags=["Configuration"])

SMTP_HOSTS = ["gmail-smtp-in.l.google.com", "mta5.am0.yahoodns.net", "outlook-com.olc.protection.outlook.com"]


class SettingsIn(BaseModel):
    values: dict[str, Any]


def _payload() -> dict:
    return {"fields": public_fields(), "checks": checks()}


@router.get("")
def get_settings():
    return _payload()


@router.put("")
def put_settings(body: SettingsIn):
    """Secrets : valeur vide = effacer ; clé absente = inchangé."""
    try:
        save_updates(body.values)
    except (ValueError, TypeError) as e:
        raise HTTPException(422, f"Valeur invalide : {e}")
    return _payload()


def _smtp_ping(host: str) -> dict:
    t = time.time()
    try:
        with socket.create_connection((host, 25), timeout=6) as s:
            s.settimeout(5)
            try:
                detail = s.recv(120).decode(errors="ignore").strip()[:80]
            except OSError:
                detail = "connecté (pas de bannière)"
        return {"name": host, "ok": True, "ms": int((time.time() - t) * 1000), "detail": detail}
    except OSError as e:
        return {"name": host, "ok": False, "ms": int((time.time() - t) * 1000), "detail": str(e)[:100]}


def _http_ping(name: str, url: str, **kw) -> dict:
    t = time.time()
    try:
        r = httpx.get(url, timeout=20, headers={"User-Agent": settings.USER_AGENT}, follow_redirects=True, **kw)
        return {"name": name, "ok": r.status_code == 200, "ms": int((time.time() - t) * 1000),
                "detail": f"HTTP {r.status_code}"}
    except httpx.HTTPError as e:
        return {"name": name, "ok": False, "ms": int((time.time() - t) * 1000), "detail": type(e).__name__}


@router.post("/test/{name}")
def run_test(name: str):
    if name == "smtp":
        with ThreadPoolExecutor(max_workers=5) as ex:
            results = list(ex.map(_smtp_ping, SMTP_HOSTS))
        ok = any(r["ok"] for r in results)
        return {"ok": ok, "results": results,
                "message": "Port 25 sortant disponible : la vérification SMTP fonctionnera." if ok else
                "Port 25 sortant bloqué : les emails resteront « inconnus ». Utilise un serveur qui autorise le port 25 (demande l'ouverture à ton hébergeur)."}

    if name == "sources":
        jobs = [
            ("OpenStreetMap Overpass", "https://overpass-api.de/api/status", {}),
            ("Overpass Afrique", "https://ovp.dresel.systems/api-af/interpreter",
             {"params": {"data": "[out:json][timeout:5];node(1);out;"}}),
            ("Wikidata SPARQL", "https://query.wikidata.org/sparql", {"params": {"query": "ASK {}", "format": "json"}}),
            ("GLEIF", "https://api.gleif.org/api/v1/lei-records", {"params": {"page[size]": 1}}),
            ("API Recherche d'entreprises (FR)", "https://recherche-entreprises.api.gouv.fr/search",
            
             {"params": {"q": "test", "per_page": 1}}),
            ("Banque mondiale (Socrata)", "https://finances.worldbank.org/resource/kdui-wcs3.json", {"params": {"$limit": 1}}),
            ("GDELT", "https://api.gdeltproject.org/api/v2/doc/doc",
             {"params": {"query": "test", "mode": "artlist", "format": "json", "maxrecords": 1}}),
            ("Common Crawl", "https://index.commoncrawl.org/collinfo.json", {}),
        ]
        with ThreadPoolExecutor(max_workers=8) as ex:
            results = list(ex.map(lambda j: _http_ping(j[0], j[1], **j[2]), jobs))
        return {"ok": all(r["ok"] for r in results), "results": results, "message": ""}

    if name == "companies_house":
        if not settings.COMPANIES_HOUSE_API_KEY:
            return {"ok": False, "results": [], "message": "Aucune clé enregistrée."}
        try:
            r = httpx.get("https://api.company-information.service.gov.uk/search/companies",
                          params={"q": "test", "items_per_page": 1}, auth=(settings.COMPANIES_HOUSE_API_KEY, ""),
                          timeout=20)
        except httpx.HTTPError as e:
            return {"ok": False, "results": [], "message": f"Connexion impossible : {type(e).__name__}"}
        msg = {200: "Clé valide.", 401: "Clé refusée (401). Vérifie qu'il s'agit d'une clé REST."}.get(
            r.status_code, f"Réponse HTTP {r.status_code}")
        return {"ok": r.status_code == 200, "results": [], "message": msg}

    if name == "insee_sirene":
        if not settings.INSEE_API_KEY:
            return {"ok": False, "results": [], "message": "Aucune clé enregistrée."}
        try:
            r = httpx.get("https://api.insee.fr/api-sirene/3.11/siret", params={"nombre": 1, "q": "siren:552032534"},
                          headers={"X-INSEE-Api-Key-Integration": settings.INSEE_API_KEY}, timeout=25)
        except httpx.HTTPError as e:
            return {"ok": False, "results": [], "message": f"Connexion impossible : {type(e).__name__}"}
        msg = {200: "Clé valide.", 401: "Clé refusée (401).",
               403: "Accès refusé (403) : abonne ta clé à l'API Sirene dans le portail INSEE."}.get(
            r.status_code, f"Réponse HTTP {r.status_code}")
        return {"ok": r.status_code == 200, "results": [], "message": msg}

    if name == "procurement":
        res = []
        t = time.time()
        try:
            r = httpx.get("https://finances.worldbank.org/resource/kdui-wcs3.json", params={"$limit": 1}, timeout=25)
            keys = ", ".join(list(r.json()[0].keys())[:14]) if r.status_code == 200 and r.json() else r.text[:120]
            res.append({"name": "Banque mondiale (champs réels)", "ok": r.status_code == 200,
                        "ms": int((time.time() - t) * 1000), "detail": keys})
        except (httpx.HTTPError, ValueError, IndexError) as e:
            res.append({"name": "Banque mondiale", "ok": False, "ms": int((time.time() - t) * 1000), "detail": type(e).__name__})
        t = time.time()
        try:
            r = httpx.post("https://api.ted.europa.eu/v3/notices/search",
                           json={"query": "notice-type=can-standard AND winner-country=FRA", "fields": ["winner-name", "winner-city"],
                                 "limit": 1, "page": 1, "scope": "ALL", "paginationMode": "PAGE_NUMBER"}, timeout=30)
            res.append({"name": "TED (champs winner-*)", "ok": r.status_code == 200,
                        "ms": int((time.time() - t) * 1000), "detail": f"HTTP {r.status_code} {r.text[:140]}"})
        except httpx.HTTPError as e:
            res.append({"name": "TED", "ok": False, "ms": int((time.time() - t) * 1000), "detail": type(e).__name__})
        return {"ok": all(x["ok"] for x in res), "results": res,
                "message": "Si TED échoue : le détail indique le champ invalide ; corrige F_NAME / F_COUNTRY / F_CITY dans providers/ted.py."}

    raise HTTPException(404, "Test inconnu")