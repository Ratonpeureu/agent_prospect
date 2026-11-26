import functools
import threading
import time
from datetime import datetime

from sqlalchemy.orm import Session

from app.config import settings
from app.database import engine
from app.models import Job
from app.services import applog

log = applog.get("jobs")

# Tâches réellement en cours dans CE process : {job_id: {thread, kind, started, last_beat, step, stack_at}}
RUNNING: dict[int, dict] = {}
_lock = threading.Lock()


def create_job(db: Session, kind: str, params: dict | None = None) -> Job:
    job = Job(kind=kind, params=params or {}, status="queued", attempts=0)
    db.add(job)
    db.commit()
    db.refresh(job)
    log.info("EVENT job.created job=%s kind=%s", job.id, kind)
    return job


def beat(job_id, step: str | None = None) -> None:
    """Signe de vie en mémoire (gratuit, sans base de données). Appelé à chaque petite étape."""
    with _lock:
        r = RUNNING.get(job_id)
        if r:
            r["last_beat"] = time.time()
            if step:
                r["step"] = step


def start(db: Session, job: Job) -> None:
    job.status = "running"
    job.error = None
    job.finished_at = None
    job.attempts = (job.attempts or 0) + 1
    job.heartbeat_at = datetime.utcnow()
    db.commit()
    beat(job.id, "démarrage")


def checkpoint(db: Session, job: Job, progress: dict) -> None:
    """Sauvegarde l'état d'avancement (reprise possible) + signe de vie."""
    job.progress = dict(progress)  # nouvelle référence : SQLAlchemy détecte le changement
    job.heartbeat_at = datetime.utcnow()
    db.commit()
    beat(job.id, progress.get("message"))


def finish(db: Session, job: Job, result: dict, file_path: str | None = None) -> None:
    job.status = "done"
    job.result = result
    job.file_path = file_path
    job.progress = {"phase": "done", "percent": 100, "message": "Terminé"}
    job.finished_at = datetime.utcnow()
    db.commit()
    applog.jlog("jobs", job.id).info("EVENT job.done")


def fail(db: Session, job: Job, error: str) -> None:
    db.rollback()
    job.status = "error"
    job.error = error[:2000]
    job.finished_at = datetime.utcnow()
    db.commit()  # le dernier checkpoint est conservé : le bouton "Reprendre" repart de là
    applog.jlog("jobs", job.id).error("EVENT job.failed error=%s", error[:300])


def tracked(kind: str):
    """Enregistre la tâche (watchdog), empêche un double lancement et journalise début/fin/durée."""
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(job_id, *args, **kwargs):
            with _lock:
                if job_id in RUNNING:
                    log.warning("Job %s déjà en cours dans ce process : lancement ignoré", job_id)
                    return None
                RUNNING[job_id] = {"thread": threading.get_ident(), "kind": kind, "started": time.time(),
                                   "last_beat": time.time(), "step": "démarrage", "stack_at": 0.0}
            t0 = time.time()
            jl = applog.jlog("jobs", job_id)
            jl.info("EVENT job.start kind=%s", kind)
            try:
                return fn(job_id, *args, **kwargs)
            finally:
                with _lock:
                    RUNNING.pop(job_id, None)
                jl.info("EVENT job.exit kind=%s duration=%.1fs", kind, time.time() - t0)
        return wrapper
    return deco


# ---------------- watchdog ----------------
_wd_started = False


def start_watchdog() -> None:
    global _wd_started
    if _wd_started:
        return
    _wd_started = True
    threading.Thread(target=_watchdog_loop, name="watchdog", daemon=True).start()


def _watchdog_loop() -> None:
    n = 0
    while True:
        time.sleep(30)
        n += 1
        try:
            _watchdog_tick(alive=(n % 2 == 0))
        except Exception:  # noqa: BLE001
            log.exception("watchdog en erreur")


def _watchdog_tick(alive: bool) -> None:
    now = time.time()
    with _lock:
        items = [(jid, dict(r)) for jid, r in RUNNING.items()]
    pool = engine.pool
    used = pool.checkedout() if hasattr(pool, "checkedout") else None
    cap = settings.DB_POOL_SIZE + settings.DB_MAX_OVERFLOW
    if used is not None and used >= cap - 2:
        log.warning("POOL DB presque saturé : %s/%s connexions utilisées (%s)", used, cap, pool.status())
    if alive:  # un trou dans ces lignes = le process était gelé
        log.info("EVENT alive jobs=%s threads=%d db_checkedout=%s", [j for j, _ in items],
                 threading.active_count(), used)
    for jid, r in items:
        idle = now - r["last_beat"]
        if idle < settings.JOB_STALL_SECONDS:
            continue
        with _lock:
            live = RUNNING.get(jid)
            if not live or now - live["stack_at"] < settings.JOB_STALL_SECONDS:
                continue
            live["stack_at"] = now
        applog.jlog("jobs", jid).warning("STALLED aucune progression depuis %.0fs (dernière étape : %s)\n%s",
                                         idle, r["step"], applog.dump_stacks(r["thread"]))