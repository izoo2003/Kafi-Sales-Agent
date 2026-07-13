from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.deps import get_db
from api.schemas import (
    BulkApproveRequest,
    BulkApproveResponse,
    BulkEmailDraftRequest,
    BulkEmailDraftResponse,
    BulkEmailSettingsRead,
    DraftListResponse,
    EmailDraftRequest,
    InteractionApprove,
    InteractionApproveResponse,
    InteractionAttachmentsUpdate,
    InteractionRead,
)
from config import settings
from db.models import InteractionStatus
from modules.audit import log_action
from modules.comms_generator import get_comms

router = APIRouter(prefix="/interactions", tags=["interactions"])
comms = get_comms()


def _interaction_read(db: Session, interaction) -> InteractionRead:
    return InteractionRead(**comms.interaction_to_dict(db, interaction))


@router.get("/drafts", response_model=DraftListResponse)
def list_draft_interactions(
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
):
    drafts, total = comms.list_drafts(db, page=page, page_size=page_size)
    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    total_pages = max(1, (total + page_size - 1) // page_size)
    return DraftListResponse(
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        rows=[_interaction_read(db, draft) for draft in drafts],
    )


@router.get("", response_model=list[InteractionRead])
def list_interactions(db: Session = Depends(get_db)):
    rows = comms.list_interactions(db)
    return [_interaction_read(db, row) for row in rows]


@router.post("/email-draft", response_model=InteractionRead, status_code=201)
def create_email_draft(payload: EmailDraftRequest, db: Session = Depends(get_db)):
    try:
        draft = comms.generate_email_draft(
            db,
            contact_id=payload.contact_id,
            goal=payload.goal,
            product_name=payload.product_name,
            attachments=[a.model_dump() for a in payload.attachments],
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _interaction_read(db, draft)


@router.get("/bulk-email-settings", response_model=BulkEmailSettingsRead)
def get_bulk_email_settings():
    return BulkEmailSettingsRead(
        batch_size=settings.bulk_email_batch_size,
        message_delay_seconds=settings.bulk_email_message_delay_seconds,
        batch_pause_seconds=settings.bulk_email_batch_pause_seconds,
        max_per_request=settings.bulk_email_max_per_request,
        gmail_daily_limit_hint=300,
        recommendation=(
            "Current settings: 50 per batch, 3s between emails, 60s between batches. "
            "Keep daily cold outreach under 100–200 emails per Outlook mailbox."
        ),
    )


@router.post("/bulk-email-drafts", response_model=BulkEmailDraftResponse, status_code=201)
def create_bulk_email_drafts(payload: BulkEmailDraftRequest, db: Session = Depends(get_db)):
    result = comms.create_bulk_drafts_from_template(
        db,
        buyer_ids=payload.buyer_ids,
        template_id=payload.template_id,
        extra_attachments=[a.model_dump() for a in payload.attachments],
    )
    log_action(
        db,
        entity_type="interaction",
        entity_id=0,
        action="bulk_drafts_created",
        details={
            "template_id": payload.template_id,
            "created_count": result["created_count"],
            "skipped_count": result["skipped_count"],
        },
    )
    return BulkEmailDraftResponse(**result)


@router.post("/bulk-approve", response_model=BulkApproveResponse)
def bulk_approve_interactions(payload: BulkApproveRequest, db: Session = Depends(get_db)):
    if len(payload.interaction_ids) > settings.bulk_email_max_per_request:
        raise HTTPException(
            400,
            f"Maximum {settings.bulk_email_max_per_request} emails per batch. "
            f"Split into smaller batches — the dashboard does this automatically.",
        )
    result = comms.bulk_approve_drafts(
        db,
        payload.interaction_ids,
        approved_by=payload.approved_by,
        send=payload.send,
    )
    log_action(
        db,
        entity_type="interaction",
        entity_id=0,
        action="bulk_approved",
        actor=payload.approved_by,
        details={
            "send": payload.send,
            "sent_count": result["sent_count"],
            "failed_count": result["failed_count"],
        },
    )
    return BulkApproveResponse(**result)


@router.post("/{interaction_id}/approve", response_model=InteractionApproveResponse)
def approve_interaction(
    interaction_id: int,
    payload: InteractionApprove,
    db: Session = Depends(get_db),
):
    try:
        approved, send_result = comms.approve_draft(
            db,
            interaction_id,
            content=payload.content,
            approved_by=payload.approved_by,
            send=payload.send,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    log_action(
        db,
        entity_type="interaction",
        entity_id=approved.id,
        action="approved",
        actor=payload.approved_by,
    )

    sent = approved.status == InteractionStatus.sent
    send_status = send_result.get("status") if send_result else None
    send_message = send_result.get("message") if send_result else None

    if sent:
        log_action(
            db,
            entity_type="interaction",
            entity_id=approved.id,
            action="sent",
            actor=payload.approved_by,
            details=send_result,
        )
    elif send_result and payload.send:
        log_action(
            db,
            entity_type="interaction",
            entity_id=approved.id,
            action="send_failed",
            actor=payload.approved_by,
            details=send_result,
        )

    return InteractionApproveResponse(
        interaction=_interaction_read(db, approved),
        sent=sent,
        send_status=send_status,
        send_message=send_message,
    )


@router.patch("/{interaction_id}/attachments", response_model=InteractionRead)
def update_draft_attachments(
    interaction_id: int,
    payload: InteractionAttachmentsUpdate,
    db: Session = Depends(get_db),
):
    try:
        draft = comms.update_draft_attachments(
            db,
            interaction_id,
            [a.model_dump() for a in payload.attachments],
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _interaction_read(db, draft)


@router.post("/{interaction_id}/reject", response_model=InteractionRead)
def reject_interaction(interaction_id: int, db: Session = Depends(get_db)):
    try:
        rejected = comms.reject_draft(db, interaction_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    log_action(db, entity_type="interaction", entity_id=rejected.id, action="rejected")
    return _interaction_read(db, rejected)
