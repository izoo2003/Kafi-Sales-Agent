"""Inbox business logic — wraps the Gmail client and builds threaded replies."""

from __future__ import annotations

from typing import Any

from integrations.email_client import email_client


def is_configured() -> bool:
    return email_client.is_configured


def status() -> dict[str, Any]:
    if not email_client.is_configured:
        return {"configured": False, "email": None, "unread_count": 0}
    unread = 0
    try:
        unread = email_client.unread_count()
    except Exception:  # noqa: BLE001 — credentials set but API may still fail
        unread = 0
    return {
        "configured": True,
        "email": email_client.mailbox_email(),
        "unread_count": unread,
        "showing_since": email_client.inbox_since(),
    }


def list_messages(*, limit: int = 25, unread_only: bool = False) -> list[dict[str, Any]]:
    return email_client.list_messages(limit=limit, unread_only=unread_only)


def get_message(uid: str) -> dict[str, Any] | None:
    return email_client.get_message(uid)


def unread_count() -> int:
    if not email_client.is_configured:
        return 0
    return email_client.unread_count()


def mark_read(uid: str, seen: bool = True) -> None:
    email_client.mark_read(uid, seen)


def reset_cutoff() -> dict[str, str]:
    showing_since = email_client.reset_inbox_cutoff()
    return {"showing_since": showing_since}


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
    """Send a reply to a received message, threading it via In-Reply-To/References."""
    original = email_client.get_message(uid)
    if not original:
        return {"status": "error", "message": "Original message not found"}

    recipient = to or original.get("from_email")
    reply_subject = subject or _reply_subject(original.get("subject"))
    message_id = original.get("message_id")

    result = email_client.send_reply(
        to=recipient,
        subject=reply_subject,
        body=body,
        in_reply_to=message_id,
        references=message_id,
        cc=cc,
        thread_id=original.get("thread_id"),
    )

    if result.get("status") == "sent":
        try:
            email_client.mark_read(uid, True)
        except Exception:  # noqa: BLE001 — reply already sent; read-flag is best effort
            pass
    return result
