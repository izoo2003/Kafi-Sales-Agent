from pathlib import Path

from pydantic import ValidationInfo, field_validator
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
    inbox_since: str | None = None
    gmail_inbox_since: str | None = None  # legacy alias — use INBOX_SINCE instead

    # Outlook shared inbox via IMAP (receive) + SMTP (send) — integrations/outlook_client.py
    # Set MAILBOX_ENABLED=true when ready to use Inbox / Approve & Send.
    mailbox_enabled: bool = False
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
    gemini_model: str = "gemini-3.1-flash-lite"
    gemini_fallback_models: str | None = None
    gemini_max_output_tokens: int = 512

    # Product chatbot only — separate keys from GEMINI_API_KEY / llm_client.py
    chatbot_gemini_api_key: str | None = None
    chatbot_gemini_api_keys: str | None = None  # optional comma-separated extra keys
    chatbot_gemini_fallback_models: str | None = None
    chatbot_openai_api_key: str | None = None
    chatbot_openai_model: str = "gpt-4o-mini"
    chatbot_anthropic_api_key: str | None = None
    chatbot_anthropic_model: str = "claude-3-5-haiku-20241022"

    # Web search — see modules/web_search.py
    brave_api_key: str | None = None
    google_cse_api_key: str | None = None
    google_cse_engine_id: str | None = None
    # Fallback chain for market discovery (first provider that returns results).
    web_search_providers: str | None = None
    # Per-record enrichment: ALL listed providers run and results merge (default serpapi+duckduckgo).
    web_search_combined_providers: str | None = None

    # Twilio Voice — browser calling from dashboard (integrations/voice_client.py)
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_phone_number: str | None = None
    twilio_api_key_sid: str | None = None
    twilio_api_key_secret: str | None = None
    twilio_twiml_app_sid: str | None = None
    # Public HTTPS base URL for Twilio webhooks (e.g. https://your-api.railway.app or ngrok URL)
    twilio_webhook_base_url: str | None = None
    # Validate X-Twilio-Signature on webhooks (set false only for local debugging)
    twilio_validate_webhooks: bool = True

    # Bulk email throttling (Gmail-safe batching)
    bulk_email_batch_size: int = 50
    bulk_email_message_delay_seconds: float = 3.0
    bulk_email_batch_pause_seconds: float = 60.0
    bulk_email_max_per_request: int = 50

    @field_validator("mailbox_imap_port", "mailbox_smtp_port", mode="before")
    @classmethod
    def _empty_port_uses_default(cls, value: object, info: ValidationInfo) -> object:
        if value == "" or value is None:
            return 993 if info.field_name == "mailbox_imap_port" else 587
        return value

    @field_validator(
        "mailbox_email",
        "mailbox_password",
        "mailbox_display_name",
        "mailbox_client_id",
        "mailbox_client_secret",
        "mailbox_refresh_token",
        mode="before",
    )
    @classmethod
    def _empty_str_to_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
