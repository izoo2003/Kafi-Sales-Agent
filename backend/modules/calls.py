"""Outbound call orchestration — human-initiated, logged as interactions."""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from db.models import Buyer, Channel, Contact, Direction, HandledBy, Interaction, InteractionStatus
from integrations.voice_client import mask_phone, normalize_e164, voice_client
from modules import buyers as buyers_module
from modules.audit import log_action
from modules.comms_generator import get_comms

_CALL_SID_RE = re.compile(r"Call SID:\s*(\S+)")
_LEAD_PHONE_RE = re.compile(r"(?:Outbound call(?:\s+initiated)?\s+to|to)\s+(\+\d+)")
_DURATION_RE = re.compile(r"duration\s+(\d+)m\s+(\d+)s|duration\s+(\d+)s")
_NOTES_MARKER = "\n\nNOTES:"


def parse_call_fields(content: str | None) -> dict:
    if not content:
        return {}

    fields: dict = {}
    if match := _CALL_SID_RE.search(content):
        fields["call_sid"] = match.group(1).rstrip(".")

    if match := _LEAD_PHONE_RE.search(content):
        fields["lead_phone"] = match.group(1)

    if " — " in content:
        tail = content.split(" — ", 1)[1].split(_NOTES_MARKER, 1)[0]
        status_part = tail.split(",")[0].split("(")[0].strip().rstrip(".")
        if status_part and status_part not in {"Call SID:"}:
            fields["call_status"] = status_part

    if match := _DURATION_RE.search(content):
        if match.group(1) and match.group(2):
            fields["call_duration_seconds"] = int(match.group(1)) * 60 + int(match.group(2))
        elif match.group(3):
            fields["call_duration_seconds"] = int(match.group(3))

    if _NOTES_MARKER in content:
        fields["notes"] = content.split(_NOTES_MARKER, 1)[1].strip()

    return fields


def _content_without_notes(content: str | None) -> str:
    if not content:
        return ""
    return content.split(_NOTES_MARKER, 1)[0].strip()


def call_config() -> dict:
    from config import settings

    hints = voice_client.setup_hints()
    setup_message: str | None = None
    if not voice_client.is_configured:
        setup_message = (
            "Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER to backend/.env"
        )
    elif not voice_client.webhooks_ready:
        setup_message = (
            "Set TWILIO_WEBHOOK_BASE_URL to your public API URL "
            "(run: ngrok http 8000 for local dev)"
        )
    elif not voice_client.browser_ready:
        setup_message = (
            "Create a Twilio API Key + TwiML App, then set TWILIO_API_KEY_SID, "
            "TWILIO_API_KEY_SECRET, and TWILIO_TWIML_APP_SID in backend/.env"
        )

    return {
        "configured": voice_client.is_configured,
        "webhooks_ready": voice_client.webhooks_ready,
        "browser_ready": voice_client.browser_ready,
        "caller_id_masked": mask_phone(settings.twilio_phone_number),
        "setup_message": setup_message,
        "missing_env": hints["missing"],
    }


def voice_access_token() -> dict:
    if not voice_client.browser_ready:
        raise ValueError(call_config().get("setup_message") or "Twilio browser calling not configured")
    return {
        "token": voice_client.create_access_token(),
        "identity": "sales-agent",
    }


def call_interaction_to_dict(db: Session, interaction: Interaction) -> dict:
    contact = db.get(Contact, interaction.contact_id)
    buyer = db.get(Buyer, contact.buyer_id) if contact else None
    parsed = parse_call_fields(interaction.content)
    return {
        "id": interaction.id,
        "contact_id": interaction.contact_id,
        "buyer_id": buyer.id if buyer else None,
        "company_name": buyer.company_name if buyer else None,
        "contact_name": contact.full_name if contact else None,
        "contact_phone": contact.phone if contact else None,
        "channel": interaction.channel.value,
        "direction": interaction.direction.value,
        "subject": interaction.subject,
        "content": interaction.content,
        "status": interaction.status.value,
        "created_at": interaction.created_at,
        **parsed,
    }


def list_call_history(db: Session, *, buyer_id: int | None = None, limit: int = 50) -> list[dict]:
    query = (
        db.query(Interaction)
        .join(Contact, Interaction.contact_id == Contact.id)
        .filter(Interaction.channel == Channel.phone)
    )
    if buyer_id is not None:
        query = query.filter(Contact.buyer_id == buyer_id)
    rows = query.order_by(Interaction.created_at.desc()).limit(limit).all()
    return [call_interaction_to_dict(db, row) for row in rows]


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
    contact_id: int | None = None,
) -> dict:
    """Prepare a browser call — creates interaction; frontend dials via Twilio Voice SDK."""
    buyer = buyers_module.get_buyer(db, buyer_id)
    if not buyer:
        raise ValueError("Lead not found")

    if not voice_client.browser_ready:
        cfg = call_config()
        raise ValueError(cfg.get("setup_message") or "Twilio browser calling is not configured")

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

    interaction = Interaction(
        contact_id=contact.id,
        channel=Channel.phone,
        direction=Direction.outbound,
        subject=f"Call to {buyer.company_name}",
        content=f"Outbound call to {lead_phone} ({contact.full_name}). Connecting from dashboard…",
        handled_by=HandledBy.human,
        status=InteractionStatus.sent,
        approved_by="dashboard",
    )
    db.add(interaction)
    db.commit()
    db.refresh(interaction)

    log_action(
        db,
        entity_type="interaction",
        entity_id=interaction.id,
        action="call_prepared",
        actor="dashboard",
        details={
            "buyer_id": buyer_id,
            "contact_id": contact.id,
            "lead_phone": lead_phone,
        },
    )

    payload = get_comms().interaction_to_dict(db, interaction)
    payload.update(
        {
            "lead_phone": lead_phone,
            "message": f"Calling {contact.full_name} at {lead_phone}…",
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

    notes = parse_call_fields(interaction.content).get("notes")
    body = _content_without_notes(interaction.content)

    duration_text = ""
    if call_duration and call_duration.isdigit():
        seconds = int(call_duration)
        mins, secs = divmod(seconds, 60)
        duration_text = f", duration {mins}m {secs}s" if mins else f", duration {secs}s"

    sid_text = f" (SID {call_sid})" if call_sid else ""
    if "Call SID:" in body:
        prefix = body.split("Call SID:")[0].strip()
    elif " — " in body:
        prefix = body.split(" — ", 1)[0].strip()
    else:
        prefix = body.strip()

    interaction.content = f"{prefix} — {call_status}{duration_text}{sid_text}.".strip()
    if notes:
        interaction.content = f"{interaction.content}{_NOTES_MARKER} {notes}"
    db.commit()


def update_call_notes(db: Session, *, interaction_id: int, notes: str) -> dict:
    interaction = db.get(Interaction, interaction_id)
    if not interaction or interaction.channel != Channel.phone:
        raise ValueError("Call not found")

    base = _content_without_notes(interaction.content)
    trimmed = notes.strip()
    interaction.content = f"{base}{_NOTES_MARKER} {trimmed}" if trimmed else base
    db.commit()
    db.refresh(interaction)
    return call_interaction_to_dict(db, interaction)
