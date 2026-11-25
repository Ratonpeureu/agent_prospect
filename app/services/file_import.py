import io
import os
from datetime import datetime

import pandas as pd
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.services import jobs
from app.services.blacklist import is_blacklisted, load_blacklist
from app.services.dedup import upsert_company, upsert_contact
from app.services.email_verifier import verify_many
from app.services.exporter import df_to_xlsx_bytes
from app.services.normalize import EMAIL_RE, FREE_DOMAINS, extract_domain, guess_name_from_email
from sqlalchemy import select

from app.models import Contact
from app.services.files import fmt_of, link_items, save_file

ALIASES = {
    "email": ["email", "e-mail", "mail", "adresse email", "adresse mail", "courriel", "email address", "emails"],
    "first_name": ["prenom", "prénom", "first name", "firstname", "first_name"],
    "last_name": ["nom de famille", "last name", "lastname", "last_name", "surname"],
    "name": ["nom", "name", "full name", "nom complet", "contact", "fullname", "nom et prénom"],
    "company": ["entreprise", "societe", "société", "company", "organisation", "organization", "raison sociale"],
    "phone": ["telephone", "téléphone", "tel", "phone", "mobile", "portable"],
    "job_title": ["poste", "fonction", "title", "job title", "job_title"],
}


def read_table(content: bytes, filename: str) -> pd.DataFrame:
    ext = os.path.splitext(filename.lower())[1]
    if ext in (".xlsx", ".xlsm"):
        return pd.read_excel(io.BytesIO(content), dtype=str)
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    try:
        return pd.read_csv(io.StringIO(text), sep=None, engine="python", dtype=str)
    except Exception:  # noqa: BLE001  (fichier .txt à une colonne, etc.)
        return pd.DataFrame({"email": [ln.strip() for ln in text.splitlines() if ln.strip()]})


def _col(cols: dict, key: str):
    for a in ALIASES[key]:
        if a in cols:
            return cols[a]
    return None


def parse_rows(content: bytes, filename: str) -> list[dict]:
    df = read_table(content, filename)
    cols = {str(c).strip().lower(): c for c in df.columns}
    c_email, c_first, c_last = _col(cols, "email"), _col(cols, "first_name"), _col(cols, "last_name")
    c_name, c_comp = _col(cols, "name"), _col(cols, "company")
    c_phone, c_title = _col(cols, "phone"), _col(cols, "job_title")

    def val(row, col):
        if col is None:
            return None
        v = row[col]
        return None if pd.isna(v) or str(v).strip() == "" else str(v).strip()

    rows = []
    for e in EMAIL_RE.findall(" ".join(str(c) for c in df.columns)):  # cas fichier sans en-tête
        rows.append({"email": e.lower()})

    for _, row in df.iterrows():
        emails = EMAIL_RE.findall(str(row[c_email])) if c_email is not None and pd.notna(row[c_email]) else []
        if not emails:
            emails = EMAIL_RE.findall(" ".join(str(v) for v in row.values if pd.notna(v)))
        first, last, name = val(row, c_first), val(row, c_last), val(row, c_name)
        if name and not (first or last):
            parts = name.split()
            first, last = parts[0], " ".join(parts[1:]) or None
        for e in emails:
            rows.append({"email": e.lower(), "first_name": first, "last_name": last,
                         "company": val(row, c_comp), "phone": val(row, c_phone),
                         "job_title": val(row, c_title)})
    return rows


def process_rows(db: Session, rows: list[dict], use_smtp: bool | None = None,
                 save_to_db: bool = False) -> tuple[list[dict], list[dict], dict]:
    """Dédoublonne, exclut la blacklist, vérifie. Retourne (traités, exclus, résumé)."""
    seen: dict[str, dict] = {}
    duplicates = 0
    for r in rows:
        e = r["email"].lower()
        if e in seen:
            duplicates += 1
            for k, v in r.items():
                if v and not seen[e].get(k):
                    seen[e][k] = v
        else:
            seen[e] = dict(r)

    bl = load_blacklist(db)
    todo, excluded = [], []
    for e, r in seen.items():
        (excluded if is_blacklisted(bl, e) else todo).append(r)
    for r in excluded:
        r.update(status="blacklisted", reason="blacklist", score=0, is_role=False)

    results = verify_many([r["email"] for r in todo], use_smtp)
    for r in todo:
        res = results[r["email"]]
        r.update(email=res["email"], status=res["status"], reason=res["reason"],
                 score=res["score"], is_role=res["is_role"])
        if not r.get("first_name") and not r.get("last_name"):
            r["first_name"], r["last_name"] = guess_name_from_email(r["email"])

    if save_to_db:
        for r in todo:
            domain = extract_domain(r["email"])
            company_id = None
            if r.get("company") or (domain and domain not in FREE_DOMAINS):
                comp, _ = upsert_company(db, {"name": r.get("company") or domain,
                                              "domain": None if domain in FREE_DOMAINS else domain}, "import")
                company_id = comp.id
            c, st = upsert_contact(db, {**r, "company_id": company_id, "source": "import"}, bl)
            if c is not None:
                c.email_status, c.email_reason = r["status"], r["reason"]
                c.email_score, c.is_role, c.verified_at = r["score"], r["is_role"], datetime.utcnow()
        db.commit()

    count = lambda s: sum(1 for r in todo if r["status"] == s)  # noqa: E731
    summary = {"emails_trouves": len(rows), "uniques": len(seen), "doublons_supprimes": duplicates,
               "blacklistes_exclus": len(excluded), "valides": count("valid"), "risques": count("risky"),
               "inconnus": count("unknown"), "invalides": count("invalid")}
    return todo, excluded, summary


COLS = {"email": "Email", "first_name": "Prénom", "last_name": "Nom", "company": "Entreprise",
        "phone": "Téléphone", "job_title": "Poste", "status": "Statut", "reason": "Raison",
        "score": "Score", "is_role": "Adresse générique"}


def _df(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=list(COLS.keys()))
    return df.rename(columns=COLS)


def build_workbook(done: list[dict], excluded: list[dict], summary: dict, include_risky: bool = False) -> bytes:
    good = {"valid", "risky"} if include_risky else {"valid"}
    sheets = {
        "Valides": _df([r for r in done if r["status"] in good]),
        "A_revoir": _df([r for r in done if r["status"] in {"risky", "unknown"} - good]),
        "Invalides": _df([r for r in done if r["status"] == "invalid"]),
        "Exclus_blacklist": _df(excluded),
        "Resume": pd.DataFrame({"Indicateur": list(summary.keys()), "Valeur": list(summary.values())}),
    }
    return df_to_xlsx_bytes(sheets)


def run_file_job(job_id: int, content: bytes, filename: str, save_to_db: bool,
                 include_risky: bool, use_smtp: bool | None) -> None:
    db = SessionLocal()
    job = db.get(jobs.Job, job_id)
    try:
        jobs.start(db, job)
        rows = parse_rows(content, filename)
        done, excluded, summary = process_rows(db, rows, use_smtp, save_to_db)
        data = build_workbook(done, excluded, summary, include_risky)

        # Fichier source conservé + Excel résultat conservé
        src = save_file(db, "import", filename, content, fmt_of(filename), summary["uniques"], job_id=job_id,
                        note="Fichier source" + (" (contacts enregistrés en base)" if save_to_db else ""))
        out_file = save_file(db, "verified", f"verifie_{os.path.splitext(filename)[0]}.xlsx", data, "xlsx",
                             len(done) + len(excluded), job_id=job_id, note=f"Résultat de {filename}")
        if save_to_db and done:
            emails = [r["email"] for r in done]
            ids: list[int] = []
            for i in range(0, len(emails), 1000):
                ids += db.execute(select(Contact.id).where(Contact.email.in_(emails[i:i + 1000]))).scalars().all()
            link_items(db, src, "contact", ids, "import")
        db.commit()
        jobs.finish(db, job, summary, out_file.path)
    except Exception as e:  # noqa: BLE001
        jobs.fail(db, job, repr(e))
    finally:
        db.close()







