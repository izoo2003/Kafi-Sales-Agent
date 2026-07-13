"""Weekly follow-up reminders for clients on the Interested clients list."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from db.models import Buyer, Channel, Contact, Interaction
from modules.calls import buyer_ids_with_latest_call_outcome, parse_call_fields

FOLLOW_UP_INTERVAL = timedelta(days=7)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _placement_date_for_buyer(db: Session, buyer_id: int) -> datetime | None:
    """Latest phone call interaction where outcome was set to interested."""
    rows = (
        db.query(Interaction, Contact.buyer_id)
        .join(Contact, Interaction.contact_id == Contact.id)
        .filter(Contact.buyer_id == buyer_id, Interaction.channel == Channel.phone)
        .order_by(Interaction.created_at.desc())
        .all()
    )
    for interaction, _ in rows:
        outcome = parse_call_fields(interaction.content).get("call_outcome")
        if outcome and str(outcome).lower() == "interested":
            return interaction.created_at
    return None


def _primary_contact_name(db: Session, buyer_id: int) -> str | None:
    contact = (
        db.query(Contact)
        .filter(Contact.buyer_id == buyer_id)
        .order_by(Contact.id.asc())
        .first()
    )
    return contact.full_name if contact else None


def sync_buyer_interested_status(
    db: Session,
    *,
    buyer_id: int,
    new_outcome: str | None,
    previous_outcome: str | None = None,
) -> None:
    buyer = db.get(Buyer, buyer_id)
    if not buyer:
        return

    prev = (previous_outcome or "").strip().lower() or None
    new = (new_outcome or "").strip().lower() or None

    if new == "interested":
        buyer.interested_at = _utcnow()
        buyer.interested_follow_up_ack_at = None
    elif prev == "interested" and new != "interested":
        buyer.interested_at = None
        buyer.interested_follow_up_ack_at = None


def _ensure_interested_at(db: Session, buyer: Buyer) -> datetime:
    if buyer.interested_at:
        return buyer.interested_at
    placement = _placement_date_for_buyer(db, buyer.id)
    buyer.interested_at = placement or _utcnow()
    db.commit()
    db.refresh(buyer)
    return buyer.interested_at


def list_due_follow_ups(db: Session) -> list[dict]:
    interested_ids = buyer_ids_with_latest_call_outcome(db, "interested")
    if not interested_ids:
        return []

    now = _utcnow()
    due: list[dict] = []

    buyers = db.query(Buyer).filter(Buyer.id.in_(interested_ids)).all()
    for buyer in buyers:
        placement = _ensure_interested_at(db, buyer)
        anchor = buyer.interested_follow_up_ack_at or placement
        due_at = anchor + FOLLOW_UP_INTERVAL
        if now < due_at:
            continue

        days_since = max(0, (now - placement).days)
        week_index = max(1, days_since // 7)
        contact_name = _primary_contact_name(db, buyer.id)

        due.append(
            {
                "id": f"{buyer.id}-w{week_index}",
                "buyer_id": buyer.id,
                "company_name": buyer.company_name,
                "contact_name": contact_name,
                "interested_at": placement.isoformat(),
                "weeks_since_placement": week_index,
                "due_at": due_at.isoformat(),
            }
        )

    due.sort(key=lambda item: item["due_at"])
    return due


def acknowledge_follow_up(db: Session, *, buyer_id: int) -> dict:
    buyer = db.get(Buyer, buyer_id)
    if not buyer:
        raise ValueError("Lead not found")
    if buyer_id not in buyer_ids_with_latest_call_outcome(db, "interested"):
        raise ValueError("Client is not on the Interested clients list")
    if not buyer.interested_at:
        _ensure_interested_at(db, buyer)

    buyer.interested_follow_up_ack_at = _utcnow()
    db.commit()
    db.refresh(buyer)
    return {
        "buyer_id": buyer.id,
        "interested_follow_up_ack_at": buyer.interested_follow_up_ack_at.isoformat(),
    }
