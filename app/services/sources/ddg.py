"""Recherche web gratuite via la version HTML de DuckDuckGo (non officielle : peut limiter les requêtes)."""
import html
import re
import threading
import time
from urllib.parse import parse_qs, urlparse

import httpx
from app.services import applog

log = applog.get("ddg")

URL = "https://html.duckduckgo.com/html/"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
           "Accept-Language": "fr,en;q=0.8"}
A_RE = re.compile(r'<a\b([^>]*class="[^"]*result__a[^"]*"[^>]*)>(.*?)</a>', re.S)
_lock = threading.Lock()
_last = 0.0
_blocked_until = 0.0


def _real_url(href: str) -> str | None:
    href = html.unescape(href)
    if href.startswith("//"):
        href = "https:" + href
    q = parse_qs(urlparse(href).query)
    if "uddg" in q:
        return q["uddg"][0]
    return href if href.startswith("http") and "duckduckgo.com" not in href else None


def _next_form(page: str) -> dict | None:
    forms = re.findall(r'<div class="nav-link">\s*<form[^>]*>(.*?)</form>', page, re.S)
    if not forms:
        return None
    data = {}
    for tag in re.findall(r"<input\b[^>]*>", forms[-1]):
        n, v = re.search(r'name=["\']([^"\']+)', tag), re.search(r'value=["\']([^"\']*)', tag)
        if n:
            data[n.group(1)] = html.unescape(v.group(1)) if v else ""
    return data or None


def search(query: str, pages: int = 1) -> list[tuple[str, str]]:
    """Retourne [(titre, url)]. Liste vide si bloqué (pause automatique de 10 min)."""
    global _last, _blocked_until
    out: list[tuple[str, str]] = []
    data = {"q": query, "kl": "wt-wt"}
    with httpx.Client(timeout=20, headers=HEADERS, follow_redirects=True) as c:
        for _ in range(pages):
            with _lock:
                if time.time() < _blocked_until:
                    break
                time.sleep(max(0.0, 2.0 - (time.time() - _last)))
                try:
                    r = c.post(URL, data=data)
                except httpx.HTTPError as e:
                    _last = time.time()
                    log.warning("DuckDuckGo injoignable (%s) pour %r", type(e).__name__, query)
                    break
                _last = time.time()
                if r.status_code != 200 or "anomaly" in r.text:
                    _blocked_until = time.time() + 600
                    log.warning("EVENT ddg.blocked status=%s pause=600s query=%r", r.status_code, query)
                    break
            for attrs, label in A_RE.findall(r.text):
                m = re.search(r'href="([^"]+)"', attrs)
                url = _real_url(m.group(1)) if m else None
                if url:
                    out.append((html.unescape(re.sub(r"<[^>]+>", "", label)).strip(), url))
            data = _next_form(r.text)
            if not data:
                break
    return out