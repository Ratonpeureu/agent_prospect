import os
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.exc import OperationalError

from app import models  # noqa: F401
from app.config import settings
from app.database import Base, engine
from app.deps import require_api_key
from app.routers import (app_settings, blacklist, companies, contacts, enrich,
                      exports, search, stats, verify)
from app.services.settings_store import load_overrides


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(os.path.join(settings.DATA_DIR, "exports"), exist_ok=True)
    load_overrides()
    for _ in range(30):
        try:
            Base.metadata.create_all(engine)
            break
        except OperationalError:
            time.sleep(2)
    yield


app = FastAPI(title="Prospect Tool API", version="3.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
                   expose_headers=["X-Total-Count", "Content-Disposition"])

auth = [Depends(require_api_key)]
for r in (companies, contacts, blacklist, search, verify, exports, enrich, app_settings, stats):
    app.include_router(r.router, dependencies=auth)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/auth-required")
def auth_required():
    """Route publique : indique au frontend s'il doit demander la clé X-API-Key."""
    return {"required": bool(settings.API_KEY)}