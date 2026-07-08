"""Outbound call orchestration — human-initiated, logged as interactions."""

from __future__ import annotations

from sqlalchemy.orm import Session

from db.models import Channel, Contact, Direction, HandledBy, Interaction, InteractionStatus
from integrations.voice_client import normalize_e164, voice_client
from modules import buyers as buyers_module
from modules.comms_generator import get_comms


def call_config() -> dict:
    from config import settings

    return {
        "configured": voice_client.is_configured,
        "webhooks_ready": voice_client.webhooks_ready,
        "has_default_agent_phone": bool(normalize_e164(settings.twilio_agent_phone)),
    }


def _primary_contact_for_call(db: Session, buyer_id: int) -> Contact | None:
    contact = buyers_module.primary_contact_with_email(db, buyer_id)
    if contact and contact.phone and contact.phone.strip():
        return contact
    for row in buyers_module.list_contacts_for_buyer(db, buyer_id):
        if row.phone and row.phone.strip():
            return row
    return None


def initiate_lead_call(
    db: Session,
    *,
    buyer_id: int,
    agent_phone: str | None = None,
    contact_id: int | None = None,
) -> dict:
    buyer = buyers_module.get_buyer(db, buyer_id)
    if not buyer:
        raise ValueError("Lead not found")

    if not voice_client.is_configured:
        raise ValueError(
            "Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, "
            "and TWILIO_PHONE_NUMBER in backend/.env"
        )
    if not voice_client.webhooks_ready:
        raise ValueError(
            "TWILIO_WEBHOOK_BASE_URL is required — use your public API URL or ngrok for local dev."
        )

    contact: Contact | None = None
    if contact_id:
        contact = buyers_module.get_contact(db, contact_id)
        if not contact or contact.buyer_id != buyer_id:
            raise ValueError("Contact not found for this lead")
    else:
        contact = _primary_contact_for_call(db, buyer_id)

    if not contact:
        raise ValueError("No contact with a phone number on this lead")
    if not contact.phone or not contact.phone.strip():
        raise ValueError("Contact has no phone number")

    lead_phone = normalize_e164(contact.phone)
    if not lead_phone:
        raise ValueError(
            f"Phone '{contact.phone}' is not valid E.164. Use international format: +971501234567"
        )

    from config import settings

    resolved_agent = normalize_e164(agent_phone or settings.twilio_agent_phone or "")
    if not resolved_agent:
        raise ValueError(
            "Your phone number is required. Pass agent_phone or set TWILIO_AGENT_PHONE in .env"
        )

    interaction = Interaction(
        contact_id=contact.id,
        channel=Channel.phone,
        direction=Direction.outbound,
        subject=f"Call to {buyer.company_name}",
        content=(
            f"Outbound call initiated to {lead_phone} "
            f"({contact.full_name}). Waiting for agent to answer…"
        ),
        handled_by=HandledBy.human,
        status=InteractionStatus.sent,
        approved_by="dashboard",
    )
    db.add(interaction)
    db.commit()
    db.refresh(interaction)

    result = voice_client.initiate_bridge_call(
        agent_phone=resolved_agent,
        lead_phone=lead_phone,
        interaction_id=interaction.id,
    )
    if result.get("status") == "error":
        interaction.content = f"Call failed: {result.get('message', 'unknown error')}"
        interaction.status = InteractionStatus.rejected
        db.commit()
        raise ValueError(result.get("message", "Twilio call failed"))

    interaction.content = (
        f"Outbound call to {lead_phone} ({contact.full_name}). "
        f"Call SID: {result.get('call_sid')}. Status: {result.get('call_status')}."
    )
    db.commit()
    db.refresh(interaction)

    payload = get_comms().interaction_to_dict(db, interaction)
    payload.update(
        {
            "call_sid": result.get("call_sid"),
            "call_status": result.get("call_status"),
            "agent_phone": result.get("agent_phone"),
            "lead_phone": result.get("lead_phone"),
            "message": result.get("message"),
        }
    )
    return payload


def update_call_status(
    db: Session,
    *,
    interaction_id: int,
    call_status: str,
    call_duration: str | None = None,
    call_sid: str | None = None,
) -> None:
    interaction = db.get(Interaction, interaction_id)
    if not interaction:
        return

    duration_text = ""
    if call_duration and call_duration.isdigit():
        seconds = int(call_duration)
        mins, secs = divmod(seconds, 60)
        duration_text = f", duration {mins}m {secs}s" if mins else f", duration {secs}s"

    sid_text = f" (SID {call_sid})" if call_sid else ""
    interaction.content = (
        f"{interaction.content.split('Call SID:')[0].strip()} — "
        f"{call_status}{duration_text}{sid_text}."
    ).strip()
    db.commit()
