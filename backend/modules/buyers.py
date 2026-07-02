from sqlalchemy.orm import Session

from db.models import Buyer, ConsentStatus, Contact


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
