from app.services.normalize import strip_accents

AFRICA = {
    "DZ", "AO", "BJ", "BW", "BF", "BI", "CM", "CV", "CF", "TD", "KM", "CG", "CD", "CI", "DJ", "EG", "GQ",
    "ER", "SZ", "ET", "GA", "GM", "GH", "GN", "GW", "KE", "LS", "LR", "LY", "MG", "MW", "ML", "MR", "MU",
    "MA", "MZ", "NA", "NE", "NG", "RW", "ST", "SN", "SC", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG", "TN",
    "UG", "ZM", "ZW",
}

NAMES = {
    "senegal": "SN", "france": "FR", "maroc": "MA", "morocco": "MA", "algerie": "DZ", "algeria": "DZ",
    "tunisie": "TN", "tunisia": "TN", "egypte": "EG", "egypt": "EG", "mali": "ML", "mauritanie": "MR",
    "mauritania": "MR", "guinee": "GN", "guinea": "GN", "guinee-bissau": "GW", "guinea-bissau": "GW",
    "gambie": "GM", "gambia": "GM", "cote d'ivoire": "CI", "cote divoire": "CI", "ivory coast": "CI",
    "burkina faso": "BF", "burkina": "BF", "niger": "NE", "nigeria": "NG", "ghana": "GH", "togo": "TG",
    "benin": "BJ", "cameroun": "CM", "cameroon": "CM", "gabon": "GA", "congo": "CG",
    "congo-brazzaville": "CG", "rd congo": "CD", "rdc": "CD", "drc": "CD",
    "republique democratique du congo": "CD", "tchad": "TD", "chad": "TD", "centrafrique": "CF",
    "madagascar": "MG", "maurice": "MU", "mauritius": "MU", "rwanda": "RW", "burundi": "BI", "kenya": "KE",
    "ouganda": "UG", "uganda": "UG", "tanzanie": "TZ", "tanzania": "TZ", "ethiopie": "ET", "ethiopia": "ET",
    "afrique du sud": "ZA", "south africa": "ZA", "angola": "AO", "mozambique": "MZ", "zambie": "ZM",
    "zambia": "ZM", "zimbabwe": "ZW", "namibie": "NA", "namibia": "NA", "botswana": "BW", "cap-vert": "CV",
    "cap vert": "CV", "cape verde": "CV", "djibouti": "DJ", "comores": "KM", "comoros": "KM",
    "seychelles": "SC", "liberia": "LR", "sierra leone": "SL", "guinee equatoriale": "GQ",
    "equatorial guinea": "GQ", "libye": "LY", "libya": "LY", "soudan": "SD", "sudan": "SD",
    "soudan du sud": "SS", "south sudan": "SS", "somalie": "SO", "somalia": "SO", "erythree": "ER",
    "eritrea": "ER", "malawi": "MW", "lesotho": "LS", "eswatini": "SZ", "swaziland": "SZ",
    "sao tome": "ST", "royaume-uni": "GB", "royaume uni": "GB", "united kingdom": "GB", "uk": "GB",
    "angleterre": "GB", "england": "GB", "belgique": "BE", "belgium": "BE", "suisse": "CH",
    "switzerland": "CH", "luxembourg": "LU", "allemagne": "DE", "germany": "DE", "espagne": "ES",
    "spain": "ES", "italie": "IT", "italy": "IT", "portugal": "PT", "pays-bas": "NL", "netherlands": "NL",
    "canada": "CA", "etats-unis": "US", "usa": "US", "united states": "US",
}


def to_iso(value: str | None) -> str | None:
    if not value:
        return None
    v = strip_accents(value).strip().lower().replace("’", "'")
    if v == "uk":
        return "GB"
    if len(v) == 2 and v.isalpha():
        return v.upper()
    return NAMES.get(v)



EN_NAMES = {"SN": "Senegal", "CI": "Cote d'Ivoire", "ML": "Mali", "BF": "Burkina Faso", "NE": "Niger", "GN": "Guinea",
            "TG": "Togo", "BJ": "Benin", "MR": "Mauritania", "GM": "Gambia", "GW": "Guinea-Bissau", "CV": "Cabo Verde",
            "CM": "Cameroon", "GA": "Gabon", "CG": "Congo", "CD": "Congo", "TD": "Chad", "CF": "Central African Republic",
            "GQ": "Equatorial Guinea", "DJ": "Djibouti", "KM": "Comoros", "MG": "Madagascar", "MU": "Mauritius",
            "SC": "Seychelles", "RW": "Rwanda", "BI": "Burundi", "MA": "Morocco", "DZ": "Algeria", "TN": "Tunisia",
            "EG": "Egypt", "LY": "Libya", "NG": "Nigeria", "GH": "Ghana", "LR": "Liberia", "SL": "Sierra Leone",
            "KE": "Kenya", "UG": "Uganda", "TZ": "Tanzania", "ET": "Ethiopia", "ZA": "South Africa", "AO": "Angola",
            "MZ": "Mozambique", "ZM": "Zambia", "ZW": "Zimbabwe", "NA": "Namibia", "BW": "Botswana", "FR": "France",
            "GB": "United Kingdom", "BE": "Belgium", "CH": "Switzerland", "LU": "Luxembourg", "DE": "Germany",
            "ES": "Spain", "IT": "Italy", "PT": "Portugal", "NL": "Netherlands", "CA": "Canada", "US": "United States"}
FR_NAMES = {"SN": "Sénégal", "CI": "Côte d'Ivoire", "ML": "Mali", "BF": "Burkina Faso", "NE": "Niger", "GN": "Guinée",
            "TG": "Togo", "BJ": "Bénin", "MR": "Mauritanie", "GM": "Gambie", "CV": "Cap-Vert", "CM": "Cameroun",
            "GA": "Gabon", "CG": "Congo-Brazzaville", "CD": "RD Congo", "TD": "Tchad", "MG": "Madagascar",
            "MU": "Maurice", "MA": "Maroc", "DZ": "Algérie", "TN": "Tunisie", "EG": "Égypte", "FR": "France",
            "BE": "Belgique", "CH": "Suisse", "LU": "Luxembourg", "DE": "Allemagne", "ES": "Espagne", "IT": "Italie",
            "PT": "Portugal", "NL": "Pays-Bas", "RW": "Rwanda", "BI": "Burundi", "DJ": "Djibouti", "KM": "Comores"}
ENGLISH_SPEAKING = {"GH", "NG", "KE", "UG", "TZ", "ZA", "ZM", "ZW", "NA", "BW", "LR", "SL", "GM", "GB", "US", "ET", "EG"}


def country_terms(iso: str) -> list[str]:
    return list(dict.fromkeys(x for x in (FR_NAMES.get(iso), EN_NAMES.get(iso)) if x))






