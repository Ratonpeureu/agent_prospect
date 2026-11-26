from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "sqlite:///./prospect.db"
    DATA_DIR: str = "./data"
    API_KEY: str = ""
    CONTACT_EMAIL: str = "contact@example.com"

    COMPANIES_HOUSE_API_KEY: str = ""
    INSEE_API_KEY: str = ""

    SMTP_CHECK_ENABLED: bool = True
    SMTP_HELO_DOMAIN: str = "example.com"
    SMTP_MAIL_FROM: str = "verify@example.com"
    SMTP_TIMEOUT: int = 10
    VERIFY_WORKERS: int = 20

    PROVIDER_TIMEOUT: int = 60
    PROVIDER_WORKERS: int = 4
    CRAWL_TIMEOUT: int = 10
    CRAWL_WORKERS: int = 8
    DISCOVERY_MAX_ROLE: int = 5
    
    SITE_FINDER_ENABLED: bool = True
    SITE_FINDER_WEB: bool = True
    DISCOVERY_FALLBACK_GENERIC: bool = True

    # --- Journal / robustesse ---
    LOG_LEVEL: str = "INFO"            # DEBUG = détail de chaque appel HTTP
    SLOW_REQUEST_S: float = 2.0        # requête API considérée lente
    SLOW_OP_S: float = 8.0             # opération (source, crawl, SMTP, HTTP) considérée lente
    SLOW_BATCH_S: float = 180.0        # lot d'enrichissement / vérification considéré lent
    JOB_STALL_SECONDS: int = 300       # tâche sans progression = "bloquée ?"
    JOB_MAX_ATTEMPTS: int = 3          # reprises automatiques max (protège d'une boucle de crash)
    DB_POOL_SIZE: int = 15
    DB_MAX_OVERFLOW: int = 25

    GITHUB_TOKEN: str = ""
    PEOPLE_MAX_PER_COMPANY: int = 15

    @property
    def USER_AGENT(self) -> str:
        return f"ProspectTool/2.0 (+mailto:{self.CONTACT_EMAIL})"


settings = Settings()