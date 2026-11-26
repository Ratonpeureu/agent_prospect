"""Sources publiques de personnes hors site de l'entreprise : web, profils (titres de résultats), GitHub."""
import html
import re
import threading
import time

import httpx

from app.config import settings
from app.services import applog
from app.services import people as P
from app.services.normalize import EMAIL_RE, extract_domain, guess_name_from_email, normalize_name, strip_accents
from app.services.sources import ddg

log = applog.get("people")
SKIP_HOSTS = ("linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com", "wikipedia.org")
_gh_lock = threading.Lock()
_gh_last = 0.0


def web_exposed(domain: str) -> list[dict]:
    """Emails @domaine publiés sur d'autres sites (annuaires, actualités, PDF HTML...)."""
    out: dict[str, dict] = {}
    fetched = 0
    headers = {"User-Agent": settings.USER_AGENT, "Accept-Language": "fr,en;q=0.8"}
    with httpx.Client(timeout=8, follow_redirects=True, verify=False, headers=headers) as c:
        for _title, url in ddg.search(f'"@{domain}"', pages=1):
            host = extract_domain(url) or ""
            if host == domain or host.endswith("." + domain) or any(host.endswith(h) for h in SKIP_HOSTS):
                continue
            if fetched >= 5:
                break
            fetched += 1
            try:
                r = c.get(url)
            except httpx.HTTPError:
                continue
            if r.status_code != 200 or "text" not in r.headers.get("content-type", ""):
                continue
            text = html.unescape(r.text[:300_000])
            for e in set(EMAIL_RE.findall(text)):
                e = e.lower().strip(".")
                if not e.endswith("@" + domain) or e in out:
                    continue
                first, last = guess_name_from_email(e)
                p = P.person(f"{first} {last}") if first and last else P.blank()
                p.update(email=e, source="web_public", evidence=url)
                out[e] = p
    return list(out.values())


def _company_in(text: str, sig: list[str]) -> bool:
    t = strip_accents(text).lower()
    return bool(sig) and sum(1 for s in sig if s in t) / len(sig) >= 0.6


def profiles(name: str, titles: list[str]) -> list[dict]:
    """Nom + poste + lien de profil lus dans les TITRES de résultats d'un moteur de recherche (aucun accès à LinkedIn)."""
    sig = [t for t in normalize_name(name).split() if len(t) >= 3]
    base = f'site:linkedin.com/in "{name}"'
    queries = [f"{base} {t}" for t in titles[:3]] or [base, f"{base} directeur", f"{base} manager"]
    out: dict[str, dict] = {}
    for q in queries[:3]:
        for title, url in ddg.search(q, pages=1):
            if "linkedin.com/in/" not in url:
                continue
            t = html.unescape(title or "")
            t = re.sub(r"\s*[|·-]\s*LinkedIn.*$", "", t, flags=re.I)
            parts = [x.strip() for x in re.split(r"\s+[-–—]\s+", t) if x.strip()]
            if len(parts) < 2 or not P.looks_like_name(parts[0]) or not _company_in(" ".join(parts[1:]), sig):
                continue
            job = re.split(r"\s+(?:chez|at|@)\s+", parts[1])[0]
            p = P.person(parts[0], job if P.is_title(job) else None,
                         profile_url=url.split("?")[0], source="profiles", evidence=url)
            out.setdefault(P.slug(p["first_name"]) + P.slug(p["last_name"]), p)
    return list(out.values())


def github(domain: str) -> list[dict]:
    """EXPÉRIMENTAL : développeurs dont l'email public GitHub est @domaine."""
    global _gh_last
    headers = {"Accept": "application/vnd.github+json", "User-Agent": settings.USER_AGENT}
    if settings.GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {settings.GITHUB_TOKEN}"
    gap = 2.5 if settings.GITHUB_TOKEN else 7.0  # sans clé : 10 recherches / minute
    out: list[dict] = []
    with _gh_lock:
        time.sleep(max(0.0, gap - (time.time() - _gh_last)))
        _gh_last = time.time()
        with httpx.Client(timeout=15, headers=headers) as c:
            r = c.get("https://api.github.com/search/users", params={"q": f"{domain} in:email", "per_page": 10})
            if r.status_code != 200:
                return []
            for u in r.json().get("items", [])[:8]:
                d = c.get(u["url"])
                if d.status_code != 200:
                    continue
                j = d.json()
                email = (j.get("email") or "").lower()
                if not email.endswith("@" + domain) or not j.get("name") or not P.looks_like_name(j["name"]):
                    continue
                out.append(P.person(j["name"], None, email=email, profile_url=j.get("html_url"),
                                    source="github", evidence=j.get("html_url")))
    return out


def fetch(name: str, domain: str | None, country: str | None, cfg: dict) -> list[dict]:
    out: list[dict] = []
    s = cfg["sources"]
    steps = []
    if "web" in s and domain:
        steps.append(("web", lambda: web_exposed(domain)))
    if "profiles" in s:
        steps.append(("profiles", lambda: profiles(name, cfg["titles"])))
    if "github" in s and domain:
        steps.append(("github", lambda: github(domain)))
    for label, fn in steps:
        try:
            with applog.timed(log, f"people:{label}", name):
                res = fn()
            log.info("EVENT people.source name=%s company=%r results=%d", label, name, len(res))
            out += res
        except Exception:  # noqa: BLE001
            log.warning("Source personnes %s échouée pour %r", label, name, exc_info=True)
    return out