from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.deps import get_db
from api.schemas import (
    EmailDraftRequest,
    InteractionApprove,
    InteractionApproveResponse,
    InteractionRead,
)
from db.models import InteractionStatus
from modules.audit import log_action
from modules.comms_generator import get_comms

router = APIRouter(prefix="/interactions", tags=["interactions"])
comms = get_comms()


@router.get("/drafts", response_model=list[InteractionRead])
def list_draft_interactions(db: Session = Depends(get_db)):
    return comms.list_drafts(db)


@router.get("", response_model=list[InteractionRead])
def list_interactions(db: Session = Depends(get_db)):
    return comms.list_interactions(db)


@router.post("/email-draft", response_model=InteractionRead, status_code=201)
def create_email_draft(payload: EmailDraftRequest, db: Session = Depends(get_db)):
    try:
        return comms.generate_email_draft(
            db,
            contact_id=payload.contact_id,
            goal=payload.goal,
            product_name=payload.product_name,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


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
        interaction=InteractionRead.model_validate(approved),
        sent=sent,
        send_status=send_status,
        send_message=send_message,
    )


@router.post("/{interaction_id}/reject", response_model=InteractionRead)
def reject_interaction(interaction_id: int, db: Session = Depends(get_db)):
    try:
        rejected = comms.reject_draft(db, interaction_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    log_action(db, entity_type="interaction", entity_id=rejected.id, action="rejected")
    return rejected
