import html
import re
from urllib.parse import unquote

import httpx

from app.config import settings
from app.services.normalize import EMAIL_RE

PATHS = ["", "/contact", "/contact-us", "/contactez-nous", "/nous-contacter",
         "/a-propos", "/about", "/about-us", "/mentions-legales"]
BAD_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js", ".woff", ".woff2", ".ico", ".pdf")
BAD_PARTS = ("sentry", "example.", "wixpress", "your@", "email@", "name@", "user@", "domain.", "@2x")
TEL_RE = re.compile(r"tel:([+\d][\d\s().\-]{5,20})", re.I)


def _emails(text: str) -> set[str]:
    text = html.unescape(unquote(text))
    out = set()
    for m in EMAIL_RE.findall(text):
        e = m.lower().strip(".")
        if e.endswith(BAD_EXT) or any(b in e for b in BAD_PARTS):
            continue
        out.add(e)
    return out


def crawl_site(website: str) -> dict:
    """Cherche emails et téléphones sur la page d'accueil et les pages contact."""
    base = website.rstrip("/")
    emails: set[str] = set()
    phones: set[str] = set()
    headers = {"User-Agent": settings.USER_AGENT, "Accept-Language": "fr,en;q=0.8"}
    try:
        with httpx.Client(follow_redirects=True, timeout=settings.CRAWL_TIMEOUT,
                          headers=headers, verify=False) as client:
            for i, path in enumerate(PATHS):
                try:
                    r = client.get(base + path)
                except httpx.HTTPError:
                    if i == 0:
                        break
                    continue
                if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
                    continue
                body = r.text[:600_000]
                emails |= _emails(body)
                phones |= {p.strip() for p in TEL_RE.findall(body)}
                if len(emails) >= 3:
                    break
    except Exception:
        pass
    return {"emails": sorted(emails)[:5], "phones": sorted(phones)[:2]}