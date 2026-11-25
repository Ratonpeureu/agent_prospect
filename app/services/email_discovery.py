import re

from app.services.normalize import strip_accents

ROLE_PREFIXES = ["contact", "info", "commercial", "direction", "hello", "accueil", "admin"]


def _slug(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", strip_accents(s or "").lower())


def discover_candidates(domain: str, officers: list[dict] | None, max_roles: int = 5,
                        max_officers: int = 3) -> list[dict]:
    """Adresses probables (génériques + patterns nom/prénom des dirigeants). À vérifier par SMTP."""
    out: list[dict] = []
    for r in ROLE_PREFIXES[:max_roles]:
        out.append({"email": f"{r}@{domain}", "kind": "role"})
    for o in (officers or [])[:max_officers]:
        first_raw = (o.get("first_name") or "").split()
        first_raw = first_raw[0] if first_raw else ""
        last_raw = (o.get("last_name") or "").strip()
        f, l = _slug(first_raw), _slug(last_raw)
        if not f or not l:
            continue
        for local in (f"{f}.{l}", f"{f[0]}.{l}", f"{f}{l}", f"{f[0]}{l}", f, f"{l}.{f}"):
            out.append({"email": f"{local}@{domain}", "kind": "pattern", "first_name": first_raw.title(),
                        "last_name": last_raw.title(), "job_title": o.get("role")})
    seen, uniq = set(), []
    for c in out:
        if c["email"] not in seen:
            seen.add(c["email"])
            uniq.append(c)
    return uniq