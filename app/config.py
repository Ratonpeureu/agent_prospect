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

    @property
    def USER_AGENT(self) -> str:
        return f"ProspectTool/2.0 (+mailto:{self.CONTACT_EMAIL})"


settings = Settings()