"""Inbox — company Outlook mailbox (receives mail from Gmail, Outlook, and any provider)."""

from __future__ import annotations

from typing import Any

from integrations.outlook_client import outlook_client
from modules.inbox_cutoff import get_inbox_since, set_inbox_since_to_now


def is_configured() -> bool:
    return outlook_client.is_configured


def status() -> dict[str, Any]:
    if not outlook_client.is_configured:
        return {
            "configured": False,
            "email": None,
            "emails": [],
            "mailboxes": [],
            "unread_count": 0,
            "showing_since": None,
        }

    from config import settings

    email = settings.mailbox_email
    unread = 0
    try:
        unread = outlook_client.unread_count()
    except Exception:  # noqa: BLE001
        unread = 0

    mailbox = {
        "provider": "outlook",
        "email": email,
        "configured": True,
    }
    return {
        "configured": True,
        "email": email,
        "emails": [email] if email else [],
        "mailboxes": [mailbox],
        "unread_count": unread,
        "showing_since": get_inbox_since().isoformat(),
    }


def list_messages(*, limit: int = 25, unread_only: bool = False) -> list[dict[str, Any]]:
    messages = outlook_client.list_messages(limit=limit, unread_only=unread_only)
    return [{**message, "provider": "outlook"} for message in messages]


def get_message(uid: str) -> dict[str, Any] | None:
    message = outlook_client.get_message(uid)
    if not message:
        return None
    return {**message, "provider": "outlook"}


def unread_count() -> int:
    if not outlook_client.is_configured:
        return 0
    return outlook_client.unread_count()


def mark_read(uid: str, seen: bool = True) -> None:
    outlook_client.mark_read(uid, seen)


def reset_cutoff() -> dict[str, str]:
    return {"showing_since": set_inbox_since_to_now().isoformat()}


def _reply_subject(original_subject: str | None) -> str:
    subject = (original_subject or "").strip()
    if subject.lower().startswith("re:"):
        return subject
    return f"Re: {subject}" if subject else "Re:"


def reply(
    uid: str,
    body: str,
    *,
    to: str | None = None,
    subject: str | None = None,
    cc: str | None = None,
) -> dict[str, Any]:
    original = get_message(uid)
    if not original:
        return {"status": "error", "message": "Original message not found"}

    recipient = to or original.get("from_email")
    reply_subject = subject or _reply_subject(original.get("subject"))
    message_id = original.get("message_id")

    result = outlook_client.send_reply(
        to=recipient,
        subject=reply_subject,
        body=body,
        in_reply_to=message_id,
        references=message_id,
        cc=cc,
    )

    if result.get("status") == "sent":
        try:
            mark_read(uid, True)
        except Exception:  # noqa: BLE001
            pass
    return result
