"""Inbox API — read the Outlook mailbox and send replies from the dashboard."""

from fastapi import APIRouter, HTTPException, Query

from api.schemas import (
    InboxMessageDetail,
    InboxMessageSummary,
    InboxReplyRequest,
    InboxReplyResponse,
    InboxStatus,
    InboxUnreadCount,
)
from modules import inbox as inbox_module

router = APIRouter(prefix="/inbox", tags=["inbox"])


def _guard_configured() -> None:
    if not inbox_module.is_configured():
        raise HTTPException(
            503,
            "Outlook inbox is not configured. Set MAILBOX_EMAIL and MAILBOX_REFRESH_TOKEN "
            "(or MAILBOX_PASSWORD) in backend/.env. Run: python scripts/get_outlook_refresh_token.py",
        )


def _inbox_error_message(exc: Exception) -> str:
    text = str(exc)
    if "no longer allows this" in text.lower() or "app-password" in text.lower():
        return (
            "Outlook app passwords no longer work for @outlook.com. "
            "Run: python scripts/get_outlook_refresh_token.py "
            "then add MAILBOX_CLIENT_ID and MAILBOX_REFRESH_TOKEN to backend/.env "
            "(remove MAILBOX_PASSWORD)."
        )
    if "oauth is not configured" in text.lower():
        return (
            "Outlook OAuth is not set up. Add MAILBOX_CLIENT_ID and MAILBOX_REFRESH_TOKEN "
            "to backend/.env — run: python scripts/get_outlook_refresh_token.py"
        )
    if "invalid_grant" in text.lower() or "token refresh failed" in text.lower():
        return (
            "Outlook refresh token expired or invalid. Re-run: "
            "python scripts/get_outlook_refresh_token.py and update backend/.env"
        )
    if "oauth" in text.lower() or "xoauth2" in text.lower():
        return f"Outlook OAuth failed: {text}"
    return f"Could not read Outlook inbox: {exc}"


@router.get("/status", response_model=InboxStatus)
def inbox_status():
    return inbox_module.status()


@router.get("/unread-count", response_model=InboxUnreadCount)
def inbox_unread_count():
    return {"count": inbox_module.unread_count()}


@router.post("/reset-cutoff")
def reset_inbox_cutoff():
    _guard_configured()
    return inbox_module.reset_cutoff()


@router.get("/messages", response_model=list[InboxMessageSummary])
def list_inbox_messages(
    limit: int = Query(default=25, ge=1, le=100),
    unread_only: bool = Query(default=False),
):
    _guard_configured()
    try:
        return inbox_module.list_messages(limit=limit, unread_only=unread_only)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, _inbox_error_message(exc)) from exc


@router.get("/messages/{uid}", response_model=InboxMessageDetail)
def get_inbox_message(uid: str):
    _guard_configured()
    try:
        message = inbox_module.get_message(uid)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Could not read message: {exc}") from exc
    if not message:
        raise HTTPException(404, "Message not found")
    return message


@router.post("/messages/{uid}/read", response_model=InboxUnreadCount)
def mark_inbox_message_read(uid: str):
    _guard_configured()
    try:
        inbox_module.mark_read(uid, True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Could not update message: {exc}") from exc
    return {"count": inbox_module.unread_count()}


@router.post("/messages/{uid}/reply", response_model=InboxReplyResponse)
def reply_inbox_message(uid: str, payload: InboxReplyRequest):
    _guard_configured()
    try:
        result = inbox_module.reply(
            uid,
            payload.body,
            to=payload.to,
            subject=payload.subject,
            cc=payload.cc,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Could not send reply: {exc}") from exc
    if result.get("status") != "sent":
        raise HTTPException(502, result.get("message", "Reply failed"))
    return result
