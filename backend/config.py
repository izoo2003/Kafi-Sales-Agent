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

    serpapi_api_key: str | None = None
    gmail_client_id: str | None = None
    gmail_client_secret: str | None = None
    gmail_refresh_token: str | None = None
    gmail_sender_email: str | None = None
    # Only show inbox mail on/after this date (YYYY-MM-DD). If unset, auto-set to connect day.
    gmail_inbox_since: str | None = None

    # Outlook shared inbox via IMAP (receive) + SMTP (send) — integrations/outlook_client.py
    # Standard Outlook/Office 365 servers are the defaults; only email + password are required.
    mailbox_imap_host: str = "outlook.office365.com"
    mailbox_imap_port: int = 993
    mailbox_smtp_host: str = "smtp.office365.com"
    mailbox_smtp_port: int = 587
    mailbox_email: str | None = None
    mailbox_password: str | None = None
    mailbox_display_name: str | None = None
    # OAuth — required for most Outlook.com accounts (password/IMAP basic auth is blocked).
    mailbox_client_id: str | None = None
    mailbox_client_secret: str | None = None
    mailbox_refresh_token: str | None = None
    mailbox_tenant_id: str = "consumers"  # personal Outlook/Hotmail; use tenant id for work accounts

    # Gemini LLM (see modules/llm_client.py) — loaded from .env into Settings, not os.environ.
    gemini_api_key: str | None = None
    llm_api_key: str | None = None  # legacy alias for gemini_api_key
    gemini_api_keys: str | None = None  # optional comma-separated extra keys
    gemini_model: str = "gemini-2.5-flash-lite"
    gemini_fallback_models: str | None = None
    gemini_max_output_tokens: int = 512

    # Web search — see modules/web_search.py
    brave_api_key: str | None = None
    google_cse_api_key: str | None = None
    google_cse_engine_id: str | None = None
    # Fallback chain for market discovery (first provider that returns results).
    web_search_providers: str | None = None
    # Per-record enrichment: ALL listed providers run and results merge (default serpapi+duckduckgo).
    web_search_combined_providers: str | None = None

    # Twilio Voice — international outbound calls (integrations/voice_client.py)
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_phone_number: str | None = None
    twilio_agent_phone: str | None = None
    # Public HTTPS base URL for Twilio webhooks (e.g. https://your-api.railway.app or ngrok URL)
    twilio_webhook_base_url: str | None = None

    # Bulk email throttling (Gmail-safe batching)
    bulk_email_batch_size: int = 50
    bulk_email_message_delay_seconds: float = 3.0
    bulk_email_batch_pause_seconds: float = 60.0
    bulk_email_max_per_request: int = 50

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
