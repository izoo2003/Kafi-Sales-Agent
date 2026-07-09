"""Email templates with merge-field personalization for bulk outreach."""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from db.models import Buyer, Contact, EmailTemplate

SUPPORTED_PLACEHOLDERS = [
    "company_name",
    "contact_name",
    "country",
    "industry",
    "designation",
    "website_url",
    "email",
]


def render_template_text(text: str, *, buyer: Buyer, contact: Contact) -> str:
    """Replace [placeholder] tokens with buyer/contact values (case-insensitive)."""
    values = {
        "company_name": buyer.company_name or "",
        "contact_name": contact.full_name or "Sir/Madam",
        "country": buyer.country or "your market",
        "industry": buyer.industry or "",
        "designation": contact.designation or "",
        "website_url": buyer.website_url or "",
        "email": contact.email or "",
    }
    rendered = text
    for key, value in values.items():
        rendered = re.sub(rf"\[{re.escape(key)}\]", value, rendered, flags=re.IGNORECASE)
    return rendered


def list_templates(db: Session) -> list[EmailTemplate]:
    return db.query(EmailTemplate).order_by(EmailTemplate.updated_at.desc()).all()


def get_template(db: Session, template_id: int) -> EmailTemplate | None:
    return db.get(EmailTemplate, template_id)


from modules.email_attachments import resolve_attachment_list


def create_template(db: Session, data: dict) -> EmailTemplate:
    record = EmailTemplate(
        name=data["name"],
        subject=data["subject"],
        body=data["body"],
        attachments=resolve_attachment_list(data.get("attachments") or []),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def update_template(db: Session, template_id: int, data: dict) -> EmailTemplate | None:
    record = get_template(db, template_id)
    if not record:
        return None
    for key in ("name", "subject", "body", "attachments"):
        if key in data and data[key] is not None:
            value = data[key]
            if key == "attachments":
                value = resolve_attachment_list(value, record.attachments)
            setattr(record, key, value)
    db.commit()
    db.refresh(record)
    return record


def delete_template(db: Session, template_id: int) -> bool:
    record = get_template(db, template_id)
    if not record:
        return False
    db.delete(record)
    db.commit()
    return True


def preview_template(
    db: Session,
    template_id: int,
    buyer_id: int,
) -> dict[str, str] | None:
    template = get_template(db, template_id)
    buyer = db.get(Buyer, buyer_id)
    if not template or not buyer:
        return None

    from modules.buyers import primary_contact_with_email

    contact = primary_contact_with_email(db, buyer_id)
    if not contact:
        contact = Contact(
            buyer_id=buyer_id,
            full_name="Sample Contact",
            email="contact@example.com",
        )

    return {
        "subject": render_template_text(template.subject, buyer=buyer, contact=contact),
        "body": render_template_text(template.body, buyer=buyer, contact=contact),
        "company_name": buyer.company_name,
        "contact_email": contact.email or "",
    }
