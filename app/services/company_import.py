import io
import ipaddress
import os
import socket
from urllib.parse import urlparse

import httpx
import pandas as pd
from sqlalchemy.orm import Session

from app.config import settings
from app.services.blacklist import load_blacklist
from app.services.dedup import upsert_company, upsert_contact
from app.services.normalize import EMAIL_RE, strip_accents

FIELDS = {  # ordre = priorité d'attribution des colonnes
    "email": ["email", "e-mail", "mail", "courriel", "adresse email", "email address"],
    "website": ["site", "site web", "website", "url", "web", "site internet", "www"],
    "phone": ["telephone", "tel", "phone", "mobile", "portable"],
    "name": ["nom", "name", "entreprise", "societe", "company", "raison sociale", "exposant", "exhibitor",
             "attributaire", "supplier", "winner", "denomination", "membre", "adherent", "organisation", "company name"],
    "city": ["ville", "city", "localite"],
    "country": ["pays", "country"],
    "sector": ["secteur", "sector", "activite", "domaine", "categorie", "industry"],
    "address": ["adresse", "address"],
}
MAX_BYTES = 30 * 1024 * 1024


def _n(s) -> str:
    return strip_accents(str(s if s is not None else "")).replace("\n", " ").strip().lower()


def _map_header(header: list[str]) -> dict[str, int]:
    heads, used, idx = [_n(h) for h in header], set(), {}
    for field, aliases in FIELDS.items():
        pos = next((i for i, h in enumerate(heads) if i not in used and h in aliases), None)
        if pos is None:  # correspondance partielle (alias de 5 lettres ou plus)
            pos = next((i for i, h in enumerate(heads) if i not in used and any(len(a) >= 5 and a in h for a in aliases)), None)
        if pos is not None:
            idx[field] = pos
            used.add(pos)
    return idx


def _rows(header: list[str], data: list[list]) -> list[dict]:
    idx = _map_header(header)
    if "name" not in idx:
        return []
    out = []
    for r in data:
        rec = {}
        for f, i in idx.items():
            v = r[i] if i < len(r) else None
            v = None if v is None or (isinstance(v, float) and pd.isna(v)) else str(v).strip()
            rec[f] = None if v in (None, "", "nan", "None") else v
        if rec.get("name"):
            out.append(rec)
    return out


def _from_frame(df: pd.DataFrame) -> list[dict]:
    header = [" ".join(map(str, c)) if isinstance(c, tuple) else str(c) for c in df.columns]
    return _rows(header, df.values.tolist())


def _from_pdf(content: bytes) -> list[dict]:
    import pdfplumber
    rows, last = [], None
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages[:300]:
            for table in page.extract_tables():
                if not table:
                    continue
                if _map_header([c or "" for c in table[0]]).get("name") is not None:
                    last, data = [c or "" for c in table[0]], table[1:]
                elif last and len(table[0]) == len(last):
                    data = table  # suite d'un tableau : l'en-tête n'est pas répété
                else:
                    continue
                rows += _rows(last, data)
    return rows


def parse_bytes(content: bytes, filename: str, content_type: str = "") -> list[dict]:
    ext = os.path.splitext(filename.lower())[1]
    ct = content_type.lower()
    if ext == ".pdf" or "pdf" in ct:
        return _from_pdf(content)
    if ext in (".xlsx", ".xlsm") or "spreadsheet" in ct:
        sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, dtype=str)
        return [r for df in sheets.values() for r in _from_frame(df)]
    text = content.decode("utf-8-sig", errors="replace")
    if ext in (".csv", ".txt") or "csv" in ct:
        return _from_frame(pd.read_csv(io.StringIO(text), sep=None, engine="python", dtype=str))
    try:
        return [r for df in pd.read_html(io.StringIO(text)) for r in _from_frame(df)]
    except ValueError:
        return []


def _check_url(url: str) -> None:
    pu = urlparse(url)
    if pu.scheme not in ("http", "https") or not pu.hostname:
        raise ValueError("URL invalide (http ou https attendu)")
    for info in socket.getaddrinfo(pu.hostname, None):
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved:
            raise ValueError("Adresse interne refusée")


def fetch_url(url: str) -> list[dict]:
    headers = {"User-Agent": settings.USER_AGENT}
    with httpx.Client(timeout=40, headers=headers, follow_redirects=False, verify=False) as c:
        for _ in range(5):
            _check_url(url)
            r = c.get(url)
            if r.is_redirect and r.headers.get("location"):
                url = str(httpx.URL(url).join(r.headers["location"]))
                continue
            break
        else:
            raise ValueError("Trop de redirections")
        if r.status_code != 200:
            raise ValueError(f"Réponse HTTP {r.status_code}")
        if len(r.content) > MAX_BYTES:
            raise ValueError("Fichier trop volumineux (max 30 Mo)")
        return parse_bytes(r.content, urlparse(url).path, r.headers.get("content-type", ""))


def import_rows(db: Session, rows: list[dict], source: str, country: str = "") -> dict:
    bl = load_blacklist(db)
    ids, created, merged, contacts = [], 0, 0, 0
    for r in rows:
        data = {k: r.get(k) for k in ("name", "website", "city", "country", "sector", "phone", "address")}
        data["country"] = data["country"] or country or None
        try:
            comp, new = upsert_company(db, data, source)
        except ValueError:
            continue
        ids.append(comp.id)
        created += int(new)
        merged += int(not new)
        for e in EMAIL_RE.findall(r.get("email") or ""):
            ct, st = upsert_contact(db, {"email": e.lower(), "company_id": comp.id, "source": source}, bl)
            contacts += int(st == "created")
    db.commit()
    return {"rows": len(rows), "created": created, "merged": merged, "contacts": contacts,
            "company_ids": list(dict.fromkeys(ids))}