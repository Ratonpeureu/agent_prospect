import secrets

from fastapi import Header, HTTPException

from app.config import settings


def require_api_key(x_api_key: str | None = Header(default=None)):
    if settings.API_KEY and not secrets.compare_digest(x_api_key or "", settings.API_KEY):
        raise HTTPException(status_code=401, detail="Clé API invalide (header X-API-Key)")