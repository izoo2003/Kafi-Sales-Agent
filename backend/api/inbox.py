"""Inbox API — per-user IMAP mailbox and replies from the dashboard."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from api.schemas import (
    InboxAnalyzeRequest,
    InboxAnalyzeResponse,
    InboxComposeRequest,
    InboxComposeResponse,
    InboxEmptyTrashResponse,
    InboxFoldersResponse,
    InboxMessageDetail,
    InboxMessageSummary,
    InboxMoveRequest,
    InboxMoveResponse,
    InboxReplyRequest,
    InboxReplyResponse,
    InboxStatus,
    InboxThreadDetail,
    InboxThreadMoveRequest,
    InboxThreadSummary,
    InboxUnreadCount,
)
from db.models import AppUser
from modules import inbox as inbox_module
from modules import inbox_assistant as inbox_assistant_module
from modules.mailbox_accounts import hosts_enabled, resolve_user_mailbox

router = APIRouter(prefix="/inbox", tags=["inbox"])

_VALID_FOLDERS = {"inbox", "sent", "trash", "archive"}


def _guard_configured(user: AppUser) -> None:
    if not hosts_enabled():
        raise HTTPException(
            503,
            "Inbox is not enabled. Set MAILBOX_ENABLED=true and IMAP/SMTP hosts in backend/.env",
        )
    if not resolve_user_mailbox(user):
        raise HTTPException(
            503,
            "No mailbox configured for your account. Ask an admin to set your company email on the Users page.",
        )


def _inbox_error_message(exc: Exception) -> str:
    return f"Could not read inbox: {exc}"


@router.get("/status", response_model=InboxStatus)
def inbox_status(user: AppUser = Depends(get_current_user)):
    return inbox_module.status(user)


@router.get("/folders", response_model=InboxFoldersResponse)
def inbox_folders(user: AppUser = Depends(get_current_user)):
    return inbox_module.list_folders(user)


@router.get("/unread-count", response_model=InboxUnreadCount)
def inbox_unread_count(user: AppUser = Depends(get_current_user)):
    return {"count": inbox_module.unread_count(user)}


@router.post("/reset-cutoff")
def reset_inbox_cutoff(user: AppUser = Depends(get_current_user)):
    _guard_configured(user)
    return inbox_module.reset_cutoff(user)


@router.post("/clear-cutoff")
def clear_inbox_cutoff(user: AppUser = Depends(get_current_user)):
    """Show all mailbox mail again (undo 'New mail only')."""
    _guard_configured(user)
    return inbox_module.clear_cutoff(user)


@router.get("/threads", response_model=list[InboxThreadSummary])
def list_inbox_threads(
    limit: int = Query(default=30, ge=1, le=100),
    unread_only: bool = Query(default=False),
    user: AppUser = Depends(get_current_user),
):
    _guard_configured(user)
    try:
        return inbox_module.list_threads(user, limit=limit, unread_only=unread_only)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, _inbox_error_message(exc)) from exc


@router.get("/threads/{thread_id}", response_model=InboxThreadDetail)
def get_inbox_thread(thread_id: str, user: AppUser = Depends(get_current_user)):
    _guard_configured(user)
    try:
        thread = inbox_module.get_thread(user, thread_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Could not read conversation: {exc}") from exc
    if not thread:
        raise HTTPException(404, "Conversation not found")
    return thread


@router.post("/compose", response_model=InboxComposeResponse)
def compose_inbox_mail(
    payload: InboxComposeRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    """Compose and send a new email from the logged-in user's mailbox."""
    from modules import activity as activity_module

    _guard_configured(user)
    try:
        result = inbox_module.compose(
            user,
            to=payload.to,
            subject=payload.subject,
            body=payload.body,
            cc=payload.cc,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Could not send email: {exc}") from exc
    if result.get("status") != "sent":
        raise HTTPException(502, result.get("message", "Send failed"))

    subject = result.get("subject") or payload.subject or "(no subject)"
    to_addr = result.get("to") or payload.to
    activity_module.log_activity(
        db,
        user_id=user.id,
        activity_type=activity_module.INBOX_REPLIED,
        title="Compose email sent",
        summary=f"Sent “{subject}” → {to_addr}",
        entity_type="inbox_compose",
        entity_id=None,
        details={
            "subject": subject,
            "to": to_addr,
            "from": result.get("from"),
        },
    )
    return {
        "status": result.get("status", "sent"),
        "message": result.get("message", "Sent"),
        "to": to_addr,
        "subject": subject,
        "from_email": result.get("from"),
    }


@router.post("/threads/{thread_id}/reply", response_model=InboxReplyResponse)
def reply_inbox_thread(
    thread_id: str,
    payload: InboxReplyRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    from modules import activity as activity_module

    _guard_configured(user)
    try:
        result = inbox_module.reply_to_thread(
            user,
            thread_id,
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
        entity_type="inbox_thread",
        entity_id=None,
        details={"thread_id": thread_id, "subject": subject, "to": to_addr},
    )
    return result


@router.post("/threads/{thread_id}/move", response_model=InboxMoveResponse)
def move_inbox_thread(
    thread_id: str,
    payload: InboxThreadMoveRequest,
    user: AppUser = Depends(get_current_user),
):
    _guard_configured(user)
    to_folder = payload.to_folder.strip().lower()
    if to_folder not in ("inbox", "trash", "archive"):
        raise HTTPException(400, "to_folder must be inbox, trash, or archive")
    try:
        result = inbox_module.move_thread_messages(user, thread_id, to_folder=to_folder)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Could not move conversation: {exc}") from exc
    if result.get("status") != "ok":
        raise HTTPException(502, result.get("message", "Move failed"))
    return {
        "status": result.get("status", "ok"),
        "message": result.get("message", "Moved"),
        "to_folder": result.get("to_folder"),
        "to_folder_key": result.get("to_folder"),
        "moved_count": result.get("moved_count", 0),
    }


@router.post("/threads/{thread_id}/analyze", response_model=InboxAnalyzeResponse)
def analyze_inbox_thread(
    thread_id: str,
    payload: InboxAnalyzeRequest = InboxAnalyzeRequest(),
    user: AppUser = Depends(get_current_user),
):
    """Summarize a conversation and draft a reply the rep can edit before sending."""
    _guard_configured(user)
    try:
        result = inbox_assistant_module.analyze_inbox_thread(
            user, thread_id, goal=payload.goal
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Could not analyze conversation: {exc}") from exc
    if not result:
        raise HTTPException(404, "Conversation not found")
    return result


@router.post("/messages/{uid}/analyze", response_model=InboxAnalyzeResponse)
def analyze_inbox_message(
    uid: str,
    payload: InboxAnalyzeRequest = InboxAnalyzeRequest(),
    user: AppUser = Depends(get_current_user),
):
    """Summarize a single message and draft a reply."""
    _guard_configured(user)
    folder = payload.folder or "INBOX"
    try:
        result = inbox_assistant_module.analyze_inbox_message(
            user, uid, folder=folder, goal=payload.goal
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Could not analyze message: {exc}") from exc
    if not result:
        raise HTTPException(404, "Message not found")
    return result


@router.get("/messages", response_model=list[InboxMessageSummary])
def list_inbox_messages(
    limit: int = Query(default=25, ge=1, le=100),
    unread_only: bool = Query(default=False),
    folder: str = Query(default="inbox", description="Logical folder: inbox|sent|trash|archive"),
    user: AppUser = Depends(get_current_user),
):
    _guard_configured(user)
    key = folder.strip().lower()
    if key not in _VALID_FOLDERS:
        raise HTTPException(400, f"folder must be one of: {', '.join(sorted(_VALID_FOLDERS))}")
    try:
        return inbox_module.list_messages(
            user, limit=limit, unread_only=unread_only, folder=key
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, _inbox_error_message(exc)) from exc


@router.get("/messages/{uid}", response_model=InboxMessageDetail)
def get_inbox_message(
    uid: str,
    folder: str = Query(default="INBOX"),
    user: AppUser = Depends(get_current_user),
):
    _guard_configured(user)
    try:
        message = inbox_module.get_message(user, uid, folder=folder)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Could not read message: {exc}") from exc
    if not message:
        raise HTTPException(404, "Message not found")
    return message


@router.post("/messages/{uid}/read", response_model=InboxUnreadCount)
def mark_inbox_message_read(
    uid: str,
    folder: str = Query(default="INBOX"),
    user: AppUser = Depends(get_current_user),
):
    _guard_configured(user)
    try:
        inbox_module.mark_read(user, uid, True, folder=folder)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Could not update message: {exc}") from exc
    return {"count": inbox_module.unread_count(user)}


@router.post("/messages/{uid}/move", response_model=InboxMoveResponse)
def move_inbox_message(
    uid: str,
    payload: InboxMoveRequest,
    user: AppUser = Depends(get_current_user),
):
    _guard_configured(user)
    to_folder = payload.to_folder.strip().lower()
    if to_folder not in _VALID_FOLDERS:
        raise HTTPException(400, f"to_folder must be one of: {', '.join(sorted(_VALID_FOLDERS))}")
    try:
        result = inbox_module.move_message(
            user,
            uid,
            from_folder=payload.from_folder,
            to_folder=to_folder,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Could not move message: {exc}") from exc
    if result.get("status") != "ok":
        raise HTTPException(502, result.get("message", "Move failed"))
    return {
        "status": result.get("status", "ok"),
        "message": result.get("message", "Moved"),
        "from_folder": result.get("from_folder"),
        "to_folder": result.get("to_folder"),
        "to_folder_key": result.get("to_folder_key"),
        "moved_count": 1,
    }


@router.post("/trash/empty", response_model=InboxEmptyTrashResponse)
def empty_inbox_trash(user: AppUser = Depends(get_current_user)):
    _guard_configured(user)
    try:
        result = inbox_module.empty_trash(user)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Could not empty trash: {exc}") from exc
    if result.get("status") != "ok":
        raise HTTPException(502, result.get("message", "Empty trash failed"))
    return result


@router.post("/messages/{uid}/reply", response_model=InboxReplyResponse)
def reply_inbox_message(
    uid: str,
    payload: InboxReplyRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    from modules import activity as activity_module

    _guard_configured(user)
    try:
        result = inbox_module.reply(
            user,
            uid,
            payload.body,
            folder=payload.folder or "INBOX",
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
