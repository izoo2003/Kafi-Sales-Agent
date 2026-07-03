from sqlalchemy.orm import Session

import re

from db.models import (
    Buyer,
    ConsentStatus,
    Contact,
    ExportHistory,
    Interaction,
    LeadScore,
    Quotation,
    ScheduledEvent,
)

_VALID_EMAIL_RE = re.compile(r"^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$", re.I)
_BLOCKED_EMAIL_PREFIXES = ("noreply@", "no-reply@", "donotreply@", "example@", "test@")
_INVALID_EMAIL_VALUES = {"not found", "n/a", "na", "none", "-"}


def is_valid_email(email: str | None) -> bool:
    if not email:
        return False
    value = email.strip()
    if not value or value.lower() in _INVALID_EMAIL_VALUES:
        return False
    if value.lower().startswith(_BLOCKED_EMAIL_PREFIXES):
        return False
    return bool(_VALID_EMAIL_RE.match(value))


def primary_contact_with_email(db: Session, buyer_id: int) -> Contact | None:
    for contact in list_contacts_for_buyer(db, buyer_id):
        if is_valid_email(contact.email):
            return contact
    return None


def list_buyers(db: Session) -> list[Buyer]:
    return db.query(Buyer).order_by(Buyer.created_at.desc()).all()


def get_buyer(db: Session, buyer_id: int) -> Buyer | None:
    return db.get(Buyer, buyer_id)


def create_buyer(db: Session, data: dict) -> Buyer:
    buyer = Buyer(**data)
    db.add(buyer)
    db.commit()
    db.refresh(buyer)
    return buyer


def list_contacts(db: Session) -> list[Contact]:
    return db.query(Contact).order_by(Contact.id.desc()).all()


def list_contacts_for_buyer(db: Session, buyer_id: int) -> list[Contact]:
    return (
        db.query(Contact)
        .filter(Contact.buyer_id == buyer_id)
        .order_by(Contact.id.asc())
        .all()
    )


def create_contact(db: Session, data: dict) -> Contact:
    consent = data.pop("consent_status", "unknown")
    data["consent_status"] = ConsentStatus(consent)
    contact = Contact(**data)
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


def update_buyer(db: Session, buyer_id: int, data: dict) -> Buyer | None:
    buyer = get_buyer(db, buyer_id)
    if not buyer:
        return None
    for key, value in data.items():
        if key in {"company_name", "website_url", "country", "industry", "linkedin_company_url", "source"}:
            setattr(buyer, key, value)
    db.commit()
    db.refresh(buyer)
    return buyer


def update_contact(db: Session, contact_id: int, data: dict) -> Contact | None:
    contact = db.get(Contact, contact_id)
    if not contact:
        return None
    for key, value in data.items():
        if key in {"full_name", "email", "phone", "designation"}:
            setattr(contact, key, value)
    db.commit()
    db.refresh(contact)
    return contact


def upsert_primary_contact(
    db: Session,
    buyer_id: int,
    *,
    contact_id: int | None = None,
    full_name: str | None = None,
    email: str | None = None,
    phone: str | None = None,
) -> Contact | None:
    if contact_id:
        contact = db.get(Contact, contact_id)
        if contact and contact.buyer_id == buyer_id:
            if full_name is not None:
                contact.full_name = full_name
            if email is not None:
                contact.email = email or None
            if phone is not None:
                contact.phone = phone or None
            db.commit()
            db.refresh(contact)
            return contact

    if not (full_name or email or phone):
        return None

    return create_contact(
        db,
        {
            "buyer_id": buyer_id,
            "full_name": full_name or "General contact",
            "email": email or None,
            "phone": phone or None,
            "data_source": "table_edit",
            "consent_status": "unknown",
        },
    )


def delete_buyer(db: Session, buyer_id: int) -> bool:
    buyer = get_buyer(db, buyer_id)
    if not buyer:
        return False

    contact_ids = [
        contact.id for contact in list_contacts_for_buyer(db, buyer_id)
    ]
    if contact_ids:
        db.query(Interaction).filter(Interaction.contact_id.in_(contact_ids)).delete(
            synchronize_session=False
        )
        db.query(ScheduledEvent).filter(ScheduledEvent.contact_id.in_(contact_ids)).delete(
            synchronize_session=False
        )
        db.query(Contact).filter(Contact.buyer_id == buyer_id).delete(synchronize_session=False)

    db.query(LeadScore).filter(LeadScore.buyer_id == buyer_id).delete(synchronize_session=False)
    db.query(Quotation).filter(Quotation.buyer_id == buyer_id).delete(synchronize_session=False)
    db.query(ExportHistory).filter(ExportHistory.buyer_id == buyer_id).delete(
        synchronize_session=False
    )
    db.delete(buyer)
    db.commit()
    return True
