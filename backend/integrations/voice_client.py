"""Twilio Programmable Voice — browser calling from the sales dashboard."""

from __future__ import annotations

import re
from typing import Any

from config import settings


def normalize_e164(phone: str | None) -> str | None:
    """Normalize a phone string to E.164 (+country + number)."""
    if not phone:
        return None
    raw = phone.strip()
    if not raw or raw.lower() in {"not found", "n/a", "na", "none", "-"}:
        return None

    digits = re.sub(r"[^\d+]", "", raw)
    if digits.startswith("00"):
        digits = f"+{digits[2:]}"
    elif not digits.startswith("+"):
        digits = f"+{digits}"

    if re.fullmatch(r"\+\d{8,15}", digits):
        return digits
    return None


def mask_phone(phone: str | None) -> str | None:
    """Mask a phone number for display (e.g. +971****4567)."""
    normalized = normalize_e164(phone)
    if not normalized or len(normalized) < 8:
        return None
    return f"{normalized[:4]}****{normalized[-4:]}"


class VoiceClient:
    @property
    def is_configured(self) -> bool:
        return bool(
            settings.twilio_account_sid
            and settings.twilio_auth_token
            and settings.twilio_phone_number
        )

    @property
    def webhooks_ready(self) -> bool:
        return self.is_configured and bool(settings.twilio_webhook_base_url)

    @property
    def browser_ready(self) -> bool:
        return bool(
            self.webhooks_ready
            and settings.twilio_api_key_sid
            and settings.twilio_api_key_secret
            and settings.twilio_twiml_app_sid
        )

    def webhook_url(self, path: str) -> str:
        base = (settings.twilio_webhook_base_url or "").rstrip("/")
        if not base:
            raise RuntimeError(
                "TWILIO_WEBHOOK_BASE_URL is not set — Twilio needs a public HTTPS URL "
                "(use ngrok for local dev, or your Railway/production API URL)."
            )
        if not path.startswith("/"):
            path = f"/{path}"
        return f"{base}{path}"

    def validate_webhook(self, url: str, params: dict[str, str], signature: str) -> bool:
        if not settings.twilio_validate_webhooks:
            return True
        if not settings.twilio_auth_token or not signature:
            return False
        from twilio.request_validator import RequestValidator

        validator = RequestValidator(settings.twilio_auth_token)
        return validator.validate(url, params, signature)

    def create_access_token(self, *, identity: str = "sales-agent") -> str:
        if not self.browser_ready:
            raise RuntimeError(
                "Browser calling is not configured. Set TWILIO_API_KEY_SID, "
                "TWILIO_API_KEY_SECRET, and TWILIO_TWIML_APP_SID in backend/.env"
            )
        from twilio.jwt.access_token import AccessToken
        from twilio.jwt.access_token.grants import VoiceGrant

        token = AccessToken(
            settings.twilio_account_sid,
            settings.twilio_api_key_sid,
            settings.twilio_api_key_secret,
            identity=identity,
            ttl=3600,
        )
        grant = VoiceGrant(
            outgoing_application_sid=settings.twilio_twiml_app_sid,
            incoming_allow=False,
        )
        token.add_grant(grant)
        jwt = token.to_jwt()
        return jwt.decode("utf-8") if isinstance(jwt, bytes) else str(jwt)

    def client_dial_twiml(self, lead_phone: str, interaction_id: int) -> str:
        """TwiML for browser-initiated outbound calls — dials the lead directly."""
        lead = normalize_e164(lead_phone) or lead_phone
        caller_id = settings.twilio_phone_number or ""
        status_url = self.webhook_url(
            f"/api/webhooks/twilio/voice/status?interaction_id={interaction_id}"
        )
        recording_url = self.webhook_url(
            f"/api/webhooks/twilio/voice/recording?interaction_id={interaction_id}"
        )
        return (
            '<?xml version="1.0" encoding="UTF-8"?>'
            "<Response>"
            f'<Dial callerId="{caller_id}" answerOnBridge="true" '
            f'record="record-from-answer" '
            f'recordingStatusCallback="{recording_url}" '
            f'recordingStatusCallbackMethod="POST" '
            f'recordingStatusCallbackEvent="completed" '
            f'action="{status_url}" method="POST">{lead}</Dial>'
            "</Response>"
        )

    def setup_hints(self) -> dict[str, Any]:
        missing: list[str] = []
        if not settings.twilio_account_sid:
            missing.append("TWILIO_ACCOUNT_SID")
        if not settings.twilio_auth_token:
            missing.append("TWILIO_AUTH_TOKEN")
        if not settings.twilio_phone_number:
            missing.append("TWILIO_PHONE_NUMBER")
        if not settings.twilio_webhook_base_url:
            missing.append("TWILIO_WEBHOOK_BASE_URL")
        if not settings.twilio_api_key_sid:
            missing.append("TWILIO_API_KEY_SID")
        if not settings.twilio_api_key_secret:
            missing.append("TWILIO_API_KEY_SECRET")
        if not settings.twilio_twiml_app_sid:
            missing.append("TWILIO_TWIML_APP_SID")
        return {"missing": missing, "browser_ready": self.browser_ready}


voice_client = VoiceClient()
