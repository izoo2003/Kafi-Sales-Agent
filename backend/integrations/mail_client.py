"""Outbound email — uses the company Outlook mailbox (SMTP)."""

from __future__ import annotations

from typing import Any

from integrations.outlook_client import outlook_client


class MailClient:
    @property
    def is_configured(self) -> bool:
        return outlook_client.is_configured

    def mailbox_email(self) -> str | None:
        from config import settings

        return settings.mailbox_email if outlook_client.is_configured else None

    def send_approved(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        attachments: list[dict] | None = None,
    ) -> dict[str, Any]:
        return outlook_client.send_approved(
            to=to, subject=subject, body=body, attachments=attachments
        )


mail_client = MailClient()
