from io import BytesIO

import pandas as pd
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

from app.models import Company, Contact


CONTACT_COLS = ["Entreprise", "ID légal", "Site web", "Secteur", "Ville", "Pays", "Adresse",
                "Téléphone entreprise", "Prénom", "Nom", "Nom complet", "Poste", "Niveau", "Département",
                "Profil (URL)", "Email", "Téléphone contact", "Statut email", "Raison", "Score",
                "Adresse générique", "Source", "Date ajout"]

COMPANY_COLS = ["Entreprise", "ID légal", "Site web", "Domaine", "Secteur", "Ville", "Pays", "Adresse",
                "Téléphone", "Date création", "Effectif", "Forme juridique", "Statut", "Dirigeants",
                "Sources", "Nb contacts", "Date ajout"]


def df_to_xlsx_bytes(sheets: dict[str, pd.DataFrame]) -> bytes:
    buf = BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        for name, df in sheets.items():
            name = name[:31]
            df.to_excel(writer, sheet_name=name, index=False)
            ws = writer.sheets[name]
            ws.freeze_panes = "A2"
            ws.auto_filter.ref = ws.dimensions
            for cell in ws[1]:
                cell.font = Font(bold=True, color="FFFFFF")
                cell.fill = PatternFill("solid", fgColor="1F4E78")
            for i, col in enumerate(df.columns, start=1):
                longest = df[col].astype(str).str.len().max() if len(df) else 0
                ws.column_dimensions[get_column_letter(i)].width = min(55, max(len(str(col)), int(longest or 0)) + 2)
    return buf.getvalue()


def contacts_df(pairs: list[tuple[Contact, Company | None]]) -> pd.DataFrame:
    rows = []
    for c, co in pairs:
        rows.append([
            co.name if co else None, co.legal_id if co else None, co.website if co else None,
            co.sector if co else None, co.city if co else None, co.country if co else None,
            co.address if co else None, co.phone if co else None,
            c.first_name, c.last_name, c.full_name, c.job_title, c.seniority, c.department, c.profile_url,c.email, c.phone,
            c.email_status, c.email_reason, c.email_score, "oui" if c.is_role else "non",
            c.source, c.created_at.strftime("%Y-%m-%d") if c.created_at else None,
        ])
    return pd.DataFrame(rows, columns=CONTACT_COLS)


def companies_df(pairs: list[tuple[Company, int]]) -> pd.DataFrame:
    rows = []
    for c, n in pairs:
        ex = c.extra or {}
        officers = "; ".join(
            f"{o.get('first_name') or ''} {o.get('last_name') or ''} ({o.get('role') or ''})".strip()
            for o in ex.get("officers", []))
        rows.append([c.name, c.legal_id, c.website, c.domain, c.sector, c.city, c.country, c.address,
                     c.phone, ex.get("creation_date"), ex.get("employees"), ex.get("legal_form"),
                     ex.get("status"), officers or None, ", ".join(c.sources or []), n,
                     c.created_at.strftime("%Y-%m-%d") if c.created_at else None])
    return pd.DataFrame(rows, columns=COMPANY_COLS)