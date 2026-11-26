"""Personnes : détection de noms et de postes, classification, déduction des formats d'emails."""
import re
from collections import Counter
from urllib.parse import unquote

from app.config import settings
from app.services.normalize import strip_accents


def _n(s) -> str:
    return strip_accents(str(s or "")).lower()


def slug(s) -> str:
    return re.sub(r"[^a-z0-9]", "", _n(s))


ROLE_WORDS = [
    "directeur", "directrice", "director", "responsable", "manager", "chef", "cheffe", "president", "presidente",
    "fondateur", "fondatrice", "founder", "co-fondateur", "cofounder", "gerant", "gerante", "associe", "associee",
    "partner", "consultant", "consultante", "ingenieur", "engineer", "developpeur", "developpeuse", "developer",
    "comptable", "assistant", "assistante", "charge", "chargee", "head", "lead", "coordinat", "analyste", "analyst",
    "avocat", "avocate", "conseiller", "conseillere", "commercial", "commerciale", "secretaire", "administrateur",
    "administratrice", "technicien", "technicienne", "architecte", "designer", "juriste", "auditeur", "expert",
    "officer", "specialist", "specialiste", "executive", "superviseur", "proprietaire", "owner", "dirigeant",
    "delegue", "attache", "agent", "controleur", "tresorier", "tresoriere", "stagiaire", "intern", "recruiter",
    "recruteur", "pharmacien", "medecin", "docteur", "notaire", "formateur", "formatrice", "enseignant",
    "professeur", "journaliste", "redacteur", "redactrice", "chief", "vice-president",
]
SHORT_ROLES = ["ceo", "cto", "cfo", "coo", "cio", "cmo", "dg", "pdg", "daf", "dsi", "drh", "vp"]
ROLE_RE = re.compile(r"\b(?:" + "|".join(ROLE_WORDS) + r")|\b(?:" + "|".join(SHORT_ROLES) + r")\b")
ROLE_TOKEN = re.compile(r"^(?:" + "|".join(ROLE_WORDS + SHORT_ROLES) + r")s?$")

STOP = {
    "contact", "contacts", "notre", "nos", "equipe", "equipes", "team", "services", "service", "accueil", "savoir",
    "lire", "plus", "voir", "tous", "toutes", "avec", "pour", "nous", "vous", "about", "our", "the", "les", "des",
    "une", "page", "pages", "menu", "home", "blog", "news", "actualites", "presse", "carrieres", "careers", "jobs",
    "emploi", "offres", "formation", "formations", "solutions", "produits", "produit", "entreprise", "societe",
    "groupe", "group", "company", "ltd", "sarl", "sas", "sa", "inc", "llc", "gmbh", "politique", "confidentialite",
    "mentions", "legales", "cookies", "conditions", "generales", "droits", "reserves", "copyright", "suivez",
    "rejoignez", "telecharger", "decouvrir", "consulter", "afficher", "email", "mail", "telephone", "tel", "fax",
    "adresse", "address", "phone", "bienvenue", "welcome", "partenaires", "clients", "references", "projets",
    "realisations", "expertise", "expertises", "metiers", "valeurs", "mission", "vision", "histoire", "direction",
}
TITLE_PREFIX = {"m", "mr", "mme", "mlle", "dr", "me", "pr", "prof", "monsieur", "madame", "mrs", "ms", "miss"}
PARTICLES = {"de", "du", "des", "da", "di", "del", "van", "von", "der", "la", "le", "el", "al", "ben", "bin", "ibn", "ould"}
NAME_TOKEN = re.compile(r"^[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’\-]+$")


def clean_name(raw) -> list[str]:
    s = re.sub(r"\(.*?\)", " ", str(raw or ""))
    s = re.split(r",|\s[-–—|]\s", s)[0]
    s = re.sub(r"\s+", " ", s).strip(" .-–|")
    toks = s.split()
    while toks and _n(toks[0]).strip(".") in TITLE_PREFIX:
        toks.pop(0)
    return toks


def looks_like_name(raw) -> bool:
    if not raw or "@" in str(raw) or re.search(r"\d", str(raw)):
        return False
    toks = clean_name(raw)
    main = [t for t in toks if _n(t) not in PARTICLES]
    if not 2 <= len(main) <= 4 or len(" ".join(toks)) > 40:
        return False
    for t in main:
        n = _n(t)
        if not NAME_TOKEN.match(t) or n in STOP or ROLE_TOKEN.match(n):
            return False
    return True


def _case(s: str) -> str:
    return " ".join("-".join(x.capitalize() for x in w.split("-")) if w.isupper() else w for w in s.split())


def split_name(raw) -> tuple[str, str]:
    toks = clean_name(raw)
    caps = [t for t in toks if t.isupper() and len(t) > 1]
    if len(toks) >= 2 and caps and len(caps) < len(toks):
        last, first = caps, [t for t in toks if t not in caps]
    else:
        first, last = toks[:1], toks[1:]
    return _case(" ".join(first)), _case(" ".join(last))


def is_title(s) -> bool:
    s = (s or "").strip()
    if not s or len(s) > 80 or "@" in s or len(s.split()) > 10 or re.search(r"\d{3}", s):
        return False
    t = _n(s)
    if re.search(r"\b(chez|at)\b", t):  # "Directrice chez Acme" = témoignage / personne d'une autre société
        return False
    return bool(ROLE_RE.search(t))


def blank(**kw) -> dict:
    d = {"first_name": None, "last_name": None, "job_title": None, "email": None, "phone": None,
         "profile_url": None, "source": None, "evidence": None}
    d.update({k: v for k, v in kw.items() if v})
    return d


def person(name: str, title: str | None = None, **kw) -> dict:
    first, last = split_name(name)
    t = (title or "").strip(" -–|:,")[:150] or None
    return blank(first_name=first, last_name=last, job_title=t, **kw)


# ---------------- niveau et département ----------------
_C = re.compile(r"\b(ceo|coo|cfo|cto|cio|cmo|chief|pdg|dg|president|presidente|fondateur|fondatrice|founder|cofounder|"
                r"co-fondateur|gerant|gerante|administrateur|proprietaire|owner|dirigeant|partner)\b")
_D = re.compile(r"\b(directeur|directrice|director|vp|head)\b")
_M = re.compile(r"\b(responsable|manager|chef|cheffe|coordinat\w*|lead|superviseur)\b")


def seniority(title) -> str | None:
    t = _n(title)
    if not t:
        return None
    if re.match(r"(assistant|assistante|secretaire|adjoint)", t):
        return "staff"
    if re.search(r"vice.?president|\bvp\b", t):
        return "director"
    if re.search(r"directeur general|directrice generale|director general|managing director|general manager", t):
        return "c_level"
    if _D.search(t):
        return "director"
    if _C.search(t):
        return "c_level"
    if _M.search(t):
        return "manager"
    return "staff"


DEPTS = [
    ("achats", r"achat|procurement|purchas|approvisionn|supply"),
    ("juridique", r"juridi|legal|juriste|avocat|conformite|compliance|notaire"),
    ("rh", r"ressources humaines|\brh\b|\bdrh\b|\bhr\b|human resources|recrut|talent|paie|formation"),
    ("finance", r"financ|comptab|\bdaf\b|\bcfo\b|tresor|controle de gestion|audit|accountant|accounting"),
    ("it", r"informatique|\bit\b|\bdsi\b|\bcto\b|\bcio\b|systeme|technique|technolog|develop|engineer|ingenieur|\bdata\b|devops|securite"),
    ("marketing", r"marketing|communication|\bcmo\b|brand|community|growth|contenu|content|media|presse"),
    ("commercial", r"commerc|vente|\bsales\b|business develop|bizdev|client|export"),
    ("operations", r"operation|logisti|production|exploitation|qualite|maintenance|chantier|projet|project|transport"),
    ("direction", r"\bceo\b|\bpdg\b|\bdg\b|president|gerant|fondat|founder|directeur general|directrice generale|managing|general manager|administrateur|dirigeant|proprietaire|owner"),
]


def department(title) -> str | None:
    t = _n(title)
    if not t:
        return None
    for name, rx in DEPTS:
        if re.search(rx, t):
            return name
    return None


def title_matches(title, wanted) -> bool:
    t = _n(title)
    return any(_n(w) in t for w in wanted if str(w).strip())


# ---------------- configuration, fusion, sélection ----------------
def cfg_from(p: dict) -> dict:
    return {"enabled": bool(p.get("find_people", True)),
            "titles": [str(t).strip() for t in (p.get("person_titles") or []) if str(t).strip()],
            "levels": list(p.get("person_levels") or []),
            "departments": list(p.get("person_departments") or []),
            "sources": list(p.get("people_sources") or ["website", "registry"]),
            "max": int(p.get("people_max") or settings.PEOPLE_MAX_PER_COMPANY)}


def _key(p: dict) -> str:
    k = slug(p.get("first_name")) + "|" + slug(p.get("last_name"))
    return k if k != "|" else "e|" + (p.get("email") or "")


def merge(*lists) -> list[dict]:
    by: dict[str, dict] = {}
    for lst in lists:
        for p in lst or []:
            k = _key(p)
            if k in ("e|", "|"):
                continue
            cur = by.get(k)
            if not cur:
                by[k] = dict(p)
                continue
            for f, v in p.items():
                if v and not cur.get(f):
                    cur[f] = v
    return list(by.values())


RANK = {"c_level": 0, "director": 1, "manager": 2, "staff": 3}


def select(people: list[dict], cfg: dict) -> list[dict]:
    out = []
    for p in people:
        t = p.get("job_title")
        p["seniority"], p["department"] = seniority(t), department(t)
        if cfg["titles"] and not (t and title_matches(t, cfg["titles"])):
            continue
        if cfg["levels"] and p["seniority"] not in cfg["levels"]:
            continue
        if cfg["departments"] and p["department"] not in cfg["departments"]:
            continue
        out.append(p)
    out.sort(key=lambda p: (RANK.get(p["seniority"], 4), 0 if p.get("email") else 1))
    return out[: cfg["max"]]


def attach_emails(people: list[dict], emails: list[str], domain: str) -> None:
    """Associe à chaque personne sans email une adresse du domaine dont la forme correspond à son nom."""
    for p in people:
        if p.get("email") or not p.get("first_name") or not p.get("last_name"):
            continue
        f, l = slug((p["first_name"] or "").split()[0]), slug(p["last_name"])
        if not f or not l:
            continue
        for e in emails:
            local, _, dom = e.lower().partition("@")
            if dom != domain and not dom.endswith("." + domain) and not domain.endswith("." + dom):
                continue
            loc = slug(local)
            if (f in loc and l in loc) or loc in (f[:1] + l, l + f[:1]):
                p["email"] = e.lower()
                break


def attach_profiles(people: list[dict], urls) -> None:
    for p in people:
        if p.get("profile_url") or not p.get("first_name") or not p.get("last_name"):
            continue
        f, l = slug((p["first_name"] or "").split()[0]), slug(p["last_name"])
        for u in urls:
            m = re.search(r"/in/([^/?#]+)", u)
            s = slug(unquote(m.group(1))) if m else ""
            if f and l and f in s and l in s:
                p["profile_url"] = u.split("?")[0]
                break


# ---------------- formats d'emails ----------------
PATTERNS = ["{first}.{last}", "{f}{last}", "{first}", "{first}{last}", "{f}.{last}",
            "{last}.{first}", "{last}", "{first}_{last}", "{first}-{last}", "{l}{first}"]


def build_email(pattern: str, first: str, last: str) -> str | None:
    f = slug((first or "").split()[0]) if first else ""
    l = slug(last)
    if not f or not l:
        return None
    return pattern.format(first=f, last=l, f=f[:1], l=l[:1])


def infer_pattern(pairs: list[tuple]) -> str | None:
    """pairs = [(prénom, nom, partie_locale_de_l_email)] -> format le plus fréquent, ou None."""
    c: Counter = Counter()
    for first, last, local in pairs:
        for pt in PATTERNS:
            if build_email(pt, first, last) == (local or "").lower():
                c[pt] += 1
                break
    return c.most_common(1)[0][0] if c else None