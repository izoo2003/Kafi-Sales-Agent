from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql://postgres:postgres@localhost:5432/kafi_sales_agent"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    api_debug: bool = True
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    gmail_client_id: str | None = None
    gmail_client_secret: str | None = None
    gmail_refresh_token: str | None = None
    gmail_sender_email: str | None = None

    serpapi_api_key: str | None = None

    # Web search — steps 1–2 only by default (brave → serpapi). See modules/web_search.py.
    brave_api_key: str | None = None
    google_cse_api_key: str | None = None
    google_cse_engine_id: str | None = None
    # Comma-separated provider order; default is "brave,serpapi" (no step-3 providers).
    web_search_providers: str | None = None

    # Bulk email throttling (Gmail-safe batching)
    bulk_email_batch_size: int = 50
    bulk_email_message_delay_seconds: float = 3.0
    bulk_email_batch_pause_seconds: float = 60.0
    bulk_email_max_per_request: int = 50

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
