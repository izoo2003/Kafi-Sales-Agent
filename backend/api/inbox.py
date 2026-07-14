"""Inbox API — read the Outlook mailbox and send replies from the dashboard."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from api.schemas import (
    InboxMessageDetail,
    InboxMessageSummary,
    InboxReplyRequest,
    InboxReplyResponse,
    InboxStatus,
    InboxUnreadCount,
)
from db.models import AppUser
from modules import inbox as inbox_module

router = APIRouter(prefix="/inbox", tags=["inbox"])


def _guard_configured() -> None:
    if not inbox_module.is_configured():
        raise HTTPException(
            503,
            "Inbox is not enabled. Set MAILBOX_ENABLED=true and mailbox credentials in backend/.env",
        )


def _inbox_error_message(exc: Exception) -> str:
    return f"Could not read inbox: {exc}"


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
def reply_inbox_message(
    uid: str,
    payload: InboxReplyRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    from modules import activity as activity_module

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

    subject = result.get("subject") or payload.subject or "(no subject)"
    to_addr = result.get("to") or payload.to or ""
    activity_module.log_activity(
        db,
        user_id=user.id,
        activity_type=activity_module.INBOX_REPLIED,
        title="Inbox reply sent",
        summary=f"Replied to “{subject}”" + (f" → {to_addr}" if to_addr else ""),
        entity_type="inbox_message",
        entity_id=None,
        details={"uid": uid, "subject": subject, "to": to_addr},
    )
    return result
