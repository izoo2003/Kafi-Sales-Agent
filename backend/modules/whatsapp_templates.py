"""Sync + read cache of WhatsApp message templates approved on the Meta WABA.

Templates are authored and approved in Meta Business Manager — this module only
mirrors their current status locally so the dashboard can pick one for a campaign
without an extra round-trip per page load.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from db.models import WhatsAppTemplate, WhatsAppTemplateStatus
from integrations.whatsapp_client import whatsapp_client

_STATUS_MAP = {
    "approved": WhatsAppTemplateStatus.approved,
    "pending": WhatsAppTemplateStatus.pending,
    "rejected": WhatsAppTemplateStatus.rejected,
    "paused": WhatsAppTemplateStatus.paused,
    "disabled": WhatsAppTemplateStatus.disabled,
}


def _extract_body_and_variables(components: list[dict[str, Any]]) -> tuple[str | None, int]:
    body_text = None
    variable_count = 0
    for component in components or []:
        if (component.get("type") or "").upper() == "BODY":
            body_text = component.get("text")
            if body_text:
                variable_count = body_text.count("{{")
            break
    return body_text, variable_count


def sync_templates_from_meta(db: Session) -> dict[str, Any]:
    result = whatsapp_client.list_templates()
    if result.get("status") != "ok":
        return {
            "status": result.get("status", "error"),
            "message": result.get("message", "Template sync failed"),
            "synced_count": 0,
        }

    synced = 0
    for raw in result.get("templates") or []:
        meta_id = raw.get("id")
        name = raw.get("name")
        if not name:
            continue

        components = raw.get("components") or []
        body_text, variable_count = _extract_body_and_variables(components)
        status = _STATUS_MAP.get((raw.get("status") or "").lower(), WhatsAppTemplateStatus.pending)

        record = None
        if meta_id:
            record = db.query(WhatsAppTemplate).filter_by(meta_template_id=meta_id).first()
        if not record:
            record = (
                db.query(WhatsAppTemplate)
                .filter_by(name=name, language=raw.get("language") or "en")
                .first()
            )

        if not record:
            record = WhatsAppTemplate(meta_template_id=meta_id, name=name)
            db.add(record)

        record.meta_template_id = meta_id or record.meta_template_id
        record.name = name
        record.category = raw.get("category")
        record.language = raw.get("language") or "en"
        record.status = status
        record.components = components
        record.body_text = body_text
        record.variable_count = variable_count
        synced += 1

    db.commit()
    return {"status": "ok", "message": f"Synced {synced} template(s)", "synced_count": synced}


def list_templates(db: Session, *, approved_only: bool = False) -> list[WhatsAppTemplate]:
    query = db.query(WhatsAppTemplate)
    if approved_only:
        query = query.filter(WhatsAppTemplate.status == WhatsAppTemplateStatus.approved)
    return query.order_by(WhatsAppTemplate.updated_at.desc()).all()


def get_template(db: Session, template_id: int) -> WhatsAppTemplate | None:
    return db.get(WhatsAppTemplate, template_id)


def render_variables(body_text: str, variables: list[str]) -> str:
    """Preview only — actual send uses Meta's {{n}} component substitution."""
    rendered = body_text
    for index, value in enumerate(variables, start=1):
        rendered = rendered.replace(f"{{{{{index}}}}}", value)
    return rendered


def build_body_component(variables: list[str]) -> list[dict[str, Any]]:
    if not variables:
        return []
    return [
        {
            "type": "body",
            "parameters": [{"type": "text", "text": value} for value in variables],
        }
    ]


def template_to_dict(template: WhatsAppTemplate) -> dict[str, Any]:
    return {
        "id": template.id,
        "meta_template_id": template.meta_template_id,
        "name": template.name,
        "category": template.category,
        "language": template.language,
        "status": template.status.value,
        "body_text": template.body_text,
        "variable_count": template.variable_count,
        "synced_at": template.synced_at,
    }
