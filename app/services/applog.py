"""Journal applicatif : fichier tournant, instrumentation HTTP, chronométrage et diagnostic de blocage."""
import logging
import os
import re
import sys
import threading
import time
import traceback
from contextlib import contextmanager
from logging.handlers import RotatingFileHandler

from app.config import settings

FORMAT = "%(asctime)s | %(levelname)s | %(job)s | %(name)s | %(message)s"
LINE_RE = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),\d{3} \| (\w+) \| (\S+) \| (\S+) \| (.*)$")
LEVELS = {"DEBUG": 10, "INFO": 20, "WARNING": 30, "ERROR": 40, "CRITICAL": 50}

# Hôtes d'API connues : leurs échecs (timeout, 4xx/5xx, 429) sont toujours journalisés en WARNING.
# Les sites crawlés (hôtes quelconques) ne le sont qu'en cas de lenteur, sinon ce serait du bruit (404 normaux).
API_HOSTS = {
    "overpass-api.de", "overpass.kumi.systems", "ovp.dresel.systems", "query.wikidata.org",
    "api.gleif.org", "recherche-entreprises.api.gouv.fr", "geo.api.gouv.fr", "api.insee.fr",
    "api.company-information.service.gov.uk", "finances.worldbank.org", "api.ted.europa.eu",
    "api.gdeltproject.org", "index.commoncrawl.org", "html.duckduckgo.com","api.github.com",
}

_done = False


class _DefaultJob(logging.Filter):
    def filter(self, record):
        if not hasattr(record, "job"):
            record.job = "-"
        return True


def log_dir() -> str:
    return os.path.join(settings.DATA_DIR, "logs")


def log_path() -> str:
    return os.path.join(log_dir(), "app.log")


def get(name: str) -> logging.Logger:
    return logging.getLogger(f"prospect.{name}")


def jlog(name: str, job_id) -> logging.LoggerAdapter:
    """Logger dont chaque ligne porte job=<id> (filtrable dans la page Journal)."""
    return logging.LoggerAdapter(get(name), {"job": f"job={job_id}"})


def _thread_hook(args):
    if args.exc_type is SystemExit:
        return
    get("thread").error("Exception non gérée dans le thread %s", getattr(args.thread, "name", "?"),
                        exc_info=(args.exc_type, args.exc_value, args.exc_traceback))


def instrument_httpx() -> None:
    """Journalise TOUS les appels HTTP sortants (providers, crawler, DDG...) sans toucher à chaque fichier."""
    import httpx
    if getattr(httpx.Client.send, "_instrumented", False):
        return
    orig = httpx.Client.send
    log = get("http")

    def send(self, request, *args, **kwargs):
        t0 = time.perf_counter()
        host = request.url.host
        target = f"{request.method} {host}{request.url.path}"
        try:
            resp = orig(self, request, *args, **kwargs)
        except Exception as e:  # noqa: BLE001
            d = time.perf_counter() - t0
            lvl = logging.WARNING if (host in API_HOSTS or d >= settings.SLOW_OP_S) else logging.DEBUG
            log.log(lvl, "HTTP ECHEC %s après %.1fs : %s %s", target, d, type(e).__name__, str(e)[:120])
            raise
        d = time.perf_counter() - t0
        if resp.status_code >= 400 and host in API_HOSTS:
            log.warning("HTTP %s %s en %.1fs%s", resp.status_code, target, d,
                        " (RATE LIMIT)" if resp.status_code == 429 else "")
        elif d >= settings.SLOW_OP_S:
            log.warning("SLOW HTTP %s en %.1fs (status %s)", target, d, resp.status_code)
        else:
            log.debug("HTTP %s %s en %.1fs", resp.status_code, target, d)
        return resp

    send._instrumented = True
    httpx.Client.send = send


def setup_logging() -> None:
    global _done
    if _done:
        return
    _done = True
    os.makedirs(log_dir(), exist_ok=True)
    fmt, flt = logging.Formatter(FORMAT), _DefaultJob()
    handlers = [RotatingFileHandler(log_path(), maxBytes=5_000_000, backupCount=5, encoding="utf-8"),
                logging.StreamHandler(sys.stdout)]
    root = logging.getLogger("prospect")
    root.setLevel(getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO))
    root.propagate = False
    for h in handlers:
        h.setFormatter(fmt)
        h.addFilter(flt)
        root.addHandler(h)
    logging.getLogger("uvicorn.error").addHandler(handlers[0])  # erreurs uvicorn aussi dans le fichier
    threading.excepthook = _thread_hook
    instrument_httpx()
    get("app").info("EVENT logging.ready file=%s level=%s", log_path(), settings.LOG_LEVEL)


class Timings:
    """Cumule les durées par phase (somme des threads, pas du temps réel) + les 10 opérations les plus lentes."""

    def __init__(self):
        self._lock = threading.Lock()
        self.totals: dict[str, float] = {}
        self.calls: dict[str, int] = {}
        self.slowest: list[tuple[float, str]] = []

    def load(self, data) -> None:
        if not data:
            return
        with self._lock:
            self.totals.update({k: float(v) for k, v in (data.get("totals_s") or {}).items()})
            self.calls.update({k: int(v) for k, v in (data.get("calls") or {}).items()})
            self.slowest = [(float(x["s"]), x["what"]) for x in (data.get("slowest") or [])]

    def add(self, phase: str, seconds: float, what: str = "") -> None:
        with self._lock:
            self.totals[phase] = self.totals.get(phase, 0.0) + seconds
            self.calls[phase] = self.calls.get(phase, 0) + 1
            if what and seconds >= 1.0:
                self.slowest.append((seconds, f"{phase} · {what}"))
                self.slowest.sort(key=lambda x: -x[0])
                del self.slowest[10:]

    def summary(self) -> dict:
        with self._lock:
            return {"totals_s": {k: round(v, 1) for k, v in self.totals.items()},
                    "calls": dict(self.calls),
                    "slowest": [{"s": round(s, 1), "what": w} for s, w in self.slowest]}


@contextmanager
def timed(log, phase: str, what: str = "", timings: Timings | None = None, warn_after: float | None = None):
    """Mesure un bloc. WARNING 'SLOW ...' si la durée dépasse le seuil (SLOW_OP_S par défaut)."""
    t0 = time.perf_counter()
    try:
        yield
    finally:
        d = time.perf_counter() - t0
        if timings is not None:
            timings.add(phase, d, what)
        limit = settings.SLOW_OP_S if warn_after is None else warn_after
        if d >= limit:
            log.warning("SLOW %s · %s : %.1fs", phase, what, d)


def dump_stacks(main_ident=None) -> str:
    """Stack du thread principal de la tâche + des workers actifs (les workers inactifs sont ignorés)."""
    names = {t.ident: t.name for t in threading.enumerate()}
    out = []
    for ident, frame in sys._current_frames().items():
        name = names.get(ident, str(ident))
        if ident != main_ident and not name.startswith("ThreadPoolExecutor"):
            continue
        stack = traceback.extract_stack(frame)
        if ident != main_ident and stack and stack[-1].filename.endswith(("threading.py", "queue.py")):
            continue
        out.append(f"--- thread {name} ---\n" + "".join(traceback.format_list(stack[-8:])))
    return "\n".join(out) or "(aucun thread actif à afficher)"


def read_entries(min_level="INFO", job_id=None, q=None, slow=False, limit=300, max_bytes=4_000_000):
    """Lit la fin du fichier de log. Retourne (entrées du plus récent au plus ancien, taille du fichier)."""
    path = log_path()
    if not os.path.exists(path):
        return [], 0
    size = os.path.getsize(path)
    with open(path, "rb") as fh:
        if size > max_bytes:
            fh.seek(size - max_bytes)
            fh.readline()
        text = fh.read().decode("utf-8", errors="replace")
    entries: list[dict] = []
    for line in text.splitlines():
        m = LINE_RE.match(line)
        if m:
            entries.append({"ts": m.group(1), "level": m.group(2), "job": m.group(3),
                            "logger": m.group(4).removeprefix("prospect."), "message": m.group(5)})
        elif entries:
            entries[-1]["message"] += "\n" + line  # suite (traceback)
    floor = LEVELS.get(min_level.upper(), 20)
    needle = (q or "").lower()
    jtag = f"job={job_id}" if job_id else None
    out = []
    for e in reversed(entries):
        if LEVELS.get(e["level"], 20) < floor:
            continue
        if jtag and e["job"] != jtag:
            continue
        if slow and not e["message"].startswith(("SLOW", "STALLED", "POOL")):
            continue
        if needle and needle not in (e["message"] + e["logger"] + e["job"]).lower():
            continue
        out.append(e)
        if len(out) >= limit:
            break
    return out, size