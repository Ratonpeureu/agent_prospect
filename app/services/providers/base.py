from dataclasses import dataclass, field
from typing import Any

from app.config import settings


@dataclass
class SearchParams:
    query: str = ""
    location: str = ""
    country: str | None = None
    limit: int = 50
    filters: dict[str, Any] = field(default_factory=dict)


class Provider:
    """Contrat d'une source. Pour en ajouter une : créer un fichier dans ce dossier avec
    `provider = MaSource()`. Elle apparaît automatiquement dans /api/sources et dans 'auto'."""

    name: str = ""
    label: str = ""
    description: str = ""
    countries: set[str] | None = None   # None = mondiale ; sinon codes ISO2
    key_env: str | None = None          # nom du paramètre de config contenant la clé (si requise)
    signup_url: str = ""
    filters: dict[str, str] = {}

    def configured(self) -> bool:
        return not self.key_env or bool(getattr(settings, self.key_env, ""))

    def supports(self, country: str | None) -> bool:
        return self.countries is None or bool(country and country.upper() in self.countries)

    def search(self, p: SearchParams) -> list[dict]:
        raise NotImplementedError

    def info(self) -> dict:
        return {"name": self.name, "label": self.label, "description": self.description,
                "countries": "mondial" if self.countries is None else sorted(self.countries),
                "requires_key": self.key_env, "configured": self.configured(),
                "signup_url": self.signup_url, "filters": self.filters}

    @staticmethod
    def headers() -> dict:
        return {"User-Agent": settings.USER_AGENT}