"""AI assistant for inbox emails — concise summary + editable reply draft."""

from __future__ import annotations

import re
from typing import Any

from config import settings
from modules import inbox as inbox_module
from modules.llm_client import _apply_prompt_template, _load_prompt, llm_client

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_html(html: str) -> str:
    text = _HTML_TAG_RE.sub(" ", html or "")
    return _WS_RE.sub(" ", text).strip()


def _message_plain_text(message: dict[str, Any]) -> str:
    text = (message.get("body_text") or "").strip()
    if text:
        return text
    html = message.get("body_html") or ""
    if html:
        return _strip_html(html)
    return (message.get("preview") or "").strip()


def _reply_subject(subject: str | None) -> str:
    value = (subject or "").strip()
    if not value:
        return "Re:"
    if value.lower().startswith("re:"):
        return value
    return f"Re: {value}"


def _pick_reply_to(messages: list[dict[str, Any]], mailbox_email: str | None) -> str:
    mailbox = (mailbox_email or "").strip().lower()
    for msg in reversed(messages):
        if msg.get("direction") == "outbound":
            continue
        email = (msg.get("from_email") or "").strip()
        if email and email.lower() != mailbox:
            return email
    # Fall back to last message recipient if only outbound exists
    if messages:
        last = messages[-1]
        if last.get("direction") == "outbound":
            tos = last.get("to") or []
            if tos:
                return str(tos[0])
        return (last.get("from_email") or "").strip()
    return ""


def _format_thread_context(thread: dict[str, Any], *, max_chars: int = 6000) -> str:
    lines: list[str] = [
        f"Subject: {thread.get('subject') or '(no subject)'}",
        f"Participants: {', '.join(thread.get('participants') or [])}",
        "",
    ]
    for msg in thread.get("messages") or []:
        direction = msg.get("direction") or "inbound"
        who = msg.get("from_name") or msg.get("from_email") or ("You" if direction == "outbound" else "Unknown")
        when = msg.get("date") or ""
        body = _message_plain_text(msg)[:1500]
        lines.append(f"--- {direction.upper()} | {who} | {when} ---")
        lines.append(body or "(empty)")
        lines.append("")
    text = "\n".join(lines).strip()
    return text[:max_chars]


def _format_single_message_context(message: dict[str, Any]) -> dict[str, Any]:
    """Wrap a single message as a minimal thread for the shared analyzer."""
    return {
        "subject": message.get("subject") or "(no subject)",
        "participants": [
            p
            for p in [
                message.get("from_email"),
                *((message.get("to") or [])[:3]),
            ]
            if p
        ],
        "messages": [message],
    }


def _fallback_analysis(thread: dict[str, Any], *, mailbox_email: str | None) -> dict[str, Any]:
    messages = thread.get("messages") or []
    latest = None
    for msg in reversed(messages):
        if msg.get("direction") != "outbound":
            latest = msg
            break
    if latest is None and messages:
        latest = messages[-1]

    preview = _message_plain_text(latest)[:280] if latest else ""
    who = ""
    if latest:
        who = latest.get("from_name") or latest.get("from_email") or "the sender"
    summary = (
        f"Email from {who} about “{thread.get('subject') or '(no subject)'}”. "
        + (preview or "Open the message for full details.")
    )
    to_addr = _pick_reply_to(messages, mailbox_email)
    display = settings.mailbox_display_name or "Kafi Commodities"
    draft = (
        f"Dear {who.split()[0] if who and '@' not in who else 'Sir/Madam'},\n\n"
        f"Thank you for your email regarding {thread.get('subject') or 'your enquiry'}. "
        f"We at {display} appreciate you reaching out and will be glad to assist.\n\n"
        f"Could you please share any additional details we should consider "
        f"(product interest, destination, and preferred timing)?\n\n"
        f"Best regards,\n{display}"
    )
    return {
        "summary": summary,
        "draft_reply": draft,
        "suggested_subject": _reply_subject(thread.get("subject")),
        "to": to_addr,
        "source": "fallback",
    }


def analyze_thread(thread: dict[str, Any], *, goal: str | None = None) -> dict[str, Any]:
    mailbox_email = settings.mailbox_email
    mailbox_display = settings.mailbox_display_name or "Kafi Commodities"
    fallback = _fallback_analysis(thread, mailbox_email=mailbox_email)

    if not llm_client.enabled:
        return fallback

    template = _load_prompt("inbox_analyze_prompt.md")
    if not template:
        return fallback

    prompt = _apply_prompt_template(
        template,
        goal=(goal or "").strip() or "Respond helpfully as Kafi Commodities sales.",
        mailbox_email=mailbox_email or "",
        mailbox_display_name=mailbox_display,
        thread_context=_format_thread_context(thread),
    )
    system = (
        "You are a concise sales email assistant for Kafi Commodities. "
        "Return only valid JSON with keys summary, draft_reply, suggested_subject, to."
    )
    try:
        data = llm_client.generate_json(prompt, system=system)
    except Exception:  # noqa: BLE001
        return fallback

    summary = str(data.get("summary") or "").strip() or fallback["summary"]
    draft = str(data.get("draft_reply") or data.get("draft") or "").strip() or fallback["draft_reply"]
    subject = str(data.get("suggested_subject") or "").strip() or fallback["suggested_subject"]
    to_addr = str(data.get("to") or "").strip() or fallback["to"]

    return {
        "summary": summary,
        "draft_reply": draft,
        "suggested_subject": subject,
        "to": to_addr,
        "source": "llm",
    }


def analyze_inbox_thread(thread_id: str, *, goal: str | None = None) -> dict[str, Any] | None:
    thread = inbox_module.get_thread(thread_id, mark_seen=False)
    if not thread:
        return None
    return analyze_thread(thread, goal=goal)


def analyze_inbox_message(
    uid: str,
    *,
    folder: str = "INBOX",
    goal: str | None = None,
) -> dict[str, Any] | None:
    message = inbox_module.get_message(uid, folder=folder)
    if not message:
        return None
    thread = _format_single_message_context(message)
    return analyze_thread(thread, goal=goal)
