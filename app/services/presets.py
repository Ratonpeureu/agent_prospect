from app.services.normalize import strip_accents
PRESETS: dict[str, dict] = {
    "company": {"label": "Entreprises / sièges",
                "aliases": ["entreprise", "entreprises", "societe", "siege", "bureau", "bureaux", "company", "headquarters"],
                "osm": ["office=company"], "naf": [], "sic": []},
    "consulting": {"label": "Cabinets de conseil",
                   "aliases": ["conseil", "consulting", "consultant", "cabinet de conseil"],
                   "osm": ["office=consulting"], "naf": ["70.22Z", "70.21Z"], "sic": ["70229", "70210"]},
    "accounting": {"label": "Comptabilité / audit",
                   "aliases": ["comptabilite", "comptable", "expert-comptable", "audit", "accounting"],
                   "osm": ["office=accountant", "office=tax_advisor"], "naf": ["69.20Z"],
                   "sic": ["69201", "69202", "69203"]},
    "it": {"label": "Informatique / digital",
           "aliases": ["informatique", "it", "logiciel", "software", "agence web", "digital", "numerique", "web"],
           "osm": ["office=it"], "naf": ["62.01Z", "62.02A", "62.02B", "62.03Z", "62.09Z", "63.11Z"],
           "sic": ["62012", "62020", "62090", "63110"]},
    "education": {"label": "Formation / éducation",
                  "aliases": ["formation", "ecole", "universite", "education", "training", "school"],
                  "osm": ["amenity=school", "amenity=college", "amenity=university", "office=educational_institution"],
                  "naf": ["85.59A", "85.59B", "85.42Z", "85.41Z"], "sic": ["85590", "85421"]},
    "bank": {"label": "Banques / microfinance",
             "aliases": ["banque", "bank", "microfinance"],
             "osm": ["amenity=bank"], "naf": ["64.19Z", "64.92Z"], "sic": ["64191", "64110"]},
    "insurance": {"label": "Assurances",
                  "aliases": ["assurance", "assurances", "insurance", "courtier"],
                  "osm": ["office=insurance"], "naf": ["65.12Z", "65.11Z", "66.22Z"], "sic": ["65120", "66220"]},
    "ngo": {"label": "ONG / associations / fondations",
            "aliases": ["ong", "ngo", "association", "associations", "fondation", "humanitaire"],
            "osm": ["office=ngo", "office=association", "office=foundation"],
            "naf": ["94.99Z", "88.99B"], "sic": ["94990"]},
    "institution": {"label": "Institutions / administrations",
                    "aliases": ["institution", "institutions", "administration", "gouvernement", "ministere", "mairie", "government"],
                    "osm": ["office=government", "amenity=townhall"], "naf": ["84.11Z", "84.12Z"], "sic": ["84110"]},
    "real_estate": {"label": "Immobilier",
                    "aliases": ["immobilier", "agence immobiliere", "real estate"],
                    "osm": ["office=estate_agent"], "naf": ["68.31Z", "68.20A"], "sic": ["68310", "68209"]},
    "legal": {"label": "Juridique",
              "aliases": ["avocat", "avocats", "juridique", "notaire", "lawyer"],
              "osm": ["office=lawyer", "office=notary"], "naf": ["69.10Z"], "sic": ["69101", "69102"]},
    "restaurant": {"label": "Restauration",
                   "aliases": ["restaurant", "restaurants", "restauration"],
                   "osm": ["amenity=restaurant"], "naf": ["56.10A", "56.10C"], "sic": ["56101"]},
    "hotel": {"label": "Hôtellerie",
              "aliases": ["hotel", "hotels", "hebergement"],
              "osm": ["tourism=hotel"], "naf": ["55.10Z"], "sic": ["55100"]},
    "health": {"label": "Santé",
               "aliases": ["clinique", "sante", "pharmacie", "hopital", "health"],
               "osm": ["amenity=clinic", "amenity=hospital", "amenity=pharmacy"],
               "naf": ["86.10Z", "86.21Z", "47.73Z"], "sic": ["86101", "86210", "47730"]},
    "construction": {"label": "BTP / construction",
                     "aliases": ["btp", "construction", "batiment"],
                     "osm": ["office=construction_company", "craft=builder"], "naf": ["41.20A", "41.20B", "43.99C"],
                     "sic": ["41202", "43999"]},
    "transport": {"label": "Transport / logistique",
                  "aliases": ["logistique", "transport", "transitaire"],
                  "osm": ["office=logistics"], "naf": ["49.41A", "52.29A"], "sic": ["49410", "52290"]},
    "advertising": {"label": "Communication / marketing",
                    "aliases": ["publicite", "marketing", "communication", "agence de communication"],
                    "osm": ["office=advertising_agency"], "naf": ["73.11Z", "70.21Z"], "sic": ["73110", "70210"]},
}


def _norm(s: str) -> str:
    return strip_accents(s or "").lower().strip()


def find_preset(query: str | None) -> tuple[str, dict] | None:
    """Retrouve un preset d'après un mot-clé libre (alias exact, puis alias contenu dans la requête)."""
    q = _norm(query)
    if not q:
        return None
    for key, pr in PRESETS.items():
        if q == key or q in pr["aliases"]:
            return key, pr
    words = set(q.replace("-", " ").split())
    for key, pr in PRESETS.items():
        if any(a in words or (" " in a and a in q) for a in pr["aliases"]):
            return key, pr
    return None