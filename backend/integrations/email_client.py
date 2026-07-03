"""Gmail API client — sends only after human approval in the dashboard."""

from __future__ import annotations

import base64
from email.mime.text import MIMEText
from typing import Any

from config import settings


class EmailClient:
    @property
    def is_configured(self) -> bool:
        return bool(
            settings.gmail_client_id
            and settings.gmail_client_secret
            and settings.gmail_refresh_token
        )

    def create_draft(self, *, to: str, subject: str, body: str) -> dict[str, Any]:
        return {
            "status": "draft_only",
            "message": "Draft saved in database. Approve in the dashboard to send.",
            "to": to,
            "subject": subject,
        }

    def send_approved(self, *, to: str, subject: str, body: str) -> dict[str, Any]:
        if not self.is_configured:
            return {
                "status": "not_configured",
                "message": (
                    "Gmail API is not configured. Set GMAIL_CLIENT_ID, "
                    "GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in backend/.env"
                ),
            }

        if not to:
            return {"status": "error", "message": "Recipient email is missing"}

        try:
            from google.oauth2.credentials import Credentials
            from googleapiclient.discovery import build
        except ImportError as exc:
            return {
                "status": "error",
                "message": "Gmail dependencies not installed. Run: pip install google-api-python-client google-auth",
            }

        creds = Credentials(
            token=None,
            refresh_token=settings.gmail_refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.gmail_client_id,
            client_secret=settings.gmail_client_secret,
        )

        message = MIMEText(body, "plain", "utf-8")
        message["to"] = to
        message["subject"] = subject
        if settings.gmail_sender_email:
            message["from"] = settings.gmail_sender_email

        raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")

        try:
            service = build("gmail", "v1", credentials=creds, cache_discovery=False)
            result = service.users().messages().send(userId="me", body={"raw": raw}).execute()
        except Exception as exc:
            return {"status": "error", "message": f"Gmail send failed: {exc}"}

        return {
            "status": "sent",
            "message": "Email sent via Gmail",
            "to": to,
            "subject": subject,
            "message_id": result.get("id"),
        }


email_client = EmailClient()
