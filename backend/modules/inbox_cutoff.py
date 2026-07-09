"""Persist the inbox start moment — only messages at/after this time are shown."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

from config import settings

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_CUTOFF_FILE = _BACKEND_DIR / "storage" / "inbox_cutoff.json"


def _parse_datetime(value: str) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        if "T" in text:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        else:
            parsed = datetime.combine(date.fromisoformat(text[:10]), datetime.min.time())
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def _read_file_cutoff() -> datetime | None:
    if not _CUTOFF_FILE.is_file():
        return None
    try:
        data = json.loads(_CUTOFF_FILE.read_text(encoding="utf-8"))
        return _parse_datetime(str(data.get("since", "")))
    except (OSError, json.JSONDecodeError, TypeError):
        return None


def _write_file_cutoff(value: datetime) -> None:
    _CUTOFF_FILE.parent.mkdir(parents=True, exist_ok=True)
    _CUTOFF_FILE.write_text(
        json.dumps({"since": value.astimezone(timezone.utc).isoformat()}, indent=2) + "\n",
        encoding="utf-8",
    )


def get_inbox_since(*, initialize: bool = True) -> datetime:
    """Return the earliest message time to include. Auto-initializes to now if unset."""
    env_value = _parse_datetime(
        settings.inbox_since or settings.gmail_inbox_since or ""
    )
    if env_value:
        return env_value

    stored = _read_file_cutoff()
    if stored:
        return stored

    now = datetime.now(timezone.utc)
    if initialize:
        _write_file_cutoff(now)
    return now


def set_inbox_since_to_now() -> datetime:
    """Ignore all mail before right now."""
    now = datetime.now(timezone.utc)
    _write_file_cutoff(now)
    return now


def gmail_after_query(since: datetime | None = None) -> str:
    """Gmail search fragment — date granularity only (e.g. after:2026/07/08)."""
    moment = (since or get_inbox_since()).astimezone(timezone.utc)
    return f"after:{moment.year}/{moment.month:02d}/{moment.day:02d}"


def message_is_after_cutoff(message_date: datetime | None) -> bool:
    if message_date is None:
        return True
    cutoff = get_inbox_since()
    msg = message_date
    if msg.tzinfo is None:
        msg = msg.replace(tzinfo=timezone.utc)
    return msg.astimezone(timezone.utc) >= cutoff
