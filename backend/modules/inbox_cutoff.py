"""Optional inbox start moment — only applied when explicitly set."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

from config import settings

_BACKEND_DIR = Path(__file__).resolve().parents[1]
_CUTOFF_FILE = _BACKEND_DIR / "storage" / "inbox_cutoff.json"
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


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


def clear_inbox_cutoff() -> None:
    """Remove the optional cutoff so all mailbox mail is eligible again."""
    try:
        if _CUTOFF_FILE.is_file():
            _CUTOFF_FILE.unlink()
    except OSError:
        pass


def has_active_cutoff() -> bool:
    return bool(
        _parse_datetime(settings.inbox_since or settings.gmail_inbox_since or "")
        or _read_file_cutoff()
    )


def get_inbox_since(*, initialize: bool = False) -> datetime:
    """Earliest message time to include.

    Unlike before, this does NOT auto-create a "now" cutoff on first use —
    that hid all existing mail. With no cutoff configured, returns epoch (show all).
    """
    env_value = _parse_datetime(settings.inbox_since or settings.gmail_inbox_since or "")
    if env_value:
        return env_value

    stored = _read_file_cutoff()
    if stored:
        return stored

    if initialize:
        # Kept for callers that still pass initialize=True; still do not hide mail.
        return _EPOCH
    return _EPOCH


def set_inbox_since_to_now() -> datetime:
    """Ignore all mail before right now (explicit user action)."""
    now = datetime.now(timezone.utc)
    _write_file_cutoff(now)
    return now


def gmail_after_query(since: datetime | None = None) -> str:
    """Gmail search fragment — date granularity only (e.g. after:2026/07/08)."""
    moment = (since or get_inbox_since()).astimezone(timezone.utc)
    return f"after:{moment.year}/{moment.month:02d}/{moment.day:02d}"


def as_utc(value: datetime | None) -> datetime | None:
    """Normalize message/cutoff datetimes so naive and aware values can be compared."""
    if value is None:
        return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def date_sort_key(value: object) -> datetime:
    """Stable UTC key for sorting mixed/missing message dates."""
    if isinstance(value, datetime):
        return as_utc(value) or _EPOCH
    return _EPOCH


def message_is_after_cutoff(message_date: datetime | None) -> bool:
    if not has_active_cutoff():
        return True
    msg = as_utc(message_date)
    if msg is None:
        return True
    cutoff = as_utc(get_inbox_since()) or _EPOCH
    return msg >= cutoff
