"""Outbound email — uses the active user's cPanel mailbox (SMTP AUTH),
or Microsoft Graph Mail.Send when Outlook OAuth is configured instead."""

from __future__ import annotations

from typing import Any

from db.models import AppUser
from integrations.outlook_client import outlook_client
from modules.mailbox_accounts import (
    hosts_enabled,
    resolve_user_mailbox,
    use_mailbox,
    user_mailbox_configured,
)


class MailClient:
    def is_configured_for(self, user: AppUser | None = None) -> bool:
        if user is not None:
            return hosts_enabled() and user_mailbox_configured(user)
        return outlook_client.is_configured

    @property
    def is_configured(self) -> bool:
        return hosts_enabled() and (
            outlook_client.is_configured or bool(settings_mailbox_fallback())
        )

    def mailbox_email(self, user: AppUser | None = None) -> str | None:
        if user is not None:
            account = resolve_user_mailbox(user)
            return account.email if account else None
        from config import settings

        return settings.mailbox_email if outlook_client.is_configured else None

    def send_approved(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        attachments: list[dict] | None = None,
        interaction_id: int | None = None,
        send_mode: str = "individual",
        mailbox_user: AppUser | None = None,
    ) -> dict[str, Any]:
        account = resolve_user_mailbox(mailbox_user) if mailbox_user is not None else None
        if mailbox_user is not None and account is None:
            return {
                "status": "not_configured",
                "message": (
                    "No mailbox configured for your account. "
                    "Ask an admin to set your company email on the Users page."
                ),
            }
        with use_mailbox(account):
            if not outlook_client.is_configured:
                return {
                    "status": "not_configured",
                    "message": (
                        "Mailbox is not enabled. Set MAILBOX_ENABLED=true and "
                        "configure this user's mailbox credentials."
                    ),
                }
            return outlook_client.send_approved(
                to=to,
                subject=subject,
                body=body,
                attachments=attachments,
                interaction_id=interaction_id,
                send_mode=send_mode,
            )


def settings_mailbox_fallback() -> bool:
    from config import settings

    return bool(settings.mailbox_email and settings.mailbox_password)


mail_client = MailClient()
