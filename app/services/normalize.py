import re
import unicodedata
from urllib.parse import urlparse

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")

LEGAL_WORDS = {"sa", "sarl", "sas", "sasu", "eurl", "ltd", "llc", "inc", "gmbh", "suarl", "gie", "ets", "corp", "co"}

ROLE_LOCALS = {
    "info", "contact", "admin", "administrator", "support", "sales", "hello", "office", "mail",
    "postmaster", "webmaster", "noreply", "no-reply", "donotreply", "abuse", "billing", "help",
    "service", "team", "marketing", "jobs", "careers", "rh", "hr", "commercial", "direction",
    "accueil", "reception", "secretariat", "comptabilite", "reservation", "reservations",
}

FREE_DOMAINS = {
    "gmail.com", "yahoo.com", "yahoo.fr", "hotmail.com", "hotmail.fr", "outlook.com", "outlook.fr",
    "live.com", "live.fr", "icloud.com", "me.com", "aol.com", "protonmail.com", "proton.me",
    "gmx.com", "gmx.fr", "orange.fr", "free.fr", "sfr.fr", "wanadoo.fr", "laposte.net",
    "msn.com", "yahoo.co.uk", "mail.com", "zoho.com", "yandex.com",
}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def normalize_name(name: str | None) -> str:
    if not name:
        return ""
    s = strip_accents(name).lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    words = [w for w in s.split() if w not in LEGAL_WORDS]
    return " ".join(words)


def extract_domain(value: str | None) -> str | None:
    if not value:
        return None
    v = value.strip().lower()
    if "@" in v and "/" not in v:
        host = v.split("@")[-1]
    else:
        if not v.startswith(("http://", "https://")):
            v = "http://" + v
        host = urlparse(v).netloc.split(":")[0]
    host = host.removeprefix("www.").strip(".")
    return host or None


def ensure_url(value: str | None) -> str | None:
    if not value:
        return None
    v = value.strip()
    if not v:
        return None
    return v if v.startswith(("http://", "https://")) else "https://" + v


def guess_name_from_email(email: str) -> tuple[str | None, str | None]:
    local = email.split("@")[0].lower()
    if local in ROLE_LOCALS:
        return None, None
    parts = [p for p in re.split(r"[._\-]+", local) if p.isalpha() and len(p) > 1]
    if len(parts) >= 2:
        return parts[0].title(), parts[-1].title()
    return None, None