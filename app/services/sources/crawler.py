import html
import json
import re
from urllib.parse import unquote, urljoin, urlparse

import httpx

from app.config import settings
from app.services import people as P
from app.services.normalize import EMAIL_RE, FREE_DOMAINS, extract_domain

STATIC_PATHS = ["/contact", "/contact-us", "/contactez-nous", "/nous-contacter", "/contacts", "/contact.html",
                "/contact.php", "/fr/contact", "/en/contact", "/a-propos", "/about", "/about-us", "/qui-sommes-nous",
                "/equipe", "/notre-equipe", "/team", "/our-team", "/partenaires", "/mentions-legales", "/legal"]
TEAM_PATHS = ["/management", "/direction", "/la-direction", "/notre-direction", "/leadership", "/our-leadership",
              "/nos-equipes", "/nos-experts", "/experts", "/staff", "/people", "/organigramme", "/gouvernance",
              "/conseil-administration", "/board", "/en/team", "/fr/equipe", "/about-us/team",
              "/qui-sommes-nous/equipe"]
LINK_HINTS = ("contact", "equipe", "team", "propos", "about", "mention", "legal", "partenaire", "joindre",
              "direction", "staff", "management", "qui-sommes", "leadership", "experts", "organigramme",
              "gouvernance", "board", "people", "dirigeants")
SITEMAP_HINTS = ("team", "equipe", "management", "direction", "leadership", "staff", "people", "about", "propos",
                 "organigramme", "gouvernance", "experts", "dirigeants", "board")
BAD_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js", ".woff", ".woff2", ".ico", ".pdf",
           ".zip", ".mp4", ".doc", ".docx", ".xls", ".xlsx")
BAD_PARTS = ("sentry", "example.", "wixpress", "your@", "email@", "name@", "user@", "domain.", "@2x", "noreply",
             "no-reply")
MAX_PAGES = 12
MAX_PAGES_PEOPLE = 16
MAX_BODY = 250_000

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
MAILTO_RE = re.compile(r'<a\b[^>]*href=["\']mailto:([^"\'?]+)[^>]*>(.*?)</a>', re.S | re.I)
LI_RE = re.compile(r"https?://(?:[\w\-]+\.)?linkedin\.com/in/[\w\-%]+", re.I)
SKIP_BLOCKS = re.compile(r"<(script|style|noscript|svg)\b.*?</\1>|<!--.*?-->", re.S | re.I)
LD_PEOPLE_KEYS = {"employee", "employees", "founder", "founders", "member", "members", "legalRepresentative", "owner"}


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


def _walk_people(o, out: list, key=None) -> None:
    """Personnes en JSON-LD. Un auteur d'article est ignoré : il faut un jobTitle ou un rôle employé/fondateur."""
    if isinstance(o, dict):
        t = o.get("@type")
        types = t if isinstance(t, list) else [t]
        name = o.get("name")
        if "Person" in types and isinstance(name, str) and P.looks_like_name(name):
            job = o.get("jobTitle") if isinstance(o.get("jobTitle"), str) else None
            if job or key in LD_PEOPLE_KEYS:
                same = o.get("sameAs")
                cands = (same if isinstance(same, list) else [same]) + [o.get("url")]
                link = next((u for u in cands if isinstance(u, str) and "linkedin.com/in/" in u), None)
                email = (o.get("email") or "").replace("mailto:", "").strip().lower() if isinstance(o.get("email"), str) else None
                tel = o.get("telephone") if isinstance(o.get("telephone"), str) else None
                out.append(P.person(name, job, email=email or None, phone=tel, profile_url=link))
        for k, v in o.items():
            _walk_people(v, out, k)
    elif isinstance(o, list):
        for x in o:
            _walk_people(x, out, key)


def _lines(body: str) -> list[str]:
    txt = SKIP_BLOCKS.sub(" ", body)
    txt = html.unescape(re.sub(r"<[^>]+>", "\n", txt))
    return [re.sub(r"\s+", " ", ln).strip() for ln in txt.split("\n") if ln.strip()]


def _people_from_lines(lines: list[str]) -> list[dict]:
    """Cartes d'équipe : « Nom - Poste » sur une ligne, ou une ligne Nom suivie d'une ligne Poste."""
    out, used, n = [], set(), len(lines)
    for i, ln in enumerate(lines):
        if len(ln) > 90:
            continue
        parts = re.split(r"\s+[-–—|:•·/]\s+|,\s+", ln, maxsplit=1)
        if len(parts) == 2:
            a, b = parts
            if P.looks_like_name(a) and P.is_title(b):
                out.append(P.person(a, b))
                continue
            if P.is_title(a) and P.looks_like_name(b):
                out.append(P.person(b, a))
                continue
        if P.looks_like_name(ln):
            for j in (i + 1, i - 1):
                if 0 <= j < n and j not in used and len(lines[j]) <= 80 and P.is_title(lines[j]) \
                        and not P.looks_like_name(lines[j]):
                    out.append(P.person(ln, lines[j]))
                    used.add(j)
                    break
    return out


def _mailto_people(body: str, out: list) -> None:
    for m in MAILTO_RE.finditer(body):
        label = html.unescape(re.sub(r"<[^>]+>", " ", m.group(2))).strip()
        if P.looks_like_name(label):
            out.append(P.person(label, email=m.group(1).strip().lower()))


def _collect(body: str, emails: set, phones: set, people: list | None = None, li: set | None = None) -> None:
    body = body[:MAX_BODY]
    for m in LD_RE.finditer(body):
        try:
            data = json.loads(m.group(1))
        except ValueError:
            continue
        _walk(data, emails, phones)
        if people is not None:
            _walk_people(data, people)
    text = _deobfuscate(html.unescape(unquote(body)))
    emails |= {e.lower().strip(".") for e in EMAIL_RE.findall(text) if _ok(e)}
    phones |= {p.strip() for p in TEL_RE.findall(body)}
    phones |= {re.sub(r"\s+", " ", p).strip() for p in INTL_RE.findall(html.unescape(body)) if 8 <= len(re.sub(r"\D", "", p)) <= 15}
    if people is not None:
        people += _people_from_lines(_lines(body))
        _mailto_people(body, people)
    if li is not None:
        li |= set(LI_RE.findall(body))


def _host(netloc: str) -> str:
    return netloc.lower().split(":")[0].removeprefix("www.")


def _links(base_url: str, body: str, host: str, cap: int = 8) -> list[str]:
    out: list[str] = []
    for m in A_RE.finditer(body[:MAX_BODY]):
        href, label = m.group(1).strip(), re.sub(r"<[^>]+>", " ", m.group(2)).lower()
        if href.lower().startswith(("mailto:", "tel:", "javascript:")):
            continue
        url = urljoin(base_url, href)
        pu = urlparse(url)
        if pu.scheme not in ("http", "https") or _host(pu.netloc) != host or pu.path.lower().endswith(BAD_EXT):
            continue
        if any(h in unquote(pu.path.lower()) + " " + label for h in LINK_HINTS) and url not in out:
            out.append(url)
    return out[:cap]


def _sitemap_links(client: httpx.Client, base: str, host: str) -> list[str]:
    try:
        r = client.get(base + "/sitemap.xml")
    except httpx.HTTPError:
        return []
    if r.status_code != 200:
        return []
    out = []
    for u in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", r.text[:400_000]):
        pu = urlparse(u)
        if _host(pu.netloc) == host and not u.lower().endswith((".xml",) + BAD_EXT) \
                and any(h in pu.path.lower() for h in SITEMAP_HINTS) and u not in out:
            out.append(u)
    return out[:6]


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


def crawl_site(website: str, want_people: bool = False) -> dict:
    """Emails et téléphones (accueil, pages détectées, chemins classiques). want_people : lit aussi les pages
    équipe / direction / sitemap et extrait les personnes (nom, poste, email, téléphone, profil)."""
    base = website.rstrip("/")
    host = extract_domain(base) or ""
    emails: set[str] = set()
    phones: set[str] = set()
    people: list[dict] = []
    li: set[str] = set()
    max_pages = MAX_PAGES_PEOPLE if want_people else MAX_PAGES
    headers = {"User-Agent": settings.USER_AGENT, "Accept-Language": "fr,en;q=0.8"}

    def collect(page_url: str, text: str) -> None:
        n = len(people)
        _collect(text, emails, phones, people if want_people else None, li if want_people else None)
        for p in people[n:]:
            p["source"], p["evidence"] = "website", page_url

    try:
        with httpx.Client(follow_redirects=True, timeout=settings.CRAWL_TIMEOUT, headers=headers, verify=False) as client:
            home = _get(client, base)
            if home is None:  # essai http<->https puis www.
                alt = ("http://" + base.split("://", 1)[1]) if base.startswith("https://") else base.replace("http://", "https://", 1)
                home = _get(client, alt)
            if home is None:
                home = _get(client, "https://www." + host)
            if home is None:
                return {"emails": [], "phones": [], "people": []}
            base = f"{home.url.scheme}://{home.url.host}"  # origine finale (après redirections)
            collect(str(home.url), home.text)
            queue = _links(str(home.url), home.text, host, 12 if want_people else 8)
            if want_people:
                queue += _sitemap_links(client, base, host)
            queue += [base + p for p in STATIC_PATHS]
            if want_people:
                queue += [base + p for p in TEAM_PATHS]
            seen, tried = {base, base + "/", str(home.url).rstrip("/")}, 1
            for url in queue:
                same_n = len([e for e in emails if _same(e.rsplit("@", 1)[-1], host)])
                if tried >= max_pages or (same_n >= 3 and (not want_people or len(people) >= 6)):
                    break
                if url.rstrip("/") in seen:
                    continue
                seen.add(url.rstrip("/"))
                tried += 1
                r = _get(client, url)
                if r is not None:
                    collect(str(r.url), r.text)
    except Exception:  # noqa: BLE001
        pass

    if want_people and people:
        people = P.merge(people)[:60]
        P.attach_profiles(people, li)
        P.attach_emails(people, list(emails), host)
    return {"emails": _rank(emails, host), "phones": sorted(phones)[:2], "people": people if want_people else []}