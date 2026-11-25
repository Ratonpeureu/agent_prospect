import importlib
import pkgutil

from app.services.providers.base import Provider, SearchParams  # noqa: F401

_registry: dict[str, Provider] = {}


def _load() -> None:
    """Auto-découverte : tout module du dossier exposant `provider = MonProvider()` est enregistré."""
    for m in pkgutil.iter_modules(__path__):
        if m.name == "base" or m.name.startswith("_"):
            continue
        mod = importlib.import_module(f"{__name__}.{m.name}")
        prov = getattr(mod, "provider", None)
        if isinstance(prov, Provider):
            _registry[prov.name] = prov


_load()


def all_providers() -> dict[str, Provider]:
    return dict(_registry)


def resolve(names: list[str], country: str | None) -> tuple[list[Provider], dict[str, str]]:
    """Retourne (providers à lancer, {source: raison si ignorée})."""
    skipped: dict[str, str] = {}
    chosen: list[Provider] = []
    if "auto" in names:
        for p in _registry.values():
            if not p.supports(country):
                continue
            if not p.configured():
                skipped[p.name] = f"clé manquante ({p.key_env})"
                continue
            chosen.append(p)
        return chosen, skipped
    for n in names:
        p = _registry.get(n)
        if not p:
            skipped[n] = "source inconnue"
        elif not p.supports(country):
            skipped[n] = "pays non couvert par cette source"
        elif not p.configured():
            skipped[n] = f"clé manquante ({p.key_env})"
        else:
            chosen.append(p)
    return chosen, skipped