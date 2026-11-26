import faulthandler
import os
import signal
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError

from app import models  # noqa: F401
from app.config import settings
from app.database import Base, engine
from app.deps import require_api_key
from app.routers import (app_settings, blacklist, companies, contacts, enrich,
                         exports, files, logs, search, stats, verify)
from app.services import applog, jobs, resume
from app.services.settings_store import load_overrides

applog.setup_logging()
log = applog.get("app")
_stacks_file = None


def _migrate() -> None:
    """Ajoute les colonnes manquantes aux tables existantes (create_all ne modifie pas les tables)."""
    insp = inspect(engine)
    tables = set(insp.get_table_names())
    wanted = {
        "jobs": {"progress": "JSON", "heartbeat_at": "TIMESTAMP", "attempts": "INTEGER DEFAULT 0"},
        "contacts": {"profile_url": "VARCHAR(500)", "department": "VARCHAR(40)",
                     "seniority": "VARCHAR(20)", "evidence": "VARCHAR(500)"},
    }
    with engine.begin() as cx:
        for table, cols_wanted in wanted.items():
            if table not in tables:
                continue
            existing = {c["name"] for c in insp.get_columns(table)}
            for name, typ in cols_wanted.items():
                if name not in existing:
                    cx.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {typ}"))
                    log.info("EVENT db.migrate added %s.%s", table, name)

def _enable_faulthandler() -> None:
    """kill -USR1 : écrit la stack de TOUS les threads dans /data/logs/stacks.log (diagnostic d'un gel)."""
    global _stacks_file
    os.makedirs(applog.log_dir(), exist_ok=True)
    _stacks_file = open(os.path.join(applog.log_dir(), "stacks.log"), "a", buffering=1)
    faulthandler.enable(file=_stacks_file, all_threads=True)
    if hasattr(signal, "SIGUSR1"):
        faulthandler.register(signal.SIGUSR1, file=_stacks_file, all_threads=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(os.path.join(settings.DATA_DIR, "exports"), exist_ok=True)
    load_overrides()
    for attempt in range(30):
        try:
            Base.metadata.create_all(engine)
            break
        except OperationalError as e:
            log.warning("Base de données pas prête (tentative %d/30) : %s", attempt + 1, str(e)[:120])
            time.sleep(2)
    else:
        log.error("Base de données injoignable après 30 tentatives")
    try:
        _migrate()
    except Exception:  # noqa: BLE001
        log.exception("Migration de la table jobs échouée")
    _enable_faulthandler()
    jobs.start_watchdog()
    resume.start_resume_thread()
    log.info("EVENT app.started version=%s", app.version)
    yield
    log.info("EVENT app.stopping running_jobs=%s", list(jobs.RUNNING))


app = FastAPI(title="Prospect Tool API", version="3.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["X-Total-Count", "Content-Disposition", "X-Export-Id", "X-Export-Count"])


@app.middleware("http")
async def journal_http(request, call_next):
    """Journalise les exceptions, les 5xx et les requêtes lentes (le reste : silence, pas de bruit)."""
    t0 = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:  # noqa: BLE001
        log.exception("EXCEPTION %s %s", request.method, request.url.path)
        raise
    d = time.perf_counter() - t0
    path = request.url.path
    if response.status_code >= 500:
        log.error("HTTP %s %s %s en %.1fs", response.status_code, request.method, path, d)
    elif d >= settings.SLOW_REQUEST_S and path.startswith("/api/"):
        log.warning("SLOW REQUEST %s %s (%s) en %.1fs", request.method, path, response.status_code, d)
    return response


auth = [Depends(require_api_key)]
for r in (companies, contacts, blacklist, search, verify, files, exports, enrich, app_settings, stats, logs):
    app.include_router(r.router, dependencies=auth)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/auth-required")
def auth_required():
    """Route publique : indique au frontend s'il doit demander la clé X-API-Key."""
    return {"required": bool(settings.API_KEY)}


STATIC = Path("/srv/static")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    """Sert le frontend React (fichiers statiques, sinon index.html pour le routeur)."""
    if path.startswith("api/"):
        raise HTTPException(404)
    f = (STATIC / path).resolve()
    if path and f.is_file() and STATIC in f.parents:
        return FileResponse(f)
    index = STATIC / "index.html"
    if not index.exists():
        raise HTTPException(404)
    return FileResponse(index)