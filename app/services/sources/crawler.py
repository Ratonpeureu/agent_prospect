import html
import json
import re
from urllib.parse import unquote, urljoin, urlparse

import httpx

from app.config import settings
from app.services.normalize import EMAIL_RE, FREE_DOMAINS, extract_domain

STATIC_PATHS = ["/contact", "/contact-us", "/contactez-nous", "/nous-contacter", "/contacts", "/contact.html",
                "/contact.php", "/fr/contact", "/en/contact", "/a-propos", "/about", "/about-us", "/qui-sommes-nous",
                "/equipe", "/notre-equipe", "/team", "/our-team", "/partenaires", "/mentions-legales", "/legal"]
LINK_HINTS = ("contact", "equipe", "team", "propos", "about", "mention", "legal", "partenaire", "joindre",
              "direction", "staff", "management", "qui-sommes")
BAD_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js", ".woff", ".woff2", ".ico", ".pdf",
           ".zip", ".mp4", ".doc", ".docx", ".xls", ".xlsx")
BAD_PARTS = ("sentry", "example.", "wixpress", "your@", "email@", "name@", "user@", "domain.", "@2x", "noreply",
             "no-reply")
MAX_PAGES = 12

TEL_RE = re.compile(r"tel:([+\d][\d\s().\-]{5,20})", re.I)
INTL_RE = re.compile(r"(?<![\w/])\+\d{1,3}[\s.\-]?(?:\(?\d{1,4}\)?[\s.\-]?){2,5}\d")
CF_RE = re.compile(r'data-cfemail="([0-9a-fA-F]{6,})"|/cdn-cgi/l/email-protection#([0-9a-fA-F]{6,})')
SPAN_AT = re.compile(r"<[^>]*>\s*@\s*</[^>]*>")
AT_BRACKET = re.compile(r"\s*[\[\(\{]\s*(?:at|arobase)\s*[\]\)\}]\s*", re.I)
DOT_BRACKET = re.compile(r"\s*[\[\(\{]\s*(?:dot|point)\s*[\]\)\}]\s*", re.I)
SPACED = re.compile(r"\b([\w.+\-]+)\s+(?:at|arobase)\s+([\w\-]+(?:\s+(?:dot|point)\s+[\w\-]+)+)\b", re.I)
SPACED_DOT = re.compile(r"\s+(?:dot|point)\s+", re.I)
JS_CONCAT = re.compile(r"""['"]([\w.+\-]+)['"]\s*\+\s*['"]@['"]\s*\+\s*['"]([\w.\-]+)['"]""")
LD_RE = re.compile(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', re.S | re.I)
A_RE = re.compile(r'<a\b[^>]*href=["\']([^"\'#]+)["\'][^>]*>(.*?)</a>', re.S | re.I)


def _cf_decode(h: str) -> str:
    try:
        k = int(h[:2], 16)
        return "".join(chr(int(h[i:i + 2], 16) ^ k) for i in range(2, len(h), 2))
    except ValueError:
        return ""


def _deobfuscate(text: str) -> str:
    extra = " ".join(_cf_decode(m.group(1) or m.group(2)) for m in CF_RE.finditer(text))
    text = SPAN_AT.sub("@", text)
    text = AT_BRACKET.sub("@", text)
    text = DOT_BRACKET.sub(".", text)
    text = SPACED.sub(lambda m: f"{m.group(1)}@{SPACED_DOT.sub('.', m.group(2))}", text)
    text = JS_CONCAT.sub(lambda m: f"{m.group(1)}@{m.group(2)}", text)
    return text + " " + extra


def _ok(e: str) -> bool:
    e = e.lower().strip(".")
    return not (e.endswith(BAD_EXT) or any(b in e for b in BAD_PARTS))


def _walk(o, emails: set, phones: set) -> None:
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "email" and isinstance(v, str):
                emails.add(v.replace("mailto:", "").strip().lower())
            elif k == "telephone" and isinstance(v, str):
                phones.add(v.strip())
            else:
                _walk(v, emails, phones)
    elif isinstance(o, list):
        for x in o:
            _walk(x, emails, phones)


def _collect(body: str, emails: set, phones: set) -> None:
    body = body[:600_000]
    for m in LD_RE.finditer(body):
        try:
            _walk(json.loads(m.group(1)), emails, phones)
        except ValueError:
            pass
    text = _deobfuscate(html.unescape(unquote(body)))
    emails |= {e.lower().strip(".") for e in EMAIL_RE.findall(text) if _ok(e)}
    phones |= {p.strip() for p in TEL_RE.findall(body)}
    phones |= {re.sub(r"\s+", " ", p).strip() for p in INTL_RE.findall(html.unescape(body)) if 8 <= len(re.sub(r"\D", "", p)) <= 15}


def _host(netloc: str) -> str:
    return netloc.lower().split(":")[0].removeprefix("www.")


def _links(base_url: str, body: str, host: str) -> list[str]:
    out: list[str] = []
    for m in A_RE.finditer(body[:600_000]):
        href, label = m.group(1).strip(), re.sub(r"<[^>]+>", " ", m.group(2)).lower()
        if href.lower().startswith(("mailto:", "tel:", "javascript:")):
            continue
        url = urljoin(base_url, href)
        pu = urlparse(url)
        if pu.scheme not in ("http", "https") or _host(pu.netloc) != host or pu.path.lower().endswith(BAD_EXT):
            continue
        if any(h in unquote(pu.path.lower()) + " " + label for h in LINK_HINTS) and url not in out:
            out.append(url)
    return out[:8]


def _same(domain: str, host: str) -> bool:
    return domain == host or domain.endswith("." + host) or host.endswith("." + domain)


def _rank(emails: set, host: str) -> list[str]:
    dom = lambda e: e.rsplit("@", 1)[-1]  # noqa: E731
    same = sorted(e for e in emails if "@" in e and _same(dom(e), host))
    free = sorted(e for e in emails if "@" in e and dom(e) in FREE_DOMAINS)
    return (same + free)[:5]


def _get(client: httpx.Client, url: str):
    try:
        r = client.get(url)
    except httpx.HTTPError:
        return None
    if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
        return None
    return r


def crawl_site(website: str) -> dict:
    """Cherche emails et téléphones : accueil, pages détectées (contact, équipe, mentions...) puis chemins classiques."""
    base = website.rstrip("/")
    host = extract_domain(base) or ""
    emails: set[str] = set()
    phones: set[str] = set()
    headers = {"User-Agent": settings.USER_AGENT, "Accept-Language": "fr,en;q=0.8"}
    try:
        with httpx.Client(follow_redirects=True, timeout=settings.CRAWL_TIMEOUT, headers=headers, verify=False) as client:
            home = _get(client, base)
            if home is None:
                return {"emails": [], "phones": []}
            _collect(home.text, emails, phones)
            queue = _links(str(home.url), home.text, host) + [base + p for p in STATIC_PATHS]
            seen, tried = {base, base + "/", str(home.url).rstrip("/")}, 1
            for url in queue:
                if tried >= MAX_PAGES or len([e for e in emails if _same(e.rsplit("@", 1)[-1], host)]) >= 3:
                    break
                if url.rstrip("/") in seen:
                    continue
                seen.add(url.rstrip("/"))
                tried += 1
                r = _get(client, url)
                if r is not None:
                    _collect(r.text, emails, phones)
    except Exception:  # noqa: BLE001
        pass
    return {"emails": _rank(emails, host), "phones": sorted(phones)[:2]}