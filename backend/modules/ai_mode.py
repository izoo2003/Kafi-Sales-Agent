"""AI Mode — after-hours auto-reply + company lifecycle (AISOS Module 3).

When an employee enables AI Mode, inbound query emails (inbox / junk) and
WhatsApp messages can receive the drafted auto-reply from this module.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from db.models import (
    AiCompanyLifecycle,
    AiModeAutoReplyLog,
    AiModeSettings,
    AppUser,
    Buyer,
    Channel,
    Contact,
    Direction,
    HandledBy,
    Interaction,
    InteractionStatus,
)

LIFECYCLE_STAGES: list[dict[str, str]] = [
    {"key": "new_lead", "label": "New Lead"},
    {"key": "assigned", "label": "Assigned"},
    {"key": "calling", "label": "Calling"},
    {"key": "follow_up", "label": "Follow-up"},
    {"key": "interested", "label": "Interested"},
    {"key": "quotation_sent", "label": "Quotation Sent"},
    {"key": "negotiation", "label": "Negotiation"},
    {"key": "won", "label": "Won"},
    {"key": "lost", "label": "Lost"},
]

LIFECYCLE_STAGE_KEYS = {s["key"] for s in LIFECYCLE_STAGES}

DEFAULT_QUERY_KEYWORDS = [
    "inquiry",
    "enquiry",
    "quote",
    "quotation",
    "price",
    "pricing",
    "product",
    "interested",
    "information",
    "catalog",
    "catalogue",
    "sample",
    "meeting",
    "call",
    "form",
    "kafi",
    "essence",
    "basmati",
    "rice",
    "salt",
    "chutney",
    "pickle",
    "spice",
    "import",
    "export",
    "moq",
    "specification",
    "spec sheet",
]

DEFAULT_EMAIL_SUBJECT = "Thank you for your interest in Kafi Commodities"

DEFAULT_EMAIL_BODY = """Dear {name},

Thank you for showing interest in Kafi Commodities.

We would like you to fill out this form{form_clause}, or please provide a suitable date/time for a virtual meeting/call and our team will get back to you.

Best regards,
Kafi Commodities Export Team
"""

DEFAULT_WHATSAPP_BODY = """Thank you for showing interest in Kafi Commodities.

Please fill out this form{form_clause}, or share a suitable date/time for a virtual meeting/call and our team will get back to you.

— Kafi Commodities Export Team"""


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _default_settings_payload() -> dict[str, Any]:
    return {
        "enabled": False,
        "email_auto_reply_enabled": True,
        "whatsapp_auto_reply_enabled": True,
        "form_url": None,
        "email_subject_template": DEFAULT_EMAIL_SUBJECT,
        "email_body_template": DEFAULT_EMAIL_BODY.strip(),
        "whatsapp_body_template": DEFAULT_WHATSAPP_BODY.strip(),
        "query_keywords": list(DEFAULT_QUERY_KEYWORDS),
        "last_email_processed_at": None,
        "updated_at": None,
    }


def get_or_create_settings(db: Session, user_id: int) -> AiModeSettings:
    row = db.get(AiModeSettings, user_id)
    if row:
        return row
    defaults = _default_settings_payload()
    row = AiModeSettings(
        user_id=user_id,
        enabled=False,
        email_auto_reply_enabled=True,
        whatsapp_auto_reply_enabled=True,
        form_url=None,
        email_subject_template=defaults["email_subject_template"],
        email_body_template=defaults["email_body_template"],
        whatsapp_body_template=defaults["whatsapp_body_template"],
        query_keywords=defaults["query_keywords"],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def settings_to_dict(row: AiModeSettings) -> dict[str, Any]:
    return {
        "user_id": row.user_id,
        "enabled": bool(row.enabled),
        "email_auto_reply_enabled": bool(row.email_auto_reply_enabled),
        "whatsapp_auto_reply_enabled": bool(row.whatsapp_auto_reply_enabled),
        "form_url": row.form_url,
        "email_subject_template": row.email_subject_template or DEFAULT_EMAIL_SUBJECT,
        "email_body_template": row.email_body_template or DEFAULT_EMAIL_BODY.strip(),
        "whatsapp_body_template": row.whatsapp_body_template or DEFAULT_WHATSAPP_BODY.strip(),
        "query_keywords": row.query_keywords or list(DEFAULT_QUERY_KEYWORDS),
        "last_email_processed_at": row.last_email_processed_at.isoformat()
        if row.last_email_processed_at
        else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "lifecycle_stages": LIFECYCLE_STAGES,
    }


def update_settings(db: Session, user_id: int, data: dict[str, Any]) -> dict[str, Any]:
    row = get_or_create_settings(db, user_id)
    if "enabled" in data and data["enabled"] is not None:
        row.enabled = bool(data["enabled"])
    if "email_auto_reply_enabled" in data and data["email_auto_reply_enabled"] is not None:
        row.email_auto_reply_enabled = bool(data["email_auto_reply_enabled"])
    if "whatsapp_auto_reply_enabled" in data and data["whatsapp_auto_reply_enabled"] is not None:
        row.whatsapp_auto_reply_enabled = bool(data["whatsapp_auto_reply_enabled"])
    if "form_url" in data:
        url = (data["form_url"] or "").strip() or None
        row.form_url = url
    if "email_subject_template" in data and data["email_subject_template"] is not None:
        row.email_subject_template = str(data["email_subject_template"]).strip() or DEFAULT_EMAIL_SUBJECT
    if "email_body_template" in data and data["email_body_template"] is not None:
        row.email_body_template = str(data["email_body_template"]).strip() or DEFAULT_EMAIL_BODY.strip()
    if "whatsapp_body_template" in data and data["whatsapp_body_template"] is not None:
        row.whatsapp_body_template = (
            str(data["whatsapp_body_template"]).strip() or DEFAULT_WHATSAPP_BODY.strip()
        )
    if "query_keywords" in data and data["query_keywords"] is not None:
        keywords = data["query_keywords"]
        if isinstance(keywords, str):
            keywords = [k.strip() for k in keywords.split(",") if k.strip()]
        row.query_keywords = [str(k).strip().lower() for k in keywords if str(k).strip()]
    row.updated_at = _utcnow()
    db.commit()
    db.refresh(row)
    return settings_to_dict(row)


def _form_clause(form_url: str | None) -> str:
    url = (form_url or "").strip()
    if url:
        return f": {url}"
    return " (link will be shared by our team)"


def render_template(template: str, *, name: str, form_url: str | None, subject: str = "") -> str:
    return (
        (template or "")
        .replace("{name}", name or "Sir/Madam")
        .replace("{form_clause}", _form_clause(form_url))
        .replace("{form_url}", (form_url or "").strip() or "(form link)")
        .replace("{subject}", subject or "")
    )


def looks_like_query(text: str, keywords: list[str] | None) -> bool:
    hay = (text or "").lower()
    if not hay.strip():
        return False
    keys = keywords or DEFAULT_QUERY_KEYWORDS
    return any(k.lower() in hay for k in keys if k)


def _message_key(*parts: str) -> str:
    raw = "|".join(p.strip().lower() for p in parts if p)
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()[:64]


def _already_replied(db: Session, user_id: int, message_key: str) -> bool:
    return (
        db.query(AiModeAutoReplyLog.id)
        .filter(
            AiModeAutoReplyLog.user_id == user_id,
            AiModeAutoReplyLog.message_key == message_key,
        )
        .first()
        is not None
    )


def _log_reply(
    db: Session,
    *,
    user_id: int,
    channel: str,
    message_key: str,
    recipient: str | None,
    subject: str | None,
    preview: str | None,
    status: str,
    detail: str | None = None,
) -> None:
    if _already_replied(db, user_id, message_key):
        return
    db.add(
        AiModeAutoReplyLog(
            user_id=user_id,
            channel=channel,
            message_key=message_key,
            recipient=recipient,
            subject=subject,
            preview=(preview or "")[:2000] or None,
            status=status,
            detail=detail,
        )
    )
    db.commit()


def list_auto_reply_log(db: Session, user_id: int, *, limit: int = 50) -> list[dict[str, Any]]:
    rows = (
        db.query(AiModeAutoReplyLog)
        .filter(AiModeAutoReplyLog.user_id == user_id)
        .order_by(AiModeAutoReplyLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "channel": r.channel,
            "recipient": r.recipient,
            "subject": r.subject,
            "preview": r.preview,
            "status": r.status,
            "detail": r.detail,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


def process_email_auto_replies_for_user(db: Session, user: AppUser) -> dict[str, Any]:
    """Scan inbox (+ junk if available) and auto-reply to query emails when AI Mode is on."""
    settings = get_or_create_settings(db, user.id)
    if not settings.enabled or not settings.email_auto_reply_enabled:
        return {"processed": 0, "replied": 0, "skipped": 0, "enabled": False}

    from modules import inbox as inbox_module
    from modules.mailbox_accounts import hosts_enabled, resolve_user_mailbox

    if not hosts_enabled() or not resolve_user_mailbox(user):
        return {
            "processed": 0,
            "replied": 0,
            "skipped": 0,
            "enabled": True,
            "error": "Mailbox not configured",
        }

    folders = ["inbox", "junk"]

    replied = 0
    processed = 0
    skipped = 0
    errors: list[str] = []

    for folder in folders:
        try:
            messages = inbox_module.list_messages(
                user, limit=40, unread_only=True, folder=folder
            )
        except Exception as exc:  # noqa: BLE001
            if folder == "inbox":
                errors.append(str(exc))
            continue

        for msg in messages:
            processed += 1
            if msg.get("direction") == "outbound":
                skipped += 1
                continue
            subject = (msg.get("subject") or "").strip()
            preview = (msg.get("preview") or msg.get("body") or "").strip()
            from_email = (msg.get("from_email") or "").strip()
            uid = str(msg.get("uid") or "")
            if not from_email or not uid:
                skipped += 1
                continue

            blob = f"{subject}\n{preview}"
            if not looks_like_query(blob, settings.query_keywords):
                skipped += 1
                continue

            key = _message_key("email", folder, uid, from_email, subject)
            if _already_replied(db, user.id, key):
                skipped += 1
                continue

            name = (msg.get("from_name") or "").strip() or from_email.split("@")[0]
            body = render_template(
                settings.email_body_template,
                name=name,
                form_url=settings.form_url,
                subject=subject,
            )
            reply_subject = render_template(
                settings.email_subject_template or DEFAULT_EMAIL_SUBJECT,
                name=name,
                form_url=settings.form_url,
                subject=subject,
            )
            if subject and not reply_subject.lower().startswith("re:"):
                # Keep thread association when original subject exists
                if "{subject}" not in (settings.email_subject_template or ""):
                    reply_subject = f"Re: {subject}" if subject else reply_subject

            try:
                result = inbox_module.reply(
                    user,
                    uid,
                    body,
                    folder=msg.get("folder") or ("INBOX" if folder == "inbox" else folder),
                    to=from_email,
                    subject=reply_subject,
                    include_quote=False,
                )
                status = result.get("status") or "error"
                _log_reply(
                    db,
                    user_id=user.id,
                    channel="email",
                    message_key=key,
                    recipient=from_email,
                    subject=reply_subject,
                    preview=preview[:400],
                    status="sent" if status == "sent" else status,
                    detail=result.get("message"),
                )
                if status == "sent":
                    replied += 1
                else:
                    skipped += 1
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{from_email}: {exc}")
                skipped += 1

    settings.last_email_processed_at = _utcnow()
    db.commit()
    return {
        "processed": processed,
        "replied": replied,
        "skipped": skipped,
        "enabled": True,
        "errors": errors[:5],
    }


def process_all_enabled_email_users(db: Session) -> dict[str, Any]:
    rows = (
        db.query(AiModeSettings, AppUser)
        .join(AppUser, AppUser.id == AiModeSettings.user_id)
        .filter(AiModeSettings.enabled.is_(True), AiModeSettings.email_auto_reply_enabled.is_(True))
        .all()
    )
    totals = {"users": 0, "processed": 0, "replied": 0, "skipped": 0}
    for settings, user in rows:
        totals["users"] += 1
        result = process_email_auto_replies_for_user(db, user)
        totals["processed"] += int(result.get("processed") or 0)
        totals["replied"] += int(result.get("replied") or 0)
        totals["skipped"] += int(result.get("skipped") or 0)
    return totals


def _settings_for_whatsapp_contact(db: Session, contact: Contact) -> tuple[AppUser, AiModeSettings] | None:
    buyer = db.get(Buyer, contact.buyer_id) if contact.buyer_id else None
    candidate_ids: list[int] = []
    if buyer and buyer.assigned_to_user_id:
        candidate_ids.append(buyer.assigned_to_user_id)
    # Fallback: any user with AI Mode + WhatsApp auto-reply on
    enabled_users = (
        db.query(AiModeSettings.user_id)
        .filter(
            AiModeSettings.enabled.is_(True),
            AiModeSettings.whatsapp_auto_reply_enabled.is_(True),
        )
        .all()
    )
    for (uid,) in enabled_users:
        if uid not in candidate_ids:
            candidate_ids.append(uid)

    for uid in candidate_ids:
        settings = db.get(AiModeSettings, uid)
        user = db.get(AppUser, uid)
        if settings and user and settings.enabled and settings.whatsapp_auto_reply_enabled:
            return user, settings
    return None


def maybe_auto_reply_whatsapp(
    db: Session,
    *,
    contact: Contact,
    message_text: str,
    provider_message_id: str | None = None,
) -> dict[str, Any] | None:
    """If AI Mode is on for the assignee (or any enabled user), send WhatsApp auto-reply."""
    matched = _settings_for_whatsapp_contact(db, contact)
    if not matched:
        return None
    user, settings = matched
    if not looks_like_query(message_text, settings.query_keywords):
        return {"status": "skipped", "reason": "not_a_query"}

    key = _message_key(
        "whatsapp",
        provider_message_id or "",
        contact.wa_id or contact.phone or str(contact.id),
        message_text[:200],
    )
    if _already_replied(db, user.id, key):
        return {"status": "skipped", "reason": "already_replied"}

    body = render_template(
        settings.whatsapp_body_template,
        name=(contact.full_name or "").strip() or "there",
        form_url=settings.form_url,
    )
    phone = contact.phone or contact.wa_id
    if not phone:
        return {"status": "error", "reason": "no_phone"}

    from integrations.whatsapp_client import whatsapp_client

    within_window = bool(
        contact.whatsapp_window_expires_at
        and contact.whatsapp_window_expires_at > _utcnow()
    )
    send_result = whatsapp_client.send_approved(
        phone=phone,
        message=body,
        within_session_window=within_window,
    )
    status = send_result.get("status") or "error"
    if status == "sent":
        db.add(
            Interaction(
                contact_id=contact.id,
                channel=Channel.whatsapp,
                direction=Direction.outbound,
                content=body,
                language=contact.preferred_language or "en",
                handled_by=HandledBy.agent,
                status=InteractionStatus.sent,
                provider_message_id=send_result.get("provider_message_id"),
            )
        )
        db.commit()

    _log_reply(
        db,
        user_id=user.id,
        channel="whatsapp",
        message_key=key,
        recipient=phone,
        subject=None,
        preview=message_text[:400],
        status=status,
        detail=send_result.get("message"),
    )
    return {"status": status, "user_id": user.id, "send_result": send_result}


# ── Company lifecycle ─────────────────────────────────────────────────────────


def _lifecycle_to_dict(row: AiCompanyLifecycle, buyer: Buyer | None = None) -> dict[str, Any]:
    return {
        "id": row.id,
        "buyer_id": row.buyer_id,
        "company_name": buyer.company_name if buyer else None,
        "country": buyer.country if buyer else None,
        "stage": row.stage,
        "stage_label": next(
            (s["label"] for s in LIFECYCLE_STAGES if s["key"] == row.stage), row.stage
        ),
        "stage_entered_at": row.stage_entered_at.isoformat() if row.stage_entered_at else None,
        "history": row.history or [],
        "notes": row.notes,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def ensure_lifecycle(db: Session, buyer_id: int) -> AiCompanyLifecycle:
    row = (
        db.query(AiCompanyLifecycle)
        .filter(AiCompanyLifecycle.buyer_id == buyer_id)
        .one_or_none()
    )
    if row:
        return row
    now = _utcnow()
    row = AiCompanyLifecycle(
        buyer_id=buyer_id,
        stage="new_lead",
        stage_entered_at=now,
        history=[{"stage": "new_lead", "at": now.isoformat(), "notes": None}],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_lifecycle(
    db: Session,
    *,
    stage: str | None = None,
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    q = db.query(AiCompanyLifecycle, Buyer).join(Buyer, Buyer.id == AiCompanyLifecycle.buyer_id)
    if stage:
        q = q.filter(AiCompanyLifecycle.stage == stage)
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(Buyer.company_name.ilike(like))
    total = q.count()
    rows = (
        q.order_by(AiCompanyLifecycle.updated_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {
        "total": total,
        "stages": LIFECYCLE_STAGES,
        "rows": [_lifecycle_to_dict(lc, buyer) for lc, buyer in rows],
    }


def update_lifecycle(
    db: Session,
    buyer_id: int,
    *,
    stage: str,
    notes: str | None = None,
    user_id: int | None = None,
) -> dict[str, Any]:
    stage_key = (stage or "").strip().lower().replace(" ", "_").replace("-", "_")
    if stage_key not in LIFECYCLE_STAGE_KEYS:
        raise ValueError(f"Invalid stage. Use one of: {', '.join(sorted(LIFECYCLE_STAGE_KEYS))}")

    buyer = db.get(Buyer, buyer_id)
    if not buyer:
        raise ValueError("Buyer not found")

    row = ensure_lifecycle(db, buyer_id)
    now = _utcnow()
    history = list(row.history or [])
    if row.stage != stage_key:
        history.append(
            {
                "stage": stage_key,
                "at": now.isoformat(),
                "notes": (notes or "").strip() or None,
                "by_user_id": user_id,
            }
        )
        row.stage = stage_key
        row.stage_entered_at = now
        row.history = history
    if notes is not None:
        row.notes = notes.strip() or None
    row.updated_by_user_id = user_id
    row.updated_at = now
    db.commit()
    db.refresh(row)
    return _lifecycle_to_dict(row, buyer)


def lifecycle_pipeline_counts(db: Session) -> dict[str, int]:
    from sqlalchemy import func

    rows = (
        db.query(AiCompanyLifecycle.stage, func.count(AiCompanyLifecycle.id))
        .group_by(AiCompanyLifecycle.stage)
        .all()
    )
    counts = {s["key"]: 0 for s in LIFECYCLE_STAGES}
    for stage, count in rows:
        if stage in counts:
            counts[stage] = int(count)
    return counts


# ── Remarks history helpers ───────────────────────────────────────────────────


def append_remarks_history(
    buyer: Buyer,
    *,
    previous_text: str,
    by_username: str | None = None,
) -> None:
    text = (previous_text or "").strip()
    if not text:
        return
    history = list(buyer.remarks_history or [])
    history.append(
        {
            "text": text,
            "at": _utcnow().isoformat(),
            "by": by_username,
        }
    )
    buyer.remarks_history = history[-100:]
