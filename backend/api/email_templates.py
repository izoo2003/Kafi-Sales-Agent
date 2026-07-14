from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from api.schemas import (
    EmailTemplateCreate,
    EmailTemplatePreviewRead,
    EmailTemplateRead,
    EmailTemplateUpdate,
    EmailTextPreviewRequest,
)
from db.models import AppUser
from modules import email_templates as templates_module
from modules.audit import log_action

router = APIRouter(prefix="/email-templates", tags=["email-templates"])


def _template_read(record) -> EmailTemplateRead:
    from modules.email_attachments import public_attachments

    return EmailTemplateRead(
        id=record.id,
        name=record.name,
        subject=record.subject,
        body=record.body,
        attachments=public_attachments(getattr(record, "attachments", None)),
        created_at=record.created_at,
        updated_at=record.updated_at,
    )


@router.get("", response_model=list[EmailTemplateRead])
def list_email_templates(db: Session = Depends(get_db)):
    return [_template_read(t) for t in templates_module.list_templates(db)]


@router.post("", response_model=EmailTemplateRead, status_code=201)
def create_email_template(
    payload: EmailTemplateCreate,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    from modules import activity as activity_module

    record = templates_module.create_template(db, payload.model_dump())
    log_action(
        db,
        entity_type="email_template",
        entity_id=record.id,
        action="created",
        actor=user.username,
    )
    activity_module.log_activity(
        db,
        user_id=user.id,
        activity_type=activity_module.EMAIL_TEMPLATE_CREATED,
        title="Email template created",
        summary=f"Created email template “{record.name}”",
        entity_type="email_template",
        entity_id=record.id,
        details={"name": record.name},
    )
    return _template_read(record)


@router.get("/placeholders")
def list_placeholders():
    from modules.email_templates import SUPPORTED_PLACEHOLDERS

    return {
        "placeholders": SUPPORTED_PLACEHOLDERS,
        "usage": "Use [company_name], [contact_name], etc. in subject and body.",
    }


@router.get("/{template_id}", response_model=EmailTemplateRead)
def get_email_template(template_id: int, db: Session = Depends(get_db)):
    record = templates_module.get_template(db, template_id)
    if not record:
        raise HTTPException(404, "Template not found")
    return _template_read(record)


@router.patch("/{template_id}", response_model=EmailTemplateRead)
def update_email_template(
    template_id: int,
    payload: EmailTemplateUpdate,
    db: Session = Depends(get_db),
):
    record = templates_module.update_template(
        db, template_id, payload.model_dump(exclude_unset=True)
    )
    if not record:
        raise HTTPException(404, "Template not found")
    log_action(db, entity_type="email_template", entity_id=record.id, action="updated")
    return _template_read(record)


@router.delete("/{template_id}", status_code=204)
def delete_email_template(template_id: int, db: Session = Depends(get_db)):
    if not templates_module.delete_template(db, template_id):
        raise HTTPException(404, "Template not found")
    log_action(db, entity_type="email_template", entity_id=template_id, action="deleted")


@router.post("/preview-text", response_model=EmailTemplatePreviewRead)
def preview_email_text(payload: EmailTextPreviewRequest, db: Session = Depends(get_db)):
    preview = templates_module.preview_text(
        db,
        buyer_id=payload.buyer_id,
        subject=payload.subject,
        body=payload.body,
    )
    if not preview:
        raise HTTPException(404, "Lead not found")
    return EmailTemplatePreviewRead(**preview)


@router.get("/{template_id}/preview/{buyer_id}", response_model=EmailTemplatePreviewRead)
def preview_email_template(template_id: int, buyer_id: int, db: Session = Depends(get_db)):
    preview = templates_module.preview_template(db, template_id, buyer_id)
    if not preview:
        raise HTTPException(404, "Template or lead not found")
    return EmailTemplatePreviewRead(**preview)
