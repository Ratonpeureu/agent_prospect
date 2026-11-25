import re
import threading
import time
from collections import Counter

import httpx

from app.config import settings
from app.services.countries import ENGLISH_SPEAKING, NAMES, country_terms
from app.services.normalize import strip_accents
from app.services.providers.base import Provider, SearchParams

URL = "https://api.gdeltproject.org/api/v2/doc/doc"
SIGNALS = {
    "recrutement": ['"recrute"', '"recrutement"', '"hiring"', '"recruits"'],
    "expansion": ['"nouvelle filiale"', '"ouvre une agence"', '"ouverture d\'une agence"', '"expansion"', '"new subsidiary"', '"opens office"'],
    "financement": ['"lève"', '"financement"', '"raises"', '"funding"'],
    "contrat": ['"nouveau contrat"', '"remporte"', '"wins contract"', '"awarded"'],
}
VERBS = {"recrute", "recrutent", "ouvre", "ouvrent", "lance", "lancent", "annonce", "annoncent", "inaugure", "signe",
         "obtient", "lève", "remporte", "étend", "renforce", "investit", "nomme", "installe", "implante", "crée",
         "hires", "hiring", "recruits", "opens", "launches", "announces", "raises", "wins", "signs", "expands",
         "secures", "appoints", "plans", "invests", "unveils", "acquires", "acquiert", "rachète"}
COMPANY_WORDS = {"sa", "sarl", "sas", "sasu", "suarl", "ltd", "plc", "inc", "llc", "group", "groupe", "holding", "bank",
                 "banque", "technologies", "tech", "industries", "telecom", "telecoms", "assurance", "assurances",
                 "insurance", "capital", "logistics", "logistique", "energy", "energies", "pharma", "motors",
                 "airlines", "ciments", "cement", "mining", "consulting", "software", "labs", "systems", "services"}
STOP = {"le", "la", "les", "l", "un", "une", "des", "du", "de", "d", "the", "a", "an", "of", "et", "and", "en", "au",
        "aux", "pour", "sur", "dans", "ce", "cette", "ces", "selon", "après", "avant", "nouveau", "nouvelle", "new",
        "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche", "janvier", "février", "mars", "avril",
        "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre", "monday", "tuesday",
        "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "april", "june", "july",
        "august", "september", "october", "november", "december", "président", "ministre", "directeur", "pdg", "ceo"}
CITIES = {"dakar", "abidjan", "casablanca", "rabat", "tunis", "alger", "bamako", "ouagadougou", "niamey", "conakry",
          "lomé", "lome", "cotonou", "douala", "yaoundé", "yaounde", "libreville", "kinshasa", "brazzaville", "paris",
          "lyon", "marseille", "bruxelles", "genève", "londres", "london", "lagos", "accra", "nairobi", "afrique",
          "africa", "europe", "uemoa", "cedeao", "ecowas", "onu", "fmi", "imf"}
MEDIA = {"reuters", "afp", "bbc", "cnn", "jeune afrique", "le monde", "twitter", "facebook", "linkedin", "youtube"}
_lock = threading.Lock()
_last = 0.0


def _candidates(title: str) -> list[str]:
    out, cur = [], []

    def flush(verb_next: bool):
        if not cur:
            return
        name = " ".join(cur)
        low = strip_accents(name).lower()
        if low in NAMES or low in CITIES or low in MEDIA or len(name) < 3:
            return
        has_company_word = any(t.lower() in COMPANY_WORDS for t in cur)
        if verb_next or has_company_word:
            out.append(name)

    for tok in title.split() + [""]:
        clean = tok.strip(",.;:!?()\"«»“”‘’")
        low = clean.lower()
        if clean and clean[0].isupper() and low not in STOP and low not in VERBS:
            cur.append(clean)
        else:
            flush(low in VERBS)
            cur = []
    return out


class GdeltProvider(Provider):
    name = "gdelt"
    label = "GDELT (presse : signaux de recrutement / expansion)"
    description = "Articles de presse multilingues → entreprises qui recrutent, s'étendent ou financent. Sans clé. Précision moyenne."
    countries = None
    auto = False
    filters = {"signals": "recrutement, expansion, financement, contrat (défaut : recrutement + expansion)",
               "lang": "french | english (défaut selon le pays)", "timespan": "ex. 1week, 1month, 3months (défaut 3months)"}

    def search(self, p: SearchParams) -> list[dict]:
        global _last
        if not (p.country or p.location):
            return []
        sig = p.filters.get("signals") or ["recrutement", "expansion"]
        sig = [sig] if isinstance(sig, str) else sig
        phrases = [ph for s in sig for ph in SIGNALS.get(str(s).strip().lower(), [])]
        if not phrases:
            return []
        terms = ([p.location] if p.location else []) + (country_terms(p.country) if p.country else [])
        geo = "(" + " OR ".join(f'"{t}"' for t in dict.fromkeys(terms)) + ")"
        lang = p.filters.get("lang") or ("english" if p.country in ENGLISH_SPEAKING else "french")
        query = f"({' OR '.join(phrases)}) {geo}" + (f" {p.query}" if p.query else "") + f" sourcelang:{lang}"
        with _lock:  # GDELT : environ 1 requête / 5 s
            time.sleep(max(0.0, 5.5 - (time.time() - _last)))
            _last = time.time()
            try:
                r = httpx.get(URL, params={"query": query, "mode": "artlist", "format": "json", "sort": "datedesc",
                                           "maxrecords": 250, "timespan": p.filters.get("timespan", "3months")},
                              headers=self.headers(), timeout=settings.PROVIDER_TIMEOUT)
                arts = r.json().get("articles", []) if r.status_code == 200 else []
            except (httpx.HTTPError, ValueError):
                return []

        freq: Counter = Counter()
        first: dict[str, dict] = {}
        for a in arts:
            for name in set(_candidates(a.get("title") or "")):
                freq[name] += 1
                first.setdefault(name, a)
        out = []
        for name, n in freq.most_common(p.limit):
            a = first[name]
            out.append({"name": name, "country": p.country, "city": p.location or None, "source": self.name,
                        "sector": p.query or None,
                        "extra": {"description": f"Presse ({n} article(s)) : {(a.get('title') or '')[:200]} · {a.get('url')}"}})
        return out


provider = GdeltProvider()