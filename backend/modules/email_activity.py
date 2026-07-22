"""Email activity notifications — outbound send lifecycle events for the dashboard."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from db.models import EmailActivityEvent

# Canonical event types. Some are emitted today; others are reserved for ESP/webhook tracking.
EVENT_CATALOG: dict[str, dict[str, str]] = {
    "send_started": {
        "label": "Send started",
        "description": "Outbound send was initiated for one or more recipients.",
    },
    "sent": {
        "label": "Email sent",
        "description": "SMTP accepted the message and the send completed successfully.",
    },
    "send_failed": {
        "label": "Send failed",
        "description": "The provider rejected the send or an unexpected error occurred.",
    },
    "mailbox_not_configured": {
        "label": "Mailbox not configured",
        "description": "Outbound email credentials are missing or incomplete.",
    },
    "invalid_recipient": {
        "label": "Invalid recipient",
        "description": "No usable email address was found for the contact.",
    },
    "authentication_failed": {
        "label": "Authentication failed",
        "description": "SMTP/OAuth login to the mailbox failed.",
    },
    "network_error": {
        "label": "Network error",
        "description": "Could not reach the mail server (timeout, DNS, connection).",
    },
    "attachment_rejected": {
        "label": "Attachment rejected",
        "description": "An attachment was too large, blocked, or unreadable.",
    },
    "rate_limited": {
        "label": "Rate limited",
        "description": "Sending paused or blocked by provider daily/hourly limits.",
    },
    "bulk_started": {
        "label": "Bulk send started",
        "description": "A multi-recipient outbound batch began.",
    },
    "bulk_progress": {
        "label": "Bulk send progress",
        "description": "Intermediate status while a bulk batch is running.",
    },
    "bulk_completed": {
        "label": "Bulk send completed",
        "description": "All messages in a bulk batch finished (success and/or failure).",
    },
    "bulk_partial": {
        "label": "Bulk send partial",
        "description": "Some messages in a bulk batch sent; others failed or were skipped.",
    },
    "skipped_no_email": {
        "label": "Skipped — no email",
        "description": "Lead was skipped because no contact email was on file.",
    },
    "delivered": {
        "label": "Delivered",
        "description": "Provider confirmed delivery to the recipient mailbox (ESP webhook).",
    },
    "deferred": {
        "label": "Deferred",
        "description": "Temporary delivery delay; provider will retry.",
    },
    "bounced_soft": {
        "label": "Soft bounce",
        "description": "Temporary bounce (full mailbox, greylist) — may succeed on retry.",
    },
    "bounced_hard": {
        "label": "Hard bounce",
        "description": "Permanent bounce (invalid address, domain does not exist).",
    },
    "opened": {
        "label": "Opened",
        "description": "Recipient opened the email (tracking pixel / ESP event).",
    },
    "clicked": {
        "label": "Link clicked",
        "description": "Recipient clicked a tracked link in the email.",
    },
    "replied": {
        "label": "Reply received",
        "description": "Recipient replied to the outbound thread.",
    },
    "unsubscribed": {
        "label": "Unsubscribed",
        "description": "Recipient opted out of further outreach.",
    },
    "spam_complaint": {
        "label": "Spam complaint",
        "description": "Recipient marked the message as spam.",
    },
    "blocked": {
        "label": "Blocked",
        "description": "Message blocked by policy, denylist, or content filters.",
    },
}

SEVERITY_BY_TYPE: dict[str, str] = {
    "send_started": "info",
    "sent": "success",
    "send_failed": "error",
    "mailbox_not_configured": "warning",
    "invalid_recipient": "warning",
    "authentication_failed": "error",
    "network_error": "error",
    "attachment_rejected": "warning",
    "rate_limited": "warning",
    "bulk_started": "info",
    "bulk_progress": "info",
    "bulk_completed": "success",
    "bulk_partial": "warning",
    "skipped_no_email": "warning",
    "delivered": "success",
    "deferred": "warning",
    "bounced_soft": "warning",
    "bounced_hard": "error",
    "opened": "success",
    "clicked": "success",
    "replied": "success",
    "unsubscribed": "warning",
    "spam_complaint": "error",
    "blocked": "error",
}


def classify_send_result(send_result: dict | None) -> str:
    """Map mail_client/outlook status payloads to a canonical event type."""
    if not send_result:
        return "send_failed"
    status = str(send_result.get("status") or "").lower()
    message = str(send_result.get("message") or "").lower()
    if status == "sent":
        return "sent"
    if status == "not_configured":
        return "mailbox_not_configured"
    if "auth" in message or "login" in message or "credential" in message:
        return "authentication_failed"
    if "timeout" in message or "connection" in message or "network" in message:
        return "network_error"
    if "attachment" in message or "too large" in message:
        return "attachment_rejected"
    if "rate" in message or "limit" in message or "throttle" in message:
        return "rate_limited"
    if "invalid" in message or "recipient" in message or "address" in message:
        return "invalid_recipient"
    if "block" in message or "spam" in message or "policy" in message:
        return "blocked"
    return "send_failed"


def record_event(
    db: Session,
    *,
    event_type: str,
    title: str,
    message: str,
    buyer_id: int | None = None,
    contact_id: int | None = None,
    interaction_id: int | None = None,
    details: dict[str, Any] | None = None,
    severity: str | None = None,
) -> EmailActivityEvent:
    event = EmailActivityEvent(
        event_type=event_type,
        severity=severity or SEVERITY_BY_TYPE.get(event_type, "info"),
        title=title,
        message=message,
        buyer_id=buyer_id,
        contact_id=contact_id,
        interaction_id=interaction_id,
        details=details or {},
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def record_send_result(
    db: Session,
    *,
    send_result: dict | None,
    company_name: str,
    to_email: str | None,
    buyer_id: int | None = None,
    contact_id: int | None = None,
    interaction_id: int | None = None,
    subject: str | None = None,
    send_mode: str = "individual",
) -> EmailActivityEvent:
    event_type = classify_send_result(send_result)
    catalog = EVENT_CATALOG.get(event_type, {})
    provider_message = (send_result or {}).get("message") or catalog.get("description", "")
    mode = "bulk" if send_mode == "bulk" else "individual"
    if event_type == "sent":
        title = f"Sent to {company_name}"
        message = f"Email delivered to outbound queue for {to_email or 'recipient'}."
        if subject:
            message = f"“{subject}” sent to {to_email or 'recipient'}."
    elif event_type == "mailbox_not_configured":
        title = "Mailbox not configured"
        message = str(provider_message)
    else:
        title = f"Send failed — {company_name}"
        message = str(provider_message) or f"Could not send to {to_email or company_name}."

    return record_event(
        db,
        event_type=event_type,
        title=title,
        message=message,
        buyer_id=buyer_id,
        contact_id=contact_id,
        interaction_id=interaction_id,
        details={
            "company_name": company_name,
            "to_email": to_email,
            "subject": subject,
            "send_result": send_result,
            "send_mode": mode,
        },
    )


def list_events(
    db: Session,
    *,
    page: int = 1,
    page_size: int = 30,
    unread_only: bool = False,
) -> tuple[list[EmailActivityEvent], int, int]:
    page = max(1, page)
    page_size = min(max(1, page_size), 100)
    query = db.query(EmailActivityEvent)
    if unread_only:
        query = query.filter(EmailActivityEvent.read_at.is_(None))
    total = query.count()
    unread = (
        db.query(EmailActivityEvent)
        .filter(EmailActivityEvent.read_at.is_(None))
        .count()
    )
    rows = (
        query.order_by(EmailActivityEvent.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return rows, total, unread


def mark_read(db: Session, event_ids: list[int] | None = None, *, mark_all: bool = False) -> int:
    now = datetime.now(timezone.utc)
    query = db.query(EmailActivityEvent).filter(EmailActivityEvent.read_at.is_(None))
    if mark_all:
        updated = query.update({EmailActivityEvent.read_at: now}, synchronize_session=False)
    elif event_ids:
        updated = query.filter(EmailActivityEvent.id.in_(event_ids)).update(
            {EmailActivityEvent.read_at: now},
            synchronize_session=False,
        )
    else:
        return 0
    db.commit()
    return int(updated or 0)


def event_to_dict(event: EmailActivityEvent) -> dict[str, Any]:
    catalog = EVENT_CATALOG.get(event.event_type, {})
    return {
        "id": event.id,
        "event_type": event.event_type,
        "event_label": catalog.get("label", event.event_type.replace("_", " ").title()),
        "severity": event.severity,
        "title": event.title,
        "message": event.message,
        "buyer_id": event.buyer_id,
        "contact_id": event.contact_id,
        "interaction_id": event.interaction_id,
        "details": event.details or {},
        "read_at": event.read_at.isoformat() if event.read_at else None,
        "created_at": event.created_at.isoformat() if event.created_at else None,
    }


def catalog_list() -> list[dict[str, str]]:
    return [
        {
            "event_type": key,
            "label": meta["label"],
            "description": meta["description"],
            "severity": SEVERITY_BY_TYPE.get(key, "info"),
        }
        for key, meta in EVENT_CATALOG.items()
    ]


_FAIL_TYPES = {
    "send_failed",
    "mailbox_not_configured",
    "invalid_recipient",
    "authentication_failed",
    "network_error",
    "attachment_rejected",
    "rate_limited",
    "blocked",
}


def insights_stats(db: Session, *, days: int | None = 30) -> dict[str, Any]:
    """Aggregate outbound email activity into bulk vs individual insight cards."""
    from modules.email_tracking import public_api_base

    query = db.query(EmailActivityEvent)
    since = None
    if days and days > 0:
        from datetime import timedelta

        since = datetime.now(timezone.utc) - timedelta(days=days)
        query = query.filter(EmailActivityEvent.created_at >= since)

    rows = query.all()

    individual_sent = 0
    individual_failed = 0
    individual_opened = 0
    bulk_sent = 0
    bulk_failed = 0
    bulk_opened = 0
    bulk_batches = 0
    bulk_batches_partial = 0
    bulk_batches_failed = 0

    for event in rows:
        details = event.details or {}
        mode = str(details.get("send_mode") or "").lower()
        et = event.event_type

        if et == "opened":
            if mode == "bulk":
                bulk_opened += 1
            else:
                individual_opened += 1
            continue

        if et in ("bulk_completed", "bulk_partial"):
            bulk_batches += 1
            if et == "bulk_partial":
                bulk_batches_partial += 1
            try:
                bulk_sent += int(details.get("sent_count") or 0)
            except (TypeError, ValueError):
                pass
            try:
                bulk_failed += int(details.get("failed_count") or 0)
            except (TypeError, ValueError):
                pass
            continue

        if et == "bulk_started":
            continue

        if et == "sent":
            if mode == "bulk":
                bulk_sent += 1
            else:
                individual_sent += 1
            continue

        if et in _FAIL_TYPES:
            # Bulk batch-level total failure (0 sent)
            if et == "send_failed" and (
                "sent_count" in details or "failed_count" in details or "interaction_ids" in details
            ):
                bulk_batches += 1
                bulk_batches_failed += 1
                try:
                    bulk_failed += int(details.get("failed_count") or 0)
                except (TypeError, ValueError):
                    pass
            elif mode == "bulk":
                bulk_failed += 1
            else:
                individual_failed += 1

    individual_total = individual_sent + individual_failed
    bulk_total = bulk_sent + bulk_failed
    total_sent = individual_sent + bulk_sent
    total_failed = individual_failed + bulk_failed
    total_opened = individual_opened + bulk_opened
    total_attempted = total_sent + total_failed
    not_opened = max(0, total_sent - total_opened)

    def _rate(part: int, whole: int) -> float:
        if whole <= 0:
            return 0.0
        return round((part / whole) * 100.0, 1)

    from modules.email_tracking import public_api_base

    return {
        "period_days": days,
        "since": since.isoformat() if since else None,
        "tracking_enabled": bool(public_api_base()),
        "totals": {
            "attempted": total_attempted,
            "sent": total_sent,
            "failed": total_failed,
            "opened": total_opened,
            "not_opened": not_opened,
            "open_rate_pct": _rate(total_opened, total_sent),
            "success_rate_pct": _rate(total_sent, total_attempted),
        },
        "individual": {
            "attempted": individual_total,
            "sent": individual_sent,
            "failed": individual_failed,
            "opened": individual_opened,
            "not_opened": max(0, individual_sent - individual_opened),
            "open_rate_pct": _rate(individual_opened, individual_sent),
            "success_rate_pct": _rate(individual_sent, individual_total),
        },
        "bulk": {
            "batches": bulk_batches,
            "batches_partial": bulk_batches_partial,
            "batches_failed": bulk_batches_failed,
            "attempted": bulk_total,
            "sent": bulk_sent,
            "failed": bulk_failed,
            "opened": bulk_opened,
            "not_opened": max(0, bulk_sent - bulk_opened),
            "open_rate_pct": _rate(bulk_opened, bulk_sent),
            "success_rate_pct": _rate(bulk_sent, bulk_total),
        },
        "event_count": len(rows),
    }
