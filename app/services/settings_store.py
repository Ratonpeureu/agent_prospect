import json
import os

from app.config import settings

FIELDS = [
    dict(key="CONTACT_EMAIL", group="Identité", label="Email de contact", type="text",
         placeholder="toi@tondomaine.com",
         help="Inclus dans le User-Agent des requêtes vers Wikidata, GLEIF, OpenStreetMap, etc. (bonne pratique, évite les blocages)."),
    dict(key="COMPANIES_HOUSE_API_KEY", group="Clés API gratuites", label="Companies House (Royaume-Uni)",
         type="secret", test="companies_house", url="https://developer.company-information.service.gov.uk/",
         help="Registre officiel britannique. Crée un compte développeur puis une clé « REST »."),
    dict(key="INSEE_API_KEY", group="Clés API gratuites", label="INSEE SIRENE (France)",
         type="secret", test="insee_sirene", url="https://portail-api.insee.fr/",
         help="API SIRENE officielle (30 requêtes/minute). Optionnelle : l'API Recherche d'entreprises fonctionne sans clé."),
    dict(key="SMTP_CHECK_ENABLED", group="Vérification d'emails", label="Activer le test SMTP", type="bool",
         help="Interroge le serveur mail du destinataire (sans envoyer de message). Nécessite le port 25 sortant."),
    dict(key="SMTP_HELO_DOMAIN", group="Vérification d'emails", label="Domaine HELO", type="text",
         placeholder="tondomaine.com", help="Un domaine qui t'appartient, idéalement le reverse DNS de ton serveur."),
    dict(key="SMTP_MAIL_FROM", group="Vérification d'emails", label="Expéditeur MAIL FROM", type="text",
         placeholder="verify@tondomaine.com", help="Adresse utilisée dans la conversation SMTP."),
    dict(key="SMTP_TIMEOUT", group="Vérification d'emails", label="Timeout SMTP (s)", type="int", min=3, max=60,
         help="Délai maximum par connexion SMTP."),
    dict(key="VERIFY_WORKERS", group="Vérification d'emails", label="Vérifications en parallèle", type="int",
         min=1, max=100, help="Plus = plus rapide, mais plus de risque d'être limité par les serveurs mail."),
    dict(key="DISCOVERY_MAX_ROLE", group="Découverte d'emails", label="Adresses génériques testées", type="int",
         min=1, max=7, help="Nombre de préfixes testés par domaine (contact, info, commercial, direction, hello, accueil, admin)."),
    dict(key="PROVIDER_TIMEOUT", group="Moteur de recherche", label="Timeout des sources (s)", type="int",
         min=10, max=300, help="Délai maximum d'une requête vers une source de données."),
    dict(key="PROVIDER_WORKERS", group="Moteur de recherche", label="Sources en parallèle", type="int", min=1, max=10,
         help="Nombre de sources interrogées en même temps."),
    dict(key="CRAWL_TIMEOUT", group="Moteur de recherche", label="Timeout lecture des sites (s)", type="int",
         min=3, max=60, help="Délai par page lue (pages d'accueil et contact)."),
    dict(key="CRAWL_WORKERS", group="Moteur de recherche", label="Sites lus en parallèle", type="int", min=1, max=32,
         help="Nombre de sites web lus simultanément."),

    dict(key="BRAVE_API_KEY", group="Clés API gratuites", label="Brave Search (recherche de sites web)",
         type="secret", test="brave", url="https://brave.com/search/api/",
         help="Retrouve le site officiel des entreprises qui n'en ont pas. Vérifie le quota gratuit actuel."),
    dict(key="GOOGLE_PLACES_API_KEY", group="Clés API gratuites", label="Google Places (sites, téléphones)",
         type="secret", test="google_places", url="https://console.cloud.google.com/apis/library/places.googleapis.com",
         help="Très bonne couverture en Afrique. Quota gratuit limité puis payant : vérifie la grille tarifaire."),
    dict(key="SITE_FINDER_ENABLED", group="Découverte d'emails", label="Rechercher les sites manquants", type="bool",
         help="À l'enrichissement, cherche le site web des entreprises qui n'en ont pas."),
         
]
BY_KEY = {f["key"]: f for f in FIELDS}


def _path() -> str:
    return os.path.join(settings.DATA_DIR, "settings.json")


def _coerce(f: dict, v):
    t = f["type"]
    if t == "bool":
        return v if isinstance(v, bool) else str(v).strip().lower() in ("1", "true", "yes", "on")
    if t == "int":
        n = int(v)
        return max(f.get("min", 1), min(f.get("max", 1000), n))
    return str(v).strip()


def _read() -> dict:
    try:
        with open(_path(), encoding="utf-8") as fh:
            data = json.load(fh)
            return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def load_overrides() -> None:
    """Appelé au démarrage : applique settings.json par-dessus le .env."""
    for k, v in _read().items():
        f = BY_KEY.get(k)
        if not f:
            continue
        try:
            setattr(settings, k, _coerce(f, v))
        except (ValueError, TypeError):
            continue


def save_updates(updates: dict) -> None:
    stored = _read()
    for k, v in updates.items():
        f = BY_KEY.get(k)
        if not f:
            continue
        val = _coerce(f, v)  # lève ValueError si invalide
        setattr(settings, k, val)
        stored[k] = val
    os.makedirs(settings.DATA_DIR, exist_ok=True)
    tmp = _path() + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(stored, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, _path())


def public_fields() -> list[dict]:
    out = []
    for f in FIELDS:
        v = getattr(settings, f["key"], "")
        if f["type"] == "secret":
            out.append({**f, "value": "", "is_set": bool(v)})
        else:
            out.append({**f, "value": v, "is_set": bool(v)})
    return out


def checks() -> list[dict]:
    return [
        {"id": "contact_email", "label": "Email de contact renseigné", "optional": False,
         "ok": bool(settings.CONTACT_EMAIL) and "example.com" not in settings.CONTACT_EMAIL},
        {"id": "smtp_domain", "label": "Domaine SMTP (HELO / MAIL FROM) personnalisé", "optional": False,
         "ok": "example.com" not in settings.SMTP_HELO_DOMAIN and "example.com" not in settings.SMTP_MAIL_FROM},
        {"id": "smtp_enabled", "label": "Test SMTP activé", "optional": False, "ok": settings.SMTP_CHECK_ENABLED},
        {"id": "companies_house", "label": "Clé Companies House (Royaume-Uni)", "optional": True,
         "ok": bool(settings.COMPANIES_HOUSE_API_KEY)},
        {"id": "insee", "label": "Clé INSEE SIRENE (France)", "optional": True, "ok": bool(settings.INSEE_API_KEY)},
    ]