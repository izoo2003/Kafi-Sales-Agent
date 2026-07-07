from sqlalchemy.orm import Session

import re

from db.models import (
    Buyer,
    BuyerResearchProfile,
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


def normalize_buyer_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def buyer_website_domain(url: str | None) -> str | None:
    if not url:
        return None
    try:
        from urllib.parse import urlparse

        parsed = urlparse(url if "://" in url else f"https://{url}")
        host = parsed.netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except ValueError:
        return None


def buyer_data_score(db: Session, buyer: Buyer) -> int:
    """Higher score = richer lead record; used to pick which duplicate to keep."""
    from db.models import LeadScoreLabel

    contact = primary_contact_with_email(db, buyer.id)
    if not contact:
        contacts = list_contacts_for_buyer(db, buyer.id)
        contact = contacts[0] if contacts else None

    latest_score = (
        db.query(LeadScore)
        .filter(LeadScore.buyer_id == buyer.id)
        .order_by(LeadScore.scored_at.desc())
        .first()
    )

    points = 0
    if buyer.website_url:
        points += 10
    if buyer.country:
        points += 2
    if buyer.industry:
        points += 2
    if buyer.linkedin_company_url:
        points += 3
    if buyer.facebook_company_url:
        points += 2
    if buyer.instagram_company_url:
        points += 2
    if contact and is_valid_email(contact.email):
        points += 15
    if contact and contact.phone:
        points += 5
    if latest_score:
        points += 5
        if latest_score.score == LeadScoreLabel.HOT:
            points += 10
        elif latest_score.score == LeadScoreLabel.WARM:
            points += 5
    return points


def is_sparse_buyer(db: Session, buyer: Buyer) -> bool:
    """True when a lead has almost no scraped details (typical failed CSV import)."""
    return buyer_data_score(db, buyer) < 8


def find_buyer_by_name_or_domain(
    db: Session,
    *,
    company_name: str,
    website_url: str | None = None,
) -> Buyer | None:
    name_key = normalize_buyer_key(company_name)
    domain = buyer_website_domain(website_url)
    match_by_name: Buyer | None = None
    match_by_domain: Buyer | None = None

    for buyer in list_buyers(db):
        if normalize_buyer_key(buyer.company_name) == name_key:
            match_by_name = buyer
        if domain and buyer_website_domain(buyer.website_url) == domain:
            match_by_domain = buyer

    return match_by_name or match_by_domain


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


def get_contact(db: Session, contact_id: int) -> Contact | None:
    return db.get(Contact, contact_id)


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
        if key in {
            "company_name",
            "website_url",
            "country",
            "industry",
            "linkedin_company_url",
            "facebook_company_url",
            "instagram_company_url",
            "source",
        }:
            setattr(buyer, key, value)
    db.commit()
    db.refresh(buyer)
    return buyer


def update_contact(db: Session, contact_id: int, data: dict) -> Contact | None:
    contact = db.get(Contact, contact_id)
    if not contact:
        return None
    if "consent_status" in data and data["consent_status"] is not None:
        contact.consent_status = ConsentStatus(data["consent_status"])
        data = {k: v for k, v in data.items() if k != "consent_status"}
    for key, value in data.items():
        if key in {
            "full_name",
            "email",
            "phone",
            "designation",
            "preferred_language",
            "date_of_birth",
            "nationality",
        }:
            setattr(contact, key, value)
    db.commit()
    db.refresh(contact)
    return contact


def delete_contact(db: Session, contact_id: int) -> bool:
    contact = db.get(Contact, contact_id)
    if not contact:
        return False
    db.query(Interaction).filter(Interaction.contact_id == contact_id).delete(
        synchronize_session=False
    )
    db.query(ScheduledEvent).filter(ScheduledEvent.contact_id == contact_id).delete(
        synchronize_session=False
    )
    db.delete(contact)
    db.commit()
    return True


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
    db.query(BuyerResearchProfile).filter(BuyerResearchProfile.buyer_id == buyer_id).delete(
        synchronize_session=False
    )
    db.delete(buyer)
    db.commit()
    return True
