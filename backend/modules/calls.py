"""Outbound call orchestration — human-initiated, logged as interactions."""

from __future__ import annotations

import re
from pathlib import Path

from sqlalchemy.orm import Session

from db.models import Buyer, Channel, Contact, Direction, HandledBy, Interaction, InteractionStatus
from integrations.voice_client import mask_phone, normalize_e164, voice_client
from modules import buyers as buyers_module
from modules.audit import log_action
from modules.comms_generator import get_comms
from modules.countries import resolve_country_name

_CALL_SID_RE = re.compile(r"(?:Call SID:|\(SID)\s*(\S+?)(?:\)|\.|$)")
_LEAD_PHONE_RE = re.compile(r"(?:Outbound call(?:\s+initiated)?\s+to|to)\s+(\+\d+)")
_DURATION_RE = re.compile(r"duration\s+(\d+)m\s+(\d+)s|duration\s+(\d+)s")
_NOTES_MARKER = "\n\nNOTES:"
_OUTCOME_MARKER = "\n\nOUTCOME:"
_VALID_CALL_OUTCOMES = frozenset({"interested", "not_interested", "not_received_call"})


def _split_metadata(content: str | None) -> tuple[str, str | None, str | None]:
    base = (content or "").strip()
    notes: str | None = None
    outcome: str | None = None

    if _NOTES_MARKER in base:
        base, rest = base.split(_NOTES_MARKER, 1)
        if _OUTCOME_MARKER in rest:
            notes_part, outcome_part = rest.split(_OUTCOME_MARKER, 1)
            notes = notes_part.strip() or None
            outcome = outcome_part.strip() or None
        else:
            notes = rest.strip() or None
    elif _OUTCOME_MARKER in base:
        base, outcome_part = base.split(_OUTCOME_MARKER, 1)
        outcome = outcome_part.strip() or None

    return base.strip(), notes, outcome


def _build_content(base: str, notes: str | None, outcome: str | None) -> str:
    content = base.strip()
    if notes:
        content = f"{content}{_NOTES_MARKER} {notes.strip()}"
    if outcome:
        content = f"{content}{_OUTCOME_MARKER} {outcome.strip()}"
    return content


def _normalize_outcome(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip().lower()
    if not trimmed:
        return None
    if trimmed not in _VALID_CALL_OUTCOMES:
        allowed = ", ".join(sorted(_VALID_CALL_OUTCOMES))
        raise ValueError(f"Invalid call outcome. Choose one of: {allowed}")
    return trimmed


def parse_call_fields(content: str | None) -> dict:
    if not content:
        return {}

    base, notes, outcome = _split_metadata(content)
    fields: dict = {}

    if match := _CALL_SID_RE.search(base):
        fields["call_sid"] = match.group(1).rstrip(".")

    if match := _LEAD_PHONE_RE.search(base):
        fields["lead_phone"] = match.group(1)

    if " — " in base:
        tail = base.split(" — ", 1)[1]
        status_part = tail.split(",")[0].split("(")[0].strip().rstrip(".")
        if status_part and status_part not in {"Call SID:"}:
            fields["call_status"] = status_part

    if match := _DURATION_RE.search(base):
        if match.group(1) and match.group(2):
            fields["call_duration_seconds"] = int(match.group(1)) * 60 + int(match.group(2))
        elif match.group(3):
            fields["call_duration_seconds"] = int(match.group(3))

    if notes:
        fields["notes"] = notes
    if outcome:
        fields["call_outcome"] = outcome

    return fields


def _content_without_notes(content: str | None) -> str:
    base, _, _ = _split_metadata(content)
    return base


def buyer_ids_with_latest_call_outcome(db: Session, outcome: str) -> set[int]:
    """Buyers whose most recent phone call has the given outcome label."""
    wanted = outcome.strip().lower()
    phone_rows = (
        db.query(Interaction, Contact.buyer_id)
        .join(Contact, Interaction.contact_id == Contact.id)
        .filter(Interaction.channel == Channel.phone)
        .order_by(Interaction.created_at.desc())
        .all()
    )
    latest_by_buyer: dict[int, str | None] = {}
    for interaction, buyer_id in phone_rows:
        bid = int(buyer_id)
        if bid in latest_by_buyer:
            continue
        latest_by_buyer[bid] = parse_call_fields(interaction.content).get("call_outcome")
    return {
        bid
        for bid, value in latest_by_buyer.items()
        if value and str(value).lower() == wanted
    }


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
    from modules.call_media import get_call_media, public_call_media

    contact = db.get(Contact, interaction.contact_id)
    buyer = db.get(Buyer, contact.buyer_id) if contact else None
    parsed = parse_call_fields(interaction.content)
    media = public_call_media(get_call_media(interaction), interaction_id=interaction.id)
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
        **media,
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


def _contact_phones_normalized(contact: Contact) -> set[str]:
    phones: set[str] = set()
    for raw in (
        contact.phone,
        contact.primary_phone,
        contact.secondary_phone,
        contact.secondary_mobile,
    ):
        normalized = normalize_e164(raw or "")
        if normalized:
            phones.add(normalized)
    return phones


def _find_contact_by_phone(db: Session, phone: str) -> Contact | None:
    target = normalize_e164(phone)
    if not target:
        return None
    for contact in buyers_module.list_contacts(db):
        if target in _contact_phones_normalized(contact):
            return contact
    return None


def _prepare_call_interaction(
    db: Session,
    *,
    buyer: Buyer,
    contact: Contact,
    lead_phone: str,
    subject: str,
    content: str,
) -> dict:
    interaction = Interaction(
        contact_id=contact.id,
        channel=Channel.phone,
        direction=Direction.outbound,
        subject=subject,
        content=content,
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
            "buyer_id": buyer.id,
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

    return _prepare_call_interaction(
        db,
        buyer=buyer,
        contact=contact,
        lead_phone=lead_phone,
        subject=f"Call to {buyer.company_name}",
        content=f"Outbound call to {lead_phone} ({contact.full_name}). Connecting from dashboard…",
    )


def initiate_manual_call(
    db: Session,
    *,
    phone: str,
    contact_name: str | None = None,
    country: str | None = None,
) -> dict:
    """Prepare a browser call to any E.164 number — links to an existing lead when possible."""
    if not voice_client.browser_ready:
        cfg = call_config()
        raise ValueError(cfg.get("setup_message") or "Twilio browser calling is not configured")

    lead_phone = normalize_e164(phone)
    if not lead_phone:
        raise ValueError(
            "Phone number is not valid. Use international format, e.g. +971501234567"
        )

    resolved_country = resolve_country_name(country) if country else None
    contact = _find_contact_by_phone(db, lead_phone)
    if contact:
        buyer = buyers_module.get_buyer(db, contact.buyer_id)
        if not buyer:
            raise ValueError("Contact lead not found")
    else:
        display_name = (contact_name or "").strip() or lead_phone
        buyer = buyers_module.create_buyer(
            db,
            {
                "company_name": display_name,
                "country": resolved_country,
                "source": "manual_dial",
            },
            commit=False,
        )
        contact = buyers_module.create_contact(
            db,
            {
                "buyer_id": buyer.id,
                "full_name": (contact_name or "").strip() or "Manual dial",
                "phone": lead_phone,
                "data_source": "manual_dial",
                "consent_status": "unknown",
            },
            commit=False,
        )
        db.commit()
        db.refresh(buyer)
        db.refresh(contact)

    return _prepare_call_interaction(
        db,
        buyer=buyer,
        contact=contact,
        lead_phone=lead_phone,
        subject=f"Manual call to {lead_phone}",
        content=f"Manual outbound call to {lead_phone} ({contact.full_name}). Connecting from dashboard…",
    )


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
    outcome = parse_call_fields(interaction.content).get("call_outcome")
    body = _content_without_notes(interaction.content)

    duration_text = ""
    if call_duration and call_duration.isdigit():
        seconds = int(call_duration)
        mins, secs = divmod(seconds, 60)
        duration_text = f", duration {mins}m {secs}s" if mins else f", duration {secs}s"

    sid_text = f" (Call SID: {call_sid})" if call_sid else ""
    if "Call SID:" in body:
        prefix = body.split("Call SID:")[0].strip().rstrip("(").strip()
    elif " — " in body:
        prefix = body.split(" — ", 1)[0].strip()
    else:
        prefix = body.strip()

    interaction.content = f"{prefix} — {call_status}{duration_text}{sid_text}.".strip()
    interaction.content = _build_content(interaction.content, notes, outcome)
    db.commit()


def save_call_recording(
    db: Session,
    *,
    interaction_id: int,
    recording_sid: str,
    recording_url: str,
    recording_status: str,
    recording_duration: str | None = None,
) -> dict | None:
    from modules.call_media import save_recording_from_webhook

    return save_recording_from_webhook(
        db,
        interaction_id=interaction_id,
        recording_sid=recording_sid,
        recording_url=recording_url,
        recording_status=recording_status,
        recording_duration=recording_duration,
    )


def get_call_recording_file(db: Session, *, interaction_id: int) -> tuple[Path, str, str]:
    from modules.call_media import (
        attach_local_recording,
        download_twilio_recording,
        get_call_media,
        resolve_local_recording,
    )

    interaction = db.get(Interaction, interaction_id)
    if not interaction or interaction.channel != Channel.phone:
        raise ValueError("Call not found")
    media = get_call_media(interaction)
    if not media:
        raise ValueError("No recording for this call")

    path = resolve_local_recording(media)
    if not path and media.get("recording_url") and media.get("recording_sid"):
        path, content_type = download_twilio_recording(
            str(media["recording_url"]),
            str(media["recording_sid"]),
        )
        attach_local_recording(
            db,
            interaction_id=interaction_id,
            local_path=f"call_recordings/{path.name}",
            content_type=content_type,
        )
        media = get_call_media(interaction) or media

    if not path or not path.is_file():
        raise ValueError("Recording file is not available yet")

    content_type = str(media.get("content_type") or "audio/mpeg")
    filename = path.name
    return path, content_type, filename


def transcribe_call(db: Session, *, interaction_id: int) -> dict:
    from modules.call_media import transcribe_call_recording

    transcribe_call_recording(db, interaction_id=interaction_id)
    interaction = db.get(Interaction, interaction_id)
    if not interaction:
        raise ValueError("Call not found")
    return call_interaction_to_dict(db, interaction)


def update_call_followup(
    db: Session,
    *,
    interaction_id: int,
    notes: str | None = None,
    call_outcome: str | None = None,
) -> dict:
    interaction = db.get(Interaction, interaction_id)
    if not interaction or interaction.channel != Channel.phone:
        raise ValueError("Call not found")

    base, existing_notes, existing_outcome = _split_metadata(interaction.content)
    new_notes = existing_notes if notes is None else notes.strip()
    new_outcome = existing_outcome
    if call_outcome is not None:
        trimmed = call_outcome.strip()
        new_outcome = None if not trimmed else _normalize_outcome(trimmed)

    interaction.content = _build_content(
        base,
        new_notes or None,
        new_outcome,
    )

    from modules.interested_follow_ups import sync_buyer_interested_status

    sync_buyer_interested_status(
        db,
        buyer_id=interaction.contact.buyer_id,
        new_outcome=new_outcome,
        previous_outcome=existing_outcome,
    )

    db.commit()
    db.refresh(interaction)
    return call_interaction_to_dict(db, interaction)


def update_call_notes(db: Session, *, interaction_id: int, notes: str) -> dict:
    return update_call_followup(db, interaction_id=interaction_id, notes=notes)
