"""Retrouve le site officiel d'une entreprise, gratuitement :
1) devine des domaines (nom.cc, nom.com...) qui résolvent en DNS ; 2) vérifie que la page contient le nom ;
3) en dernier recours, recherche DuckDuckGo. Un site n'est accepté que si la page correspond au nom."""
import html
import re

import dns.exception
import dns.resolver
import httpx

from app.config import settings
from app.services.countries import country_terms
from app.services.dedup import SOCIAL_DOMAINS
from app.services.normalize import FREE_DOMAINS, extract_domain, normalize_name, strip_accents
from app.services.sources import ddg

STOP = {"de", "du", "des", "la", "le", "les", "et", "and", "of", "the", "l", "d", "au", "aux", "en", "pour"}
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.S | re.I)
BAD_HOSTS = SOCIAL_DOMAINS | FREE_DOMAINS | {"youtube.com", "bing.com", "wikipedia.org", "indeed.com", "glassdoor.com"}
_dns_cache: dict[str, bool] = {}


def _tokens(name: str) -> list[str]:
    return [t for t in normalize_name(name).split() if t not in STOP and len(t) > 1]


def _slugs(tokens: list[str]) -> list[str]:
    if not tokens:
        return []
    out = ["".join(tokens), "-".join(tokens)]
    if len(tokens) > 2:
        out.append("".join(tokens[:2]))
    if len(tokens) > 1 and len(tokens[0]) >= 5:
        out.append(tokens[0])
    return list(dict.fromkeys(s for s in out if 3 <= len(s) <= 40))


def _tlds(country: str | None) -> list[str]:
    cc = (country or "").lower()
    if not cc:
        return ["com"]
    if cc == "gb":
        return ["co.uk", "uk", "com", "org"]
    return [cc, "com", f"com.{cc}", "org"]


def _resolves(domain: str) -> bool:
    if domain in _dns_cache:
        return _dns_cache[domain]
    r = dns.resolver.Resolver()
    r.lifetime = r.timeout = 3
    try:
        r.resolve(domain, "A")
        ok = True
    except dns.exception.DNSException:
        ok = False
    _dns_cache[domain] = ok
    return ok


def _verify(domain: str, tokens: list[str]) -> str | None:
    sig = [t for t in tokens if len(t) >= 3] or tokens
    if not sig:
        return None
    headers = {"User-Agent": settings.USER_AGENT, "Accept-Language": "fr,en;q=0.8"}
    with httpx.Client(follow_redirects=True, timeout=8, verify=False, headers=headers) as c:
        for url in (f"https://{domain}", f"http://{domain}", f"https://www.{domain}"):
            try:
                r = c.get(url)
            except httpx.HTTPError:
                continue
            if r.status_code >= 400 or "text/html" not in r.headers.get("content-type", ""):
                continue
            body = r.text[:200_000]
            m = TITLE_RE.search(body)
            title = html.unescape(m.group(1)) if m else ""
            text = strip_accents(title + " " + re.sub(r"<[^>]+>", " ", body[:30_000])).lower()
            host = strip_accents(r.url.host or "").replace("-", "").replace(".", "")
            hit = sum(1 for t in sig if t in text or t in host)
            if hit / len(sig) >= 0.6:
                return f"{r.url.scheme}://{r.url.host}"
    return None


def find_site(name: str, country: str | None = None, city: str | None = None, use_search: bool = True) -> str | None:
    tokens = _tokens(name)
    if not tokens:
        return None
    for slug in _slugs(tokens):
        for tld in _tlds(country):
            dom = f"{slug}.{tld}"
            if _resolves(dom) or _resolves("www." + dom):
                site = _verify(dom, tokens)
                if site:
                    return site
    if use_search:
        geo = (country_terms(country) or [""])[0] if country else ""
        q = " ".join(x for x in (f'"{name}"', city, geo) if x)
        for _title, url in ddg.search(q, pages=1):
            host = extract_domain(url)
            if not host or host in BAD_HOSTS or any(host.endswith("." + d) for d in BAD_HOSTS):
                continue
            site = _verify(host, tokens)
            if site:
                return site
    return None