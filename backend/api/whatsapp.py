"""WhatsApp Cloud API — template sync, bulk campaign drafts, and inbound webhook.

Temporarily disabled: routers are not mounted in main.py. Uncomment the whatsapp
import + include_router lines there (and the frontend nav) to turn this back on.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from api.schemas import (
    BulkWhatsAppOptInUpdate,
    InteractionRead,
    WhatsAppCampaignDraftRequest,
    WhatsAppCampaignDraftResponse,
    WhatsAppConfigRead,
    WhatsAppConversationListResponse,
    WhatsAppConversationRead,
    WhatsAppReplyRequest,
    WhatsAppReplyResponse,
    WhatsAppTemplateRead,
    WhatsAppTemplateSyncResponse,
)
from config import settings
from db.models import AppUser, InteractionStatus
from integrations.whatsapp_client import whatsapp_client
from modules.audit import log_action
from modules.comms_generator import get_comms

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])
comms = get_comms()


def _interaction_read(db: Session, interaction) -> InteractionRead:
    return InteractionRead(**comms.interaction_to_dict(db, interaction))


@router.get("/config", response_model=WhatsAppConfigRead)
def get_whatsapp_config():
    missing: list[str] = []
    if not settings.whatsapp_access_token:
        missing.append("WHATSAPP_ACCESS_TOKEN")
    if not settings.whatsapp_phone_number_id:
        missing.append("WHATSAPP_PHONE_NUMBER_ID")
    if not settings.whatsapp_business_account_id:
        missing.append("WHATSAPP_BUSINESS_ACCOUNT_ID")
    if not settings.whatsapp_webhook_verify_token:
        missing.append("WHATSAPP_WEBHOOK_VERIFY_TOKEN")
    return WhatsAppConfigRead(
        configured=whatsapp_client.is_configured,
        webhook_configured=whatsapp_client.webhook_configured,
        phone_number_id_set=bool(settings.whatsapp_phone_number_id),
        business_account_id_set=bool(settings.whatsapp_business_account_id),
        missing_env=missing,
    )


@router.get("/templates", response_model=list[WhatsAppTemplateRead])
def list_whatsapp_templates(
    approved_only: bool = False,
    db: Session = Depends(get_db),
):
    from modules import whatsapp_templates as templates_module

    rows = templates_module.list_templates(db, approved_only=approved_only)
    return [WhatsAppTemplateRead(**templates_module.template_to_dict(r)) for r in rows]


@router.post("/templates/sync", response_model=WhatsAppTemplateSyncResponse)
def sync_whatsapp_templates(
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    from modules import whatsapp_templates as templates_module

    result = templates_module.sync_templates_from_meta(db)
    log_action(
        db,
        entity_type="whatsapp_template",
        entity_id=0,
        action="synced",
        actor=user.username,
        details=result,
    )
    return WhatsAppTemplateSyncResponse(**result)


@router.post("/campaign-drafts", response_model=WhatsAppCampaignDraftResponse)
def create_whatsapp_campaign_drafts(
    payload: WhatsAppCampaignDraftRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    from modules import activity as activity_module

    try:
        result = comms.create_whatsapp_campaign_drafts(
            db,
            buyer_ids=payload.buyer_ids,
            template_id=payload.template_id,
            template_variables=payload.template_variables,
            require_opt_in=payload.require_opt_in,
            send=payload.send,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    log_action(
        db,
        entity_type="interaction",
        entity_id=0,
        action="whatsapp_bulk_sent" if payload.send else "whatsapp_bulk_drafts_created",
        actor=user.username,
        details={
            "template_id": payload.template_id,
            "created_count": result["created_count"],
            "skipped_count": result["skipped_count"],
            "sent_count": result.get("sent_count", 0),
            "failed_count": result.get("failed_count", 0),
            "send": payload.send,
        },
    )
    if payload.send:
        sent_count = int(result.get("sent_count") or 0)
        if sent_count > 0:
            activity_module.log_activity(
                db,
                user_id=user.id,
                activity_type="bulk_whatsapp_sent",
                title="Bulk WhatsApp messages sent",
                summary=(
                    f"Sent {sent_count} WhatsApp message{'s' if sent_count != 1 else ''} "
                    f"(template #{payload.template_id})"
                ),
                quantity=sent_count,
                entity_type="whatsapp_template",
                entity_id=payload.template_id,
                details={"mode": "template", "sent_count": sent_count},
            )
    return WhatsAppCampaignDraftResponse(**result)


@router.patch("/contacts/bulk-opt-in")
def bulk_update_whatsapp_opt_in(
    payload: BulkWhatsAppOptInUpdate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    from modules.compliance import bulk_update_whatsapp_opt_in as bulk_update

    updated = bulk_update(db, payload.contact_ids, payload.opt_in)
    log_action(
        db,
        entity_type="contact",
        entity_id=0,
        action="bulk_whatsapp_opt_in_update",
        actor=user.username,
        details={"count": updated, "opt_in": payload.opt_in},
    )
    return {"updated_count": updated}


@router.get("/conversations", response_model=WhatsAppConversationListResponse)
def list_whatsapp_conversations(
    page: int = 1,
    page_size: int = 20,
    db: Session = Depends(get_db),
):
    rows, total = comms.list_whatsapp_conversations(db, page=page, page_size=page_size)
    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    total_pages = max(1, (total + page_size - 1) // page_size)
    return WhatsAppConversationListResponse(
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        rows=[WhatsAppConversationRead(**row) for row in rows],
    )


@router.get("/conversations/{contact_id}/messages", response_model=list[InteractionRead])
def list_whatsapp_conversation_messages(contact_id: int, db: Session = Depends(get_db)):
    rows = comms.list_whatsapp_messages(db, contact_id=contact_id)
    return [_interaction_read(db, row) for row in rows]


@router.post("/conversations/{contact_id}/reply", response_model=WhatsAppReplyResponse)
def reply_to_whatsapp_conversation(
    contact_id: int,
    payload: WhatsAppReplyRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    try:
        draft = comms.create_manual_whatsapp_draft(
            db, contact_id=contact_id, content=payload.content
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    send_result = None
    if payload.send:
        try:
            draft, send_result = comms.approve_draft(
                db,
                draft.id,
                approved_by=user.username,
                send=True,
                template_name=payload.template_name,
                template_language=payload.template_language or "en_US",
                template_variables=payload.template_variables or None,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    log_action(
        db,
        entity_type="interaction",
        entity_id=draft.id,
        action="whatsapp_reply_sent" if draft.status == InteractionStatus.sent else "whatsapp_reply_drafted",
        actor=user.username,
        details={"contact_id": contact_id, "send": payload.send},
    )

    return WhatsAppReplyResponse(
        interaction=_interaction_read(db, draft),
        sent=draft.status == InteractionStatus.sent,
        send_status=(send_result or {}).get("status"),
        send_message=(send_result or {}).get("message"),
    )


webhooks_router = APIRouter(prefix="/webhooks/whatsapp", tags=["whatsapp-webhooks"])


@webhooks_router.get("")
async def verify_whatsapp_webhook(request: Request):
    """Meta's one-time handshake when you subscribe the webhook URL."""
    from fastapi.responses import PlainTextResponse

    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge") or ""

    if mode == "subscribe" and token and token == settings.whatsapp_webhook_verify_token:
        return PlainTextResponse(challenge)
    raise HTTPException(403, "Webhook verification failed")


@webhooks_router.post("")
async def receive_whatsapp_webhook(request: Request, db: Session = Depends(get_db)):
    body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256")
    if settings.whatsapp_app_secret and not whatsapp_client.verify_webhook_signature(
        payload=body, signature_header=signature
    ):
        raise HTTPException(403, "Invalid webhook signature")

    payload = await request.json()
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})

            for message in value.get("messages", []):
                if message.get("type") != "text":
                    continue
                wa_id = message.get("from")
                text = (message.get("text") or {}).get("body", "")
                provider_message_id = message.get("id")
                if wa_id:
                    comms.record_inbound_whatsapp_message(
                        db,
                        wa_id=wa_id,
                        message_text=text,
                        provider_message_id=provider_message_id,
                    )

            for status_update in value.get("statuses", []):
                message_id = status_update.get("id")
                status = status_update.get("status")
                if message_id and status:
                    comms.update_whatsapp_message_status(
                        db, provider_message_id=message_id, status=status
                    )

    return {"status": "ok"}
