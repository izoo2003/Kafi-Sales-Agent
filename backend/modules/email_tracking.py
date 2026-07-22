"""Outbound email open tracking — signed pixel tokens + HTML wrapper."""

from __future__ import annotations

import base64
import hashlib
import hmac
import html
from typing import Any

from sqlalchemy.orm import Session

from config import settings
from db.models import Contact, Interaction

# 1x1 transparent GIF
_PIXEL_GIF = base64.b64decode(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
)


def _track_secret() -> bytes:
    raw = (
        (settings.email_track_secret or "").strip()
        or (settings.mailbox_password or "").strip()
        or (settings.mailbox_email or "kafi-sales-agent")
    )
    return raw.encode("utf-8")


def public_api_base() -> str | None:
    base = (
        (settings.public_api_base_url or "").strip()
        or (settings.twilio_webhook_base_url or "").strip()
    )
    return base.rstrip("/") if base else None


def make_open_token(*, interaction_id: int, send_mode: str = "individual") -> str:
    mode = "bulk" if send_mode == "bulk" else "individual"
    payload = f"{int(interaction_id)}.{mode}"
    sig = hmac.new(_track_secret(), payload.encode("utf-8"), hashlib.sha256).hexdigest()[:20]
    raw = f"{payload}.{sig}".encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def parse_open_token(token: str) -> tuple[int, str] | None:
    text = (token or "").strip()
    if not text:
        return None
    try:
        padded = text + "=" * (-len(text) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
        interaction_id_s, mode, sig = decoded.split(".", 2)
        interaction_id = int(interaction_id_s)
        mode = "bulk" if mode == "bulk" else "individual"
        payload = f"{interaction_id}.{mode}"
        expected = hmac.new(
            _track_secret(), payload.encode("utf-8"), hashlib.sha256
        ).hexdigest()[:20]
        if not hmac.compare_digest(sig, expected):
            return None
        return interaction_id, mode
    except (ValueError, TypeError, UnicodeDecodeError):
        return None


def open_pixel_url(*, interaction_id: int, send_mode: str = "individual") -> str | None:
    base = public_api_base()
    if not base:
        return None
    token = make_open_token(interaction_id=interaction_id, send_mode=send_mode)
    return f"{base}/api/track/email-open/{token}.gif"


def plain_to_tracked_html(body: str, *, pixel_url: str | None) -> str:
    escaped = html.escape(body or "")
    paragraphs = [
        f"<p style=\"margin:0 0 12px;white-space:pre-wrap;font-family:Arial,sans-serif;"
        f"font-size:14px;line-height:1.5;color:#111\">{p.replace(chr(10), '<br>')}</p>"
        for p in escaped.split("\n\n")
    ]
    content = "".join(paragraphs) or (
        f"<p style=\"margin:0;font-family:Arial,sans-serif;font-size:14px;color:#111\">"
        f"{escaped.replace(chr(10), '<br>')}</p>"
    )
    pixel = ""
    if pixel_url:
        safe = html.escape(pixel_url, quote=True)
        pixel = (
            f'<img src="{safe}" width="1" height="1" alt="" '
            f'style="display:block;width:1px;height:1px;border:0" />'
        )
    return (
        "<!DOCTYPE html><html><body style=\"margin:0;padding:16px;background:#fff\">"
        f"{content}{pixel}</body></html>"
    )


def build_tracked_bodies(
    body: str,
    *,
    interaction_id: int | None,
    send_mode: str = "individual",
) -> tuple[str, str | None]:
    """Return (plain_text, html_or_none). HTML includes open pixel when public base URL is set."""
    plain = body or ""
    if not interaction_id:
        return plain, None
    pixel = open_pixel_url(interaction_id=interaction_id, send_mode=send_mode)
    if not pixel:
        return plain, None
    return plain, plain_to_tracked_html(plain, pixel_url=pixel)


def pixel_gif_bytes() -> bytes:
    return _PIXEL_GIF


def record_open(
    db: Session,
    *,
    interaction_id: int,
    send_mode: str = "individual",
) -> dict[str, Any]:
    """Record a first-open engagement event for an outbound email interaction."""
    from db.models import Buyer, EmailActivityEvent
    from modules import email_activity

    interaction = db.get(Interaction, interaction_id)
    if not interaction:
        return {"status": "ignored", "reason": "unknown_interaction"}

    already = (
        db.query(EmailActivityEvent)
        .filter(
            EmailActivityEvent.event_type == "opened",
            EmailActivityEvent.interaction_id == interaction_id,
        )
        .first()
    )
    if already:
        return {"status": "already_opened", "event_id": already.id}

    contact = db.get(Contact, interaction.contact_id)
    buyer_id = contact.buyer_id if contact else None
    company = "lead"
    to_email = contact.email if contact else None
    if buyer_id:
        buyer = db.get(Buyer, buyer_id)
        if buyer:
            company = buyer.company_name

    mode = "bulk" if send_mode == "bulk" else "individual"
    event = email_activity.record_event(
        db,
        event_type="opened",
        title=f"Opened — {company}",
        message=(
            f"Recipient opened “{interaction.subject or 'email'}”"
            f"{f' ({to_email})' if to_email else ''}."
        ),
        buyer_id=buyer_id,
        contact_id=interaction.contact_id,
        interaction_id=interaction_id,
        details={
            "send_mode": mode,
            "to_email": to_email,
            "subject": interaction.subject,
            "company_name": company,
        },
    )
    return {"status": "recorded", "event_id": event.id, "send_mode": mode}
