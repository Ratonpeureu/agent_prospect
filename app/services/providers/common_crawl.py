import json
import random
import re

import httpx

from app.config import settings
from app.services.normalize import FREE_DOMAINS
from app.services.providers.base import Provider, SearchParams

INDEX = "https://index.commoncrawl.org"
TLD = {"GB": "uk"}
SECOND = {"co", "com", "org", "net", "gouv", "gov", "ac", "edu", "or", "asso", "nom", "go"}
INSTITUTION = {"gouv", "gov", "ac", "edu", "go"}
BAD = FREE_DOMAINS | {"blogspot.com", "wordpress.com", "wixsite.com", "weebly.com", "over-blog.com", "jimdo.com"}
HOME = r"^https?://[^/]+/?$"


class CommonCrawlProvider(Provider):
    name = "common_crawl"
    label = "Common Crawl (domaines par pays)"
    description = "Sites web actifs d'un domaine national (.sn, .ci, .ma...) tirés de l'archive du web. Sans clé. Ignore le secteur : sert à trouver des sites à crawler."
    countries = None
    auto = False
    filters = {"pages": "nombre de pages d'index tirées au hasard (défaut 4)",
               "include_institutions": "true = garder gouv./edu./ac. (défaut non)",
               "domain_contains": "ne garder que les domaines contenant ce texte"}

    def _registrable(self, host: str, tld: str) -> tuple[str | None, bool]:
        parts = host.lower().removeprefix("www.").split(".")
        if len(parts) < 2 or parts[-1] != tld:
            return None, False
        if len(parts) >= 3 and parts[-2] in SECOND:
            return ".".join(parts[-3:]), parts[-2] in INSTITUTION
        return ".".join(parts[-2:]), False

    def search(self, p: SearchParams) -> list[dict]:
        if not p.country:
            return []
        tld = TLD.get(p.country, p.country.lower())
        inst = str(p.filters.get("include_institutions", "")).lower() in ("1", "true", "yes")
        contains = str(p.filters.get("domain_contains") or "").lower()
        n_pages = max(1, min(12, int(p.filters.get("pages", 4) or 4)))
        out: dict[str, dict] = {}
        try:
            with httpx.Client(timeout=settings.PROVIDER_TIMEOUT + 60, headers=self.headers()) as c:
                crawl = c.get(f"{INDEX}/collinfo.json").json()[0]["id"]
                base = f"{INDEX}/{crawl}-index"
                common = {"url": f"*.{tld}", "output": "json", "fl": "url", "filter": ["status:200", "mime:text/html", f"url:{HOME}"]}
                total = int(c.get(base, params={**common, "showNumPages": "true"}).json().get("pages", 1))
                for pg in random.sample(range(total), min(n_pages, total)):
                    r = c.get(base, params={**common, "page": pg})
                    if r.status_code != 200:
                        continue
                    for line in r.text.splitlines():
                        try:
                            host = re.sub(r"^https?://", "", json.loads(line)["url"]).split("/")[0].split(":")[0]
                        except (ValueError, KeyError):
                            continue
                        dom, institution = self._registrable(host, tld)
                        if not dom or dom in BAD or (institution and not inst) or (contains and contains not in dom):
                            continue
                        label = dom.split(".")[0].replace("-", " ").title()
                        out.setdefault(dom, {"name": label, "website": f"https://{dom}", "domain": dom,
                                             "country": p.country, "source": self.name,
                                             "extra": {"description": f"Découvert via Common Crawl ({crawl})"}})
                    if len(out) >= p.limit:
                        break
        except (httpx.HTTPError, ValueError, KeyError, IndexError):
            return list(out.values())[: p.limit]
        return list(out.values())[: p.limit]


provider = CommonCrawlProvider()