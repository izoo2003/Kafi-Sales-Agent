"""AI Mode — after-hours auto-reply + company lifecycle (AISOS Module 3).

When an employee enables AI Mode, inbound query emails (inbox / junk) and
WhatsApp messages can receive the drafted auto-reply from this module.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from db.models import (
    AiCallActivityLog,
    AiCompanyLifecycle,
    AiFollowUpActivityLog,
    AiInterestedActivityLog,
    AiLeadTransferLog,
    AiModeAutoReplyLog,
    AiModeQueryLog,
    AiModeSettings,
    AppUser,
    AppUserRole,
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
    {"key": "potential_clients", "label": "Potential Clients"},
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
    "rfq",
    "price list",
    "pricing",
    "interested",
    "looking for",
    "catalogue",
    "catalog",
    "sample",
    "moq",
    "specification",
    "spec sheet",
    "please quote",
    "send quote",
    "bulk supply",
    "import inquiry",
    "import enquiry",
]

# Standalone product/brand words — too weak alone (newsletters, spam, marketing).
_WEAK_ONLY_KEYWORDS = frozenset(
    {
        "product",
        "products",
        "call",
        "form",
        "meeting",
        "information",
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
        "price",  # alone matches "price" in unrelated ads; prefer "pricing" / "price list"
    }
)

_NOISE_MARKERS = (
    "***spam***",
    "[spam]",
    "unsubscribe",
    "newsletter",
    "mailer-daemon",
    "delivery status notification",
    "undeliverable",
    "out of office",
    "automatic reply",
    "auto-reply",
    "do not reply",
    "noreply",
    "no-reply",
    "donotreply",
)

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
        "query_keywords": resolve_query_keywords(row.query_keywords),
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


def _phrase_in(haystack: str, phrase: str) -> bool:
    """Word-boundary match for single tokens; substring for multi-word phrases."""
    p = (phrase or "").strip().lower()
    if not p:
        return False
    if " " in p or "-" in p:
        return p in haystack
    return re.search(rf"(?<![a-z0-9]){re.escape(p)}(?![a-z0-9])", haystack) is not None


def resolve_query_keywords(stored: list[str] | None) -> list[str]:
    """Prefer inquiry-focused keywords; drop legacy weak-only tokens from old defaults."""
    keys = [str(k).strip().lower() for k in (stored or []) if str(k).strip()]
    if not keys:
        return list(DEFAULT_QUERY_KEYWORDS)
    # Old defaults mixed intent words with brand/product noise — strip the noise.
    cleaned = [k for k in keys if k not in _WEAK_ONLY_KEYWORDS]
    return cleaned if cleaned else list(DEFAULT_QUERY_KEYWORDS)


def _is_noise_message(
    text: str,
    *,
    from_email: str | None = None,
) -> bool:
    hay = (text or "").lower()
    addr = (from_email or "").strip().lower()
    if any(m in hay for m in _NOISE_MARKERS):
        return True
    if addr:
        local = addr.split("@", 1)[0]
        if local in {
            "noreply",
            "no-reply",
            "donotreply",
            "do-not-reply",
            "mailer-daemon",
            "notifications",
        }:
            return True
        if local.startswith("noreply") or local.startswith("no-reply"):
            return True
        if "noreply@" in addr or "no-reply@" in addr:
            return True
    return False


def looks_like_query(
    text: str,
    keywords: list[str] | None,
    *,
    from_email: str | None = None,
) -> bool:
    """True only for genuine buyer-inquiry style mail — not newsletters/spam/weak hits."""
    hay = (text or "").lower()
    if not hay.strip():
        return False
    if _is_noise_message(hay, from_email=from_email):
        return False

    keys = [str(k).strip().lower() for k in (keywords or DEFAULT_QUERY_KEYWORDS) if str(k).strip()]
    if not keys:
        keys = [k.lower() for k in DEFAULT_QUERY_KEYWORDS]

    matched = [k for k in keys if _phrase_in(hay, k)]
    if not matched:
        return False

    # Reject if every hit is a weak brand/product word with no real inquiry intent.
    if all(m in _WEAK_ONLY_KEYWORDS for m in matched):
        return False

    return True


def _message_key(*parts: str) -> str:
    raw = "|".join(p.strip().lower() for p in parts if p)
    return hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()[:64]


def _already_sent(db: Session, user_id: int, message_key: str) -> bool:
    """Only successful sends block retries — prior errors may be retried."""
    return (
        db.query(AiModeAutoReplyLog.id)
        .filter(
            AiModeAutoReplyLog.user_id == user_id,
            AiModeAutoReplyLog.message_key == message_key,
            AiModeAutoReplyLog.status == "sent",
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
    existing = (
        db.query(AiModeAutoReplyLog)
        .filter(
            AiModeAutoReplyLog.user_id == user_id,
            AiModeAutoReplyLog.message_key == message_key,
        )
        .order_by(AiModeAutoReplyLog.id.desc())
        .first()
    )
    if existing:
        if existing.status == "sent":
            return
        existing.recipient = recipient
        existing.subject = subject
        existing.preview = (preview or "")[:2000] or None
        existing.status = status
        existing.detail = detail
        existing.channel = channel
        db.commit()
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


def _query_row_to_dict(row: AiModeQueryLog) -> dict[str, Any]:
    return {
        "id": row.id,
        "folder": row.folder,
        "uid": row.uid,
        "from_email": row.from_email,
        "from_name": row.from_name,
        "subject": row.subject,
        "preview": row.preview,
        "received_at": row.received_at.isoformat() if row.received_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def upsert_query_log(
    db: Session,
    *,
    user_id: int,
    message_key: str,
    folder: str,
    uid: str,
    from_email: str | None,
    from_name: str | None,
    subject: str | None,
    preview: str | None,
    received_at: datetime | None,
) -> tuple[AiModeQueryLog, bool]:
    """Insert or refresh a query detection. Returns (row, created)."""
    existing = (
        db.query(AiModeQueryLog)
        .filter(
            AiModeQueryLog.user_id == user_id,
            AiModeQueryLog.message_key == message_key,
        )
        .one_or_none()
    )
    if existing:
        existing.folder = folder
        existing.uid = uid
        existing.from_email = from_email
        existing.from_name = from_name
        existing.subject = subject
        existing.preview = (preview or "")[:2000] or None
        if received_at is not None:
            existing.received_at = received_at
        db.commit()
        db.refresh(existing)
        return existing, False

    row = AiModeQueryLog(
        user_id=user_id,
        message_key=message_key,
        folder=folder,
        uid=uid,
        from_email=from_email,
        from_name=from_name,
        subject=subject,
        preview=(preview or "")[:2000] or None,
        received_at=received_at,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, True


def _purge_non_query_rows(
    db: Session,
    user_id: int,
    keywords: list[str],
) -> int:
    """Remove logged rows that no longer pass the inquiry filter."""
    rows = (
        db.query(AiModeQueryLog)
        .filter(AiModeQueryLog.user_id == user_id)
        .all()
    )
    removed = 0
    for row in rows:
        blob = f"{row.subject or ''}\n{row.preview or ''}"
        if looks_like_query(blob, keywords, from_email=row.from_email):
            continue
        db.delete(row)
        removed += 1
    if removed:
        db.commit()
    return removed


def list_queries(db: Session, user_id: int, *, limit: int = 100) -> dict[str, Any]:
    settings = get_or_create_settings(db, user_id)
    keywords = resolve_query_keywords(settings.query_keywords)
    _purge_non_query_rows(db, user_id, keywords)

    total = (
        db.query(AiModeQueryLog.id).filter(AiModeQueryLog.user_id == user_id).count()
    )
    rows = (
        db.query(AiModeQueryLog)
        .filter(AiModeQueryLog.user_id == user_id)
        .order_by(
            AiModeQueryLog.received_at.desc().nullslast(),
            AiModeQueryLog.created_at.desc(),
        )
        .limit(limit)
        .all()
    )
    return {"count": total, "rows": [_query_row_to_dict(r) for r in rows]}


def get_query(db: Session, user_id: int, query_id: int) -> AiModeQueryLog | None:
    return (
        db.query(AiModeQueryLog)
        .filter(AiModeQueryLog.id == query_id, AiModeQueryLog.user_id == user_id)
        .one_or_none()
    )


def fetch_query_message(db: Session, user: AppUser, query_id: int) -> dict[str, Any]:
    """Load full mailbox message for a logged query belonging to this user."""
    row = get_query(db, user.id, query_id)
    if not row:
        raise ValueError("Query not found")

    from modules import inbox as inbox_module
    from modules.mailbox_accounts import hosts_enabled, resolve_user_mailbox

    if not hosts_enabled() or not resolve_user_mailbox(user):
        raise ValueError("Mailbox not configured for your account")

    folder = row.folder or "INBOX"
    message = inbox_module.get_message(user, row.uid, folder=folder)
    if not message and folder.upper() != "INBOX":
        message = inbox_module.get_message(user, row.uid, folder="INBOX")
    if not message:
        raise ValueError("Original email not found in mailbox (may have been moved or deleted)")

    return {
        "query": _query_row_to_dict(row),
        "message": message,
    }


def scan_queries_for_user(
    db: Session,
    user: AppUser,
    *,
    deep: bool = False,
    limit: int = 10,
) -> dict[str, Any]:
    """Scan inbox for real inquiry matches and upsert query log rows.

    deep=True (Scan mailbox button): fresh IMAP pull of the latest N emails
    (read + unread), with full bodies. Default N=10.
    deep=False (background job): lighter unread-only headers scan.
    """
    settings = get_or_create_settings(db, user.id)
    from modules import inbox as inbox_module
    from modules.inbox_cutoff import as_utc
    from modules.mailbox_accounts import hosts_enabled, resolve_user_mailbox

    if not hosts_enabled() or not resolve_user_mailbox(user):
        return {
            "scanned": 0,
            "matched": 0,
            "created": 0,
            "purged": 0,
            "deep": deep,
            "error": "Mailbox not configured",
        }

    keywords = resolve_query_keywords(settings.query_keywords)
    # Drop previously logged false positives (weak keyword / spam matches).
    purged = _purge_non_query_rows(db, user.id, keywords)

    created = 0
    matched = 0
    scanned = 0
    deepened = 0
    errors: list[str] = []
    fetch_limit = max(1, min(int(limit or 10), 50))

    try:
        if deep:
            messages = inbox_module.list_inbox_for_query_scan(user, limit=fetch_limit)
        else:
            messages = inbox_module.list_messages(
                user, limit=min(fetch_limit, 40), unread_only=True, folder="inbox"
            )
    except Exception as exc:  # noqa: BLE001
        return {
            "scanned": 0,
            "matched": 0,
            "created": 0,
            "purged": purged,
            "deep": deep,
            "error": str(exc),
            "errors": [str(exc)],
        }

    for msg in messages:
        scanned += 1
        if msg.get("direction") == "outbound":
            continue
        subject = (msg.get("subject") or "").strip()
        preview = (msg.get("preview") or "").strip()
        body = (
            (msg.get("body_text") or msg.get("body") or msg.get("body_html") or "")
            .strip()
        )
        from_email = (msg.get("from_email") or "").strip()
        uid = str(msg.get("uid") or "")
        if not from_email or not uid:
            continue

        blob = f"{subject}\n{preview}\n{body}"
        # Deepen with full fetch if headers-only left body empty and subject is thin.
        if deep and not body and not looks_like_query(
            f"{subject}\n{preview}", keywords, from_email=from_email
        ):
            # Still try a detail fetch — keyword may only appear in body.
            try:
                detail = inbox_module.get_message(
                    user, uid, folder=str(msg.get("folder") or "INBOX")
                )
                if detail:
                    deepened += 1
                    body = (
                        (detail.get("body_text") or detail.get("body") or "")
                        .strip()
                    )
                    preview = preview or (detail.get("preview") or "").strip()
                    blob = f"{subject}\n{preview}\n{body}"
            except Exception as exc:  # noqa: BLE001
                errors.append(f"uid {uid}: {exc}")

        if not looks_like_query(blob, keywords, from_email=from_email):
            continue

        matched += 1
        key = _message_key("email", "inbox", uid, from_email, subject)
        received = as_utc(msg.get("date")) if msg.get("date") else None
        imap_folder = str(msg.get("folder") or "INBOX")
        preview_out = (preview or body or "")[:400] or None
        _, was_created = upsert_query_log(
            db,
            user_id=user.id,
            message_key=key,
            folder=imap_folder,
            uid=uid,
            from_email=from_email,
            from_name=(msg.get("from_name") or "").strip() or None,
            subject=subject or None,
            preview=preview_out,
            received_at=received,
        )
        if was_created:
            created += 1

    return {
        "scanned": scanned,
        "matched": matched,
        "created": created,
        "purged": purged,
        "deepened": deepened,
        "deep": deep,
        "errors": errors[:5],
    }


def scan_queries_for_all_mailbox_users(db: Session) -> dict[str, Any]:
    """Scan every active user with a configured mailbox (AI Mode not required).

    Same inquiry filter for all accounts — each user's New Lead (Queries) is
    isolated to their own inbox + keywords.
    """
    from modules.mailbox_accounts import hosts_enabled, resolve_user_mailbox

    if not hosts_enabled():
        return {"users": 0, "matched": 0, "created": 0, "purged": 0, "errors": []}

    users = (
        db.query(AppUser)
        .filter(AppUser.is_active.is_(True))
        .order_by(AppUser.id.asc())
        .all()
    )
    totals: dict[str, Any] = {
        "users": 0,
        "matched": 0,
        "created": 0,
        "purged": 0,
        "errors": [],
    }
    for user in users:
        if not resolve_user_mailbox(user):
            continue
        totals["users"] += 1
        # Ensure each account has settings + default inquiry keywords.
        get_or_create_settings(db, user.id)
        result = scan_queries_for_user(db, user, deep=False, limit=40)
        totals["matched"] += int(result.get("matched") or 0)
        totals["created"] += int(result.get("created") or 0)
        totals["purged"] += int(result.get("purged") or 0)
        err = result.get("error")
        if err:
            totals["errors"].append(f"user {user.id}: {err}")
        for e in result.get("errors") or []:
            totals["errors"].append(f"user {user.id}: {e}")
    totals["errors"] = totals["errors"][:20]
    return totals


def process_email_auto_replies_for_user(
    db: Session,
    user: AppUser,
    *,
    scan_queries: bool = True,
) -> dict[str, Any]:
    """Auto-reply to the latest matching unread query email (one per run).

    Scans inbox, picks the newest inbound unread that matches keywords
    and has not already been sent successfully, then sends a single reply via
    the configured outbound path (Vercel mailer when set).
    """
    # Always refresh query detections first (count does not require auto-reply on).
    query_scan = (
        scan_queries_for_user(db, user, deep=False, limit=40)
        if scan_queries
        else {"skipped": True}
    )

    settings = get_or_create_settings(db, user.id)
    if not settings.enabled or not settings.email_auto_reply_enabled:
        return {
            "processed": 0,
            "replied": 0,
            "skipped": 0,
            "enabled": False,
            "queries": query_scan,
        }

    from modules import inbox as inbox_module
    from modules.inbox_cutoff import date_sort_key
    from modules.mailbox_accounts import hosts_enabled, resolve_user_mailbox

    if not hosts_enabled() or not resolve_user_mailbox(user):
        return {
            "processed": 0,
            "replied": 0,
            "skipped": 0,
            "enabled": True,
            "error": "Mailbox not configured",
            "queries": query_scan,
        }

    folders = ["inbox", "junk"]
    candidates: list[tuple[str, dict[str, Any]]] = []
    errors: list[str] = []
    skip_reasons: dict[str, int] = {
        "outbound": 0,
        "missing_fields": 0,
        "not_a_query": 0,
        "already_sent": 0,
    }

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
            if msg.get("direction") == "outbound":
                skip_reasons["outbound"] += 1
                continue
            subject = (msg.get("subject") or "").strip()
            preview = (msg.get("preview") or msg.get("body") or "").strip()
            from_email = (msg.get("from_email") or "").strip()
            uid = str(msg.get("uid") or "")
            if not from_email or not uid:
                skip_reasons["missing_fields"] += 1
                continue

            blob = f"{subject}\n{preview}"
            if not looks_like_query(
                blob,
                resolve_query_keywords(settings.query_keywords),
                from_email=from_email,
            ):
                skip_reasons["not_a_query"] += 1
                continue

            key = _message_key("email", folder, uid, from_email, subject)
            if _already_sent(db, user.id, key):
                skip_reasons["already_sent"] += 1
                continue

            candidates.append((folder, {**msg, "_ai_key": key}))

    scanned = sum(skip_reasons.values()) + len(candidates)
    # Newest first — one reply per process click / scheduled tick.
    candidates.sort(
        key=lambda item: date_sort_key(item[1].get("date")),
        reverse=True,
    )

    settings.last_email_processed_at = _utcnow()
    db.commit()

    if not candidates:
        return {
            "processed": scanned,
            "replied": 0,
            "skipped": scanned,
            "enabled": True,
            "mode": "latest_one",
            "message": (
                "No matching unread query emails to reply to. "
                f"Skipped: {skip_reasons}."
            ),
            "skip_reasons": skip_reasons,
            "errors": errors[:5],
            "queries": query_scan,
        }

    folder, msg = candidates[0]
    subject = (msg.get("subject") or "").strip()
    preview = (msg.get("preview") or msg.get("body") or "").strip()
    from_email = (msg.get("from_email") or "").strip()
    uid = str(msg.get("uid") or "")
    key = str(msg.get("_ai_key") or "")
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
        if "{subject}" not in (settings.email_subject_template or ""):
            reply_subject = f"Re: {subject}" if subject else reply_subject

    remaining_skipped = scanned - 1  # others in the scan pool not attempted this run
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
        detail = result.get("message")
        _log_reply(
            db,
            user_id=user.id,
            channel="email",
            message_key=key,
            recipient=from_email,
            subject=reply_subject,
            preview=preview[:400],
            status="sent" if status == "sent" else status,
            detail=detail,
        )
        if status == "sent":
            return {
                "processed": scanned,
                "replied": 1,
                "skipped": remaining_skipped,
                "enabled": True,
                "mode": "latest_one",
                "message": f"Replied to latest match: {from_email} — {reply_subject[:80]}",
                "recipient": from_email,
                "subject": reply_subject,
                "skip_reasons": skip_reasons,
                "remaining_candidates": max(0, len(candidates) - 1),
                "errors": errors[:5],
                "queries": query_scan,
            }
        return {
            "processed": scanned,
            "replied": 0,
            "skipped": remaining_skipped + 1,
            "enabled": True,
            "mode": "latest_one",
            "message": f"Latest match failed ({from_email}): {detail}",
            "recipient": from_email,
            "subject": reply_subject,
            "skip_reasons": skip_reasons,
            "remaining_candidates": max(0, len(candidates) - 1),
            "errors": errors[:5] + ([str(detail)] if detail else []),
            "queries": query_scan,
        }
    except Exception as exc:  # noqa: BLE001
        errors.append(f"{from_email}: {exc}")
        return {
            "processed": scanned,
            "replied": 0,
            "skipped": remaining_skipped + 1,
            "enabled": True,
            "mode": "latest_one",
            "message": f"Latest match error ({from_email}): {exc}",
            "recipient": from_email,
            "subject": reply_subject,
            "skip_reasons": skip_reasons,
            "remaining_candidates": max(0, len(candidates) - 1),
            "errors": errors[:5],
            "queries": query_scan,
        }


def process_all_enabled_email_users(db: Session) -> dict[str, Any]:
    # Keep New Lead (Queries) fresh for every mailbox user, not only AI Mode ON.
    query_totals = scan_queries_for_all_mailbox_users(db)

    rows = (
        db.query(AiModeSettings, AppUser)
        .join(AppUser, AppUser.id == AiModeSettings.user_id)
        .filter(
            AiModeSettings.enabled.is_(True),
            AiModeSettings.email_auto_reply_enabled.is_(True),
            AppUser.is_active.is_(True),
        )
        .all()
    )
    totals = {
        "users": 0,
        "processed": 0,
        "replied": 0,
        "skipped": 0,
        "queries": query_totals,
    }
    for settings, user in rows:
        totals["users"] += 1
        # Query scan already ran for all mailbox users above.
        result = process_email_auto_replies_for_user(
            db, user, scan_queries=False
        )
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
    if not looks_like_query(
        message_text, resolve_query_keywords(settings.query_keywords)
    ):
        return {"status": "skipped", "reason": "not_a_query"}

    key = _message_key(
        "whatsapp",
        provider_message_id or "",
        contact.wa_id or contact.phone or str(contact.id),
        message_text[:200],
    )
    if _already_sent(db, user.id, key):
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
    # Assigned chip tracks transfer volume (sum of leads sent), not company rows.
    transfers = list_lead_transfers(db, limit=1)
    counts["assigned"] = int(transfers.get("total_leads") or 0)
    # Calling chip tracks total call statements across all users (admin + sales).
    calls = list_call_activities(db, limit=1)
    counts["calling"] = int(calls.get("total_calls") or 0)
    # Follow-up chip tracks Follow up clients activity across all users.
    follow_ups = list_follow_up_activities(db, limit=1)
    counts["follow_up"] = int(follow_ups.get("total_events") or 0)
    # Interested chip = buyers currently on Interested Clients table.
    counts["interested"] = _interested_clients_list_count(db)
    # Potential Clients = Scrapped Leads with company + AI grade AA/AAA.
    potential = list_potential_clients(db, limit=1)
    counts["potential_clients"] = int(potential.get("total") or 0)
    return counts


_POTENTIAL_GRADES = frozenset({"AAA", "AA"})
_POTENTIAL_GRADE_ALIASES = {
    "HOT": "AAA",
    "WARM": "AA",
    "AAA": "AAA",
    "AA": "AA",
}


def _normalize_potential_grade(raw: str | None) -> str | None:
    key = (raw or "").strip().upper()
    mapped = _POTENTIAL_GRADE_ALIASES.get(key)
    return mapped if mapped in _POTENTIAL_GRADES else None


def list_potential_clients(
    db: Session,
    *,
    search: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict[str, Any]:
    """Scrapped Leads (not Old clients) with company grading AND AI grade AA/AAA."""
    from sqlalchemy import func, or_
    from db.models import LeadScore, LeadScoreLabel

    ranked = (
        db.query(
            LeadScore.buyer_id.label("buyer_id"),
            LeadScore.score.label("score"),
            LeadScore.reasoning.label("reasoning"),
            LeadScore.scored_at.label("scored_at"),
            func.row_number()
            .over(
                partition_by=LeadScore.buyer_id,
                order_by=LeadScore.scored_at.desc(),
            )
            .label("rn"),
        ).subquery()
    )
    latest = (
        db.query(
            ranked.c.buyer_id,
            ranked.c.score,
            ranked.c.reasoning,
            ranked.c.scored_at,
        )
        .filter(ranked.c.rn == 1)
        .subquery()
    )

    company_grade = func.upper(func.trim(func.coalesce(Buyer.company_grading, "")))
    q = (
        db.query(Buyer, latest.c.score, latest.c.reasoning, latest.c.scored_at)
        .join(latest, Buyer.id == latest.c.buyer_id)
        .filter(
            # Scrapped / Discover pool — never Old clients.
            ~func.lower(func.coalesce(Buyer.source, "")).in_(["old_clients"]),
            latest.c.score.in_([LeadScoreLabel.AAA, LeadScoreLabel.AA]),
            or_(
                company_grade.in_(["AAA", "AA"]),
                company_grade.in_(["HOT", "WARM"]),  # legacy Excel labels
            ),
        )
    )
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(
            or_(
                Buyer.company_name.ilike(like),
                Buyer.country.ilike(like),
            )
        )

    total = q.count()
    rows = (
        q.order_by(Buyer.company_name.asc(), Buyer.id.asc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    out_rows: list[dict[str, Any]] = []
    for buyer, ai_score, reasoning, scored_at in rows:
        company_g = _normalize_potential_grade(buyer.company_grading) or (
            (buyer.company_grading or "").strip().upper() or None
        )
        ai_g = ai_score.value if hasattr(ai_score, "value") else str(ai_score)
        out_rows.append(
            {
                "buyer_id": buyer.id,
                "company_name": buyer.company_name,
                "country": buyer.country,
                "source": buyer.source,
                "company_grading": buyer.company_grading,
                "company_grade": company_g,
                "ai_grade": ai_g,
                "score_reasoning": (reasoning or "")[:500] or None,
                "scored_at": scored_at.isoformat() if scored_at else None,
                "assigned_to": buyer.assigned_to,
                "assigned_to_user_id": buyer.assigned_to_user_id,
            }
        )

    return {"total": int(total), "rows": out_rows}


# Back-compat alias (older callers / API path).
list_interested_scrapped_leads = list_potential_clients


def _mark_buyers_assigned_stage(
    db: Session,
    buyer_ids: list[int],
    *,
    user_id: int | None,
    note: str | None = None,
) -> None:
    """Move transferred buyers into lifecycle stage `assigned` (no extra commit)."""
    now = _utcnow()
    for buyer_id in buyer_ids:
        row = (
            db.query(AiCompanyLifecycle)
            .filter(AiCompanyLifecycle.buyer_id == buyer_id)
            .one_or_none()
        )
        if not row:
            row = AiCompanyLifecycle(
                buyer_id=buyer_id,
                stage="assigned",
                stage_entered_at=now,
                history=[
                    {
                        "stage": "assigned",
                        "at": now.isoformat(),
                        "notes": note,
                        "by_user_id": user_id,
                    }
                ],
                updated_by_user_id=user_id,
            )
            db.add(row)
            continue
        if row.stage == "assigned":
            continue
        history = list(row.history or [])
        history.append(
            {
                "stage": "assigned",
                "at": now.isoformat(),
                "notes": note,
                "by_user_id": user_id,
            }
        )
        row.stage = "assigned"
        row.stage_entered_at = now
        row.history = history
        row.updated_by_user_id = user_id
        row.updated_at = now


def record_lead_transfer(
    db: Session,
    *,
    buyer_ids: list[int],
    to_user_id: int,
    to_label: str,
    by_user_id: int | None = None,
    commit: bool = True,
) -> dict[str, Any] | None:
    """Log an admin → sales-user lead transfer for the Assigned tab.

    Returns the event dict, or None if nothing to record (empty / unassign).
    """
    ids = sorted({int(b) for b in buyer_ids if b is not None})
    if not ids or to_user_id is None:
        return None

    label = (to_label or "").strip() or f"user #{to_user_id}"
    count = len(ids)
    noun = "lead" if count == 1 else "leads"
    message = f"{count} {noun} transferred to {label}"

    row = AiLeadTransferLog(
        by_user_id=by_user_id,
        to_user_id=to_user_id,
        to_label=label,
        lead_count=count,
        buyer_ids=ids[:500],
        message=message,
    )
    db.add(row)
    _mark_buyers_assigned_stage(
        db,
        ids,
        user_id=by_user_id,
        note=message,
    )
    if commit:
        db.commit()
        db.refresh(row)
    return {
        "id": row.id if commit else None,
        "by_user_id": by_user_id,
        "to_user_id": to_user_id,
        "to_label": label,
        "lead_count": count,
        "message": message,
        "created_at": row.created_at.isoformat() if commit and row.created_at else None,
    }


def list_lead_transfers(db: Session, *, limit: int = 100) -> dict[str, Any]:
    from sqlalchemy import func

    total_leads = (
        db.query(func.coalesce(func.sum(AiLeadTransferLog.lead_count), 0)).scalar() or 0
    )
    total_events = db.query(func.count(AiLeadTransferLog.id)).scalar() or 0
    rows = (
        db.query(AiLeadTransferLog)
        .order_by(AiLeadTransferLog.created_at.desc(), AiLeadTransferLog.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "total_leads": int(total_leads),
        "total_events": int(total_events),
        "rows": [
            {
                "id": r.id,
                "by_user_id": r.by_user_id,
                "to_user_id": r.to_user_id,
                "to_label": r.to_label,
                "lead_count": r.lead_count,
                "message": r.message,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


def _caller_label(user: AppUser | None, fallback: str | None = None) -> str:
    if user is not None:
        name = (user.username or "").strip() or (user.full_name or "").strip()
        if name:
            return name
    return (fallback or "").strip() or "Someone"


def _mark_buyer_calling_stage(
    db: Session,
    buyer_id: int | None,
    *,
    user_id: int | None,
    note: str | None = None,
) -> None:
    """Advance early-stage buyers to `calling` when a call is placed (no extra commit)."""
    if not buyer_id:
        return
    now = _utcnow()
    early = {"new_lead", "assigned"}
    row = (
        db.query(AiCompanyLifecycle)
        .filter(AiCompanyLifecycle.buyer_id == buyer_id)
        .one_or_none()
    )
    if not row:
        row = AiCompanyLifecycle(
            buyer_id=buyer_id,
            stage="calling",
            stage_entered_at=now,
            history=[
                {
                    "stage": "calling",
                    "at": now.isoformat(),
                    "notes": note,
                    "by_user_id": user_id,
                }
            ],
            updated_by_user_id=user_id,
        )
        db.add(row)
        return
    if row.stage not in early:
        return
    history = list(row.history or [])
    history.append(
        {
            "stage": "calling",
            "at": now.isoformat(),
            "notes": note,
            "by_user_id": user_id,
        }
    )
    row.stage = "calling"
    row.stage_entered_at = now
    row.history = history
    row.updated_by_user_id = user_id
    row.updated_at = now


def record_call_activity(
    db: Session,
    *,
    user_id: int,
    company_name: str,
    buyer_id: int | None = None,
    interaction_id: int | None = None,
    user_label: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Log a call statement for Company lifecycle → Calling."""
    user = db.get(AppUser, user_id)
    label = _caller_label(user, user_label)
    company = (company_name or "").strip() or "a company"
    message = f"{label} called {company}"

    row = AiCallActivityLog(
        user_id=user_id,
        user_label=label,
        buyer_id=buyer_id,
        company_name=company[:255],
        interaction_id=interaction_id,
        message=message[:500],
    )
    db.add(row)
    _mark_buyer_calling_stage(
        db,
        buyer_id,
        user_id=user_id,
        note=message,
    )
    if commit:
        db.commit()
        db.refresh(row)
    return {
        "id": row.id if commit else None,
        "user_id": user_id,
        "user_label": label,
        "buyer_id": buyer_id,
        "company_name": company,
        "interaction_id": interaction_id,
        "message": message,
        "created_at": row.created_at.isoformat() if commit and row.created_at else None,
    }


def list_call_activities(db: Session, *, limit: int = 100) -> dict[str, Any]:
    from sqlalchemy import func

    total_calls = db.query(func.count(AiCallActivityLog.id)).scalar() or 0
    rows = (
        db.query(AiCallActivityLog)
        .order_by(AiCallActivityLog.created_at.desc(), AiCallActivityLog.id.desc())
        .limit(limit)
        .all()
    )
    return {
        "total_calls": int(total_calls),
        "rows": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "user_label": r.user_label,
                "buyer_id": r.buyer_id,
                "company_name": r.company_name,
                "interaction_id": r.interaction_id,
                "message": r.message,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


def _mark_buyer_follow_up_stage(
    db: Session,
    buyer_id: int | None,
    *,
    user_id: int | None,
    note: str | None = None,
) -> None:
    """Advance early stages to `follow_up` when a next-call follow-up is placed."""
    if not buyer_id:
        return
    now = _utcnow()
    advance_from = {"new_lead", "assigned", "calling", "potential_clients"}
    row = (
        db.query(AiCompanyLifecycle)
        .filter(AiCompanyLifecycle.buyer_id == buyer_id)
        .one_or_none()
    )
    if not row:
        row = AiCompanyLifecycle(
            buyer_id=buyer_id,
            stage="follow_up",
            stage_entered_at=now,
            history=[
                {
                    "stage": "follow_up",
                    "at": now.isoformat(),
                    "notes": note,
                    "by_user_id": user_id,
                }
            ],
            updated_by_user_id=user_id,
        )
        db.add(row)
        return
    if row.stage not in advance_from:
        return
    history = list(row.history or [])
    history.append(
        {
            "stage": "follow_up",
            "at": now.isoformat(),
            "notes": note,
            "by_user_id": user_id,
        }
    )
    row.stage = "follow_up"
    row.stage_entered_at = now
    row.history = history
    row.updated_by_user_id = user_id
    row.updated_at = now


def mark_buyer_interested_stage(
    db: Session,
    buyer_id: int | None,
    *,
    user_id: int | None,
    note: str | None = None,
    commit: bool = False,
) -> None:
    """Advance lifecycle to `interested` when call outcome is Client is Interested."""
    if not buyer_id:
        return
    now = _utcnow()
    advance_from = {
        "new_lead",
        "assigned",
        "calling",
        "follow_up",
        "potential_clients",
    }
    row = (
        db.query(AiCompanyLifecycle)
        .filter(AiCompanyLifecycle.buyer_id == buyer_id)
        .one_or_none()
    )
    if not row:
        row = AiCompanyLifecycle(
            buyer_id=buyer_id,
            stage="interested",
            stage_entered_at=now,
            history=[
                {
                    "stage": "interested",
                    "at": now.isoformat(),
                    "notes": note,
                    "by_user_id": user_id,
                }
            ],
            updated_by_user_id=user_id,
        )
        db.add(row)
        if commit:
            db.commit()
        return
    if row.stage == "interested":
        return
    if row.stage not in advance_from:
        return
    history = list(row.history or [])
    history.append(
        {
            "stage": "interested",
            "at": now.isoformat(),
            "notes": note,
            "by_user_id": user_id,
        }
    )
    row.stage = "interested"
    row.stage_entered_at = now
    row.history = history
    row.updated_by_user_id = user_id
    row.updated_at = now
    if commit:
        db.commit()


def record_follow_up_activity(
    db: Session,
    *,
    user_id: int,
    company_name: str,
    buyer_id: int | None = None,
    event_type: str = "placed",
    follow_up_at: datetime | None = None,
    user_label: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Log Follow up clients activity for Company lifecycle → Follow-up.

    Works for admin and sales users the same way.
    """
    user = db.get(AppUser, user_id)
    label = _caller_label(user, user_label)
    company = (company_name or "").strip() or "a company"
    kind = (event_type or "placed").strip().lower() or "placed"

    if kind == "scheduled" and follow_up_at is not None:
        when = follow_up_at.astimezone(timezone.utc).strftime("%Y-%m-%d")
        message = f"{label} scheduled a follow-up for {company} on {when}"
    elif kind == "scheduled":
        message = f"{label} scheduled a follow-up for {company}"
    else:
        kind = "placed"
        message = f"{label} put {company} in Follow up clients"

    row = AiFollowUpActivityLog(
        user_id=user_id,
        user_label=label,
        buyer_id=buyer_id,
        company_name=company[:255],
        event_type=kind,
        follow_up_at=follow_up_at,
        message=message[:500],
    )
    db.add(row)
    if kind == "placed":
        _mark_buyer_follow_up_stage(
            db,
            buyer_id,
            user_id=user_id,
            note=message,
        )
    if commit:
        db.commit()
        db.refresh(row)
    return {
        "id": row.id if commit else None,
        "user_id": user_id,
        "user_label": label,
        "buyer_id": buyer_id,
        "company_name": company,
        "event_type": kind,
        "follow_up_at": follow_up_at.isoformat() if follow_up_at else None,
        "message": message,
        "created_at": row.created_at.isoformat() if commit and row.created_at else None,
    }


def list_follow_up_activities(db: Session, *, limit: int = 100) -> dict[str, Any]:
    from sqlalchemy import func

    total_events = db.query(func.count(AiFollowUpActivityLog.id)).scalar() or 0
    rows = (
        db.query(AiFollowUpActivityLog)
        .order_by(
            AiFollowUpActivityLog.created_at.desc(),
            AiFollowUpActivityLog.id.desc(),
        )
        .limit(limit)
        .all()
    )
    return {
        "total_events": int(total_events),
        "rows": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "user_label": r.user_label,
                "buyer_id": r.buyer_id,
                "company_name": r.company_name,
                "event_type": r.event_type,
                "follow_up_at": r.follow_up_at.isoformat() if r.follow_up_at else None,
                "message": r.message,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


def _interested_clients_list_count(db: Session) -> int:
    from sqlalchemy import func

    return int(
        db.query(func.count(Buyer.id))
        .filter(Buyer.interested_clients_list_at.isnot(None))
        .scalar()
        or 0
    )


def _is_admin_user(user: AppUser) -> bool:
    role = user.role.value if isinstance(user.role, AppUserRole) else str(user.role)
    return role == AppUserRole.admin.value


def record_interested_activity(
    db: Session,
    *,
    user_id: int,
    company_name: str,
    buyer_id: int | None = None,
    event_type: str = "placed",
    source: str = "manual",
    user_label: str | None = None,
    note: str | None = None,
    commit: bool = True,
) -> dict[str, Any]:
    """Log Interested Clients activity for Company lifecycle → Interested."""
    user = db.get(AppUser, user_id)
    label = _caller_label(user, user_label)
    company = (company_name or "").strip() or "a company"
    kind = (event_type or "placed").strip().lower() or "placed"
    src = (source or "manual").strip().lower() or "manual"

    if kind == "placed":
        message = f"{label} added {company} to Interested Clients"
        if buyer_id:
            buyer = db.get(Buyer, buyer_id)
            if buyer and buyer.interested_clients_list_at is None:
                buyer.interested_clients_list_at = _utcnow()
            mark_buyer_interested_stage(
                db,
                buyer_id,
                user_id=user_id,
                note=note or message,
                commit=False,
            )
    else:
        kind = "removed"
        message = f"{label} removed {company} from Interested Clients"

    row = AiInterestedActivityLog(
        user_id=user_id,
        user_label=label,
        buyer_id=buyer_id,
        company_name=company[:255],
        event_type=kind,
        source=src[:50],
        message=message[:500],
    )
    db.add(row)
    if commit:
        db.commit()
        db.refresh(row)
    return {
        "id": row.id if commit else None,
        "user_id": user_id,
        "user_label": label,
        "buyer_id": buyer_id,
        "company_name": company,
        "event_type": kind,
        "source": src,
        "message": message,
        "created_at": row.created_at.isoformat() if commit and row.created_at else None,
    }


def list_interested_activities(
    db: Session,
    *,
    viewer: AppUser,
    limit: int = 100,
    after_id: int | None = None,
) -> dict[str, Any]:
    from sqlalchemy import func

    is_admin = _is_admin_user(viewer)
    total_in_list = _interested_clients_list_count(db)

    placed_filter = AiInterestedActivityLog.event_type == "placed"
    total_events = (
        db.query(func.count(AiInterestedActivityLog.id)).filter(placed_filter).scalar()
        or 0
    )

    by_user_rows = (
        db.query(
            AiInterestedActivityLog.user_id,
            AiInterestedActivityLog.user_label,
            func.count(AiInterestedActivityLog.id),
        )
        .filter(placed_filter)
        .group_by(AiInterestedActivityLog.user_id, AiInterestedActivityLog.user_label)
        .order_by(func.count(AiInterestedActivityLog.id).desc())
        .all()
    )
    by_user = [
        {
            "user_id": uid,
            "user_label": label,
            "placed_count": int(cnt),
        }
        for uid, label, cnt in by_user_rows
    ]
    my_placed = next(
        (item["placed_count"] for item in by_user if item["user_id"] == viewer.id),
        0,
    )

    feed_query = db.query(AiInterestedActivityLog).filter(placed_filter)
    if not is_admin:
        feed_query = feed_query.filter(AiInterestedActivityLog.user_id == viewer.id)
    if after_id is not None:
        feed_query = feed_query.filter(AiInterestedActivityLog.id > after_id).order_by(
            AiInterestedActivityLog.id.asc()
        )
    else:
        feed_query = feed_query.order_by(
            AiInterestedActivityLog.created_at.desc(),
            AiInterestedActivityLog.id.desc(),
        )

    rows = feed_query.limit(limit).all()
    latest_id = (
        db.query(func.max(AiInterestedActivityLog.id)).scalar() or 0
    )

    return {
        "total_in_list": total_in_list,
        "total_events": int(total_events),
        "my_placed_count": my_placed,
        "by_user": by_user if is_admin else [],
        "latest_id": int(latest_id),
        "rows": [
            {
                "id": r.id,
                "user_id": r.user_id,
                "user_label": r.user_label,
                "buyer_id": r.buyer_id,
                "company_name": r.company_name,
                "event_type": r.event_type,
                "source": r.source,
                "message": r.message,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


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