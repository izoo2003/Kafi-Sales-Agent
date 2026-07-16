"""Inbox — company Outlook mailbox (receives mail from Gmail, Outlook, and any provider)."""

from __future__ import annotations

from typing import Any

from config import settings
from integrations.outlook_client import outlook_client
from modules.email_threads import group_messages_into_threads, message_key
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

    from modules.inbox_cutoff import has_active_cutoff

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
        "showing_since": get_inbox_since().isoformat() if has_active_cutoff() else None,
    }


def list_messages(*, limit: int = 25, unread_only: bool = False) -> list[dict[str, Any]]:
    messages = outlook_client.list_messages(limit=limit, unread_only=unread_only)
    return [{**message, "provider": "outlook"} for message in messages]


def get_message(uid: str, *, folder: str = "INBOX") -> dict[str, Any] | None:
    message = outlook_client.get_message(uid, folder=folder)
    if not message:
        return None
    return {**message, "provider": "outlook"}


def unread_count() -> int:
    if not outlook_client.is_configured:
        return 0
    return outlook_client.unread_count()


def mark_read(uid: str, seen: bool = True, *, folder: str = "INBOX") -> None:
    outlook_client.mark_read(uid, seen, folder=folder)


def reset_cutoff() -> dict[str, str]:
    return {"showing_since": set_inbox_since_to_now().isoformat()}


def clear_cutoff() -> dict[str, str | None]:
    from modules.inbox_cutoff import clear_inbox_cutoff

    clear_inbox_cutoff()
    return {"showing_since": None}


def _strip_thread_internals(thread: dict[str, Any]) -> dict[str, Any]:
    return {
        "thread_id": thread["thread_id"],
        "subject": thread["subject"],
        "participants": thread["participants"],
        "message_count": thread["message_count"],
        "unread_count": thread["unread_count"],
        "latest_date": thread["latest_date"],
        "latest_preview": thread["latest_preview"],
        "latest_from_email": thread["latest_from_email"],
        "latest_from_name": thread["latest_from_name"],
        "has_attachments": thread["has_attachments"],
        "provider": "outlook",
    }


def list_threads(*, limit: int = 40, unread_only: bool = False) -> list[dict[str, Any]]:
    # Unchecked = all recent conversations; checked = only threads with unread mail.
    fetch_limit = max(limit * 4, 120)
    raw = outlook_client.list_conversation_messages(
        limit=fetch_limit,
        unread_only=unread_only,
    )
    stamped = [{**m, "provider": "outlook"} for m in raw]
    threads = group_messages_into_threads(stamped, mailbox_email=settings.mailbox_email)
    if unread_only:
        threads = [t for t in threads if t.get("unread_count", 0) > 0]
    return [_strip_thread_internals(t) for t in threads[:limit]]


def get_thread(thread_id: str, *, mark_seen: bool = True) -> dict[str, Any] | None:
    raw = outlook_client.list_conversation_messages(limit=120, unread_only=False)
    stamped = [{**m, "provider": "outlook"} for m in raw]
    threads = group_messages_into_threads(stamped, mailbox_email=settings.mailbox_email)
    match = next((t for t in threads if t["thread_id"] == thread_id), None)
    if not match:
        return None

    details = outlook_client.get_messages_by_keys(match["message_keys"])
    detail_by_key = {message_key(m): {**m, "provider": "outlook"} for m in details}
    ordered = [detail_by_key[k] for k in match["message_keys"] if k in detail_by_key]

    if mark_seen:
        for msg in ordered:
            if msg.get("unread") and msg.get("direction") != "outbound":
                try:
                    mark_read(str(msg["uid"]), True, folder=msg.get("folder") or "INBOX")
                    msg["unread"] = False
                except Exception:  # noqa: BLE001
                    pass

    summary = _strip_thread_internals(match)
    summary["unread_count"] = sum(1 for m in ordered if m.get("unread"))
    summary["messages"] = ordered
    return summary


def _reply_subject(original_subject: str | None) -> str:
    subject = (original_subject or "").strip()
    if subject.lower().startswith("re:"):
        return subject
    return f"Re: {subject}" if subject else "Re:"


def _quote_original(original: dict[str, Any]) -> str:
    """Build a plain-text quote of the original message for reply context."""
    sender = original.get("from_name") or original.get("from_email") or "sender"
    when = original.get("date")
    when_label = ""
    if when is not None:
        try:
            when_label = when.strftime("%Y-%m-%d %H:%M") if hasattr(when, "strftime") else str(when)
        except Exception:  # noqa: BLE001
            when_label = str(when)

    raw = (original.get("body_text") or "").strip()
    if not raw and original.get("body_html"):
        import re

        raw = re.sub(r"<[^>]+>", " ", original["body_html"] or "")
        raw = re.sub(r"\s+", " ", raw).strip()
    if not raw:
        raw = (original.get("preview") or "").strip()

    quoted_lines = [f"> {line}" if line else ">" for line in raw.splitlines()] or [">"]
    header = f"On {when_label}, {sender} wrote:" if when_label else f"{sender} wrote:"
    return "\n".join([header, *quoted_lines])


def reply(
    uid: str,
    body: str,
    *,
    folder: str = "INBOX",
    to: str | None = None,
    subject: str | None = None,
    cc: str | None = None,
    include_quote: bool = True,
) -> dict[str, Any]:
    original = get_message(uid, folder=folder)
    if not original:
        return {"status": "error", "message": "Original message not found"}

    recipient = to or original.get("from_email")
    if original.get("direction") == "outbound" and not to:
        tos = original.get("to") or []
        recipient = tos[0] if tos else recipient

    reply_subject = subject or _reply_subject(original.get("subject"))
    send_body = (body or "").rstrip()
    if include_quote and original:
        quote = _quote_original(original)
        already_quoted = (
            send_body.lstrip().startswith("On ")
            or "\n>" in send_body
            or send_body.startswith(">")
        )
        if quote and not already_quoted:
            send_body = f"{send_body}\n\n{quote}" if send_body else quote

    result = outlook_client.send_reply(
        to=recipient,
        subject=reply_subject,
        body=send_body,
        cc=cc,
    )

    if result.get("status") == "sent":
        try:
            mark_read(uid, True, folder=folder)
        except Exception:  # noqa: BLE001
            pass
    return result


def reply_to_thread(
    thread_id: str,
    body: str,
    *,
    to: str | None = None,
    subject: str | None = None,
    cc: str | None = None,
) -> dict[str, Any]:
    thread = get_thread(thread_id, mark_seen=False)
    if not thread or not thread.get("messages"):
        return {"status": "error", "message": "Conversation not found"}

    messages = thread["messages"]
    target = None
    for msg in reversed(messages):
        if msg.get("direction") != "outbound":
            target = msg
            break
    if target is None:
        target = messages[-1]

    return reply(
        str(target["uid"]),
        body,
        folder=target.get("folder") or "INBOX",
        to=to,
        subject=subject or _reply_subject(thread.get("subject")),
        cc=cc,
        include_quote=True,
    )
