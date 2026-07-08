"""Twilio Programmable Voice — bridge calls from the sales dashboard."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

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

    def _client(self):
        if not self.is_configured:
            raise RuntimeError("Twilio is not configured")
        from twilio.rest import Client

        return Client(settings.twilio_account_sid, settings.twilio_auth_token)

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

    def initiate_bridge_call(
        self,
        *,
        agent_phone: str,
        lead_phone: str,
        interaction_id: int,
    ) -> dict[str, Any]:
        """Ring the sales rep first; TwiML connects them to the lead when they answer."""
        agent = normalize_e164(agent_phone)
        lead = normalize_e164(lead_phone)
        if not agent:
            return {"status": "error", "message": "Agent phone must be in international format (+92…, +1…)."}
        if not lead:
            return {"status": "error", "message": "Lead phone must be in international format (+971…, +44…)."}

        connect_url = self.webhook_url(
            "/api/webhooks/twilio/voice/connect"
            f"?To={quote(lead)}&interaction_id={interaction_id}"
        )
        status_url = self.webhook_url(
            f"/api/webhooks/twilio/voice/status?interaction_id={interaction_id}"
        )

        try:
            call = self._client().calls.create(
                to=agent,
                from_=settings.twilio_phone_number,
                url=connect_url,
                method="POST",
                status_callback=status_url,
                status_callback_event=["completed", "busy", "no-answer", "failed", "canceled"],
                status_callback_method="POST",
            )
        except Exception as exc:
            return {"status": "error", "message": str(exc)}

        return {
            "status": "initiated",
            "message": f"Calling your phone ({agent}). Answer to connect to the lead.",
            "call_sid": call.sid,
            "call_status": call.status,
            "agent_phone": agent,
            "lead_phone": lead,
        }

    def connect_twiml(self, lead_phone: str) -> str:
        lead = normalize_e164(lead_phone) or lead_phone
        caller_id = settings.twilio_phone_number or ""
        return (
            '<?xml version="1.0" encoding="UTF-8"?>'
            "<Response>"
            f'<Dial callerId="{caller_id}">{lead}</Dial>'
            "</Response>"
        )


voice_client = VoiceClient()
