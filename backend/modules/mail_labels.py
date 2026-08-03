"""App-level mail labels (Gmail-style) keyed to IMAP message UIDs / threads."""

from __future__ import annotations

import re
from urllib.parse import urlparse

from sqlalchemy.orm import Session

from db.models import MailLabel, MailLabelAssignment


def _norm_subject(subject: str | None) -> str | None:
    if not subject:
        return None
    cleaned = re.sub(r"^(re|fw|fwd)\s*:\s*", "", subject.strip(), flags=re.I)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().lower()
    return cleaned[:255] or None


def normalize_match_query(raw: str | None) -> str | None:
    """Turn a site name, domain, keyword, or URL into a lowercase match token."""
    if not raw:
        return None
    text = raw.strip().lower()
    if not text:
        return None
    # Multi-word label/name → first meaningful word (e.g. "LinkedIn ads" → linkedin)
    if " " in text and "://" not in text and "/" not in text:
        for part in re.split(r"[\s/_-]+", text):
            part = part.strip().removeprefix("www.")
            if len(part) >= 3:
                return part[:255]
        return None
    if "://" not in text and "/" not in text and " " not in text:
        # Plain domain or keyword (amazon.com / amazon / linkedin)
        text = text.removeprefix("www.")
        return text[:255] or None
    # URL or path-like input
    candidate = text if "://" in text else f"https://{text}"
    try:
        parsed = urlparse(candidate)
        host = (parsed.hostname or "").lower().removeprefix("www.")
        if host:
            return host[:255]
    except Exception:
        pass
    cleaned = re.sub(r"^https?://", "", text)
    cleaned = cleaned.split("/")[0].split("?")[0].removeprefix("www.")
    cleaned = cleaned.strip()
    return cleaned[:255] or None


def match_tokens_for_label(name: str | None, match_query: str | None) -> list[str]:
    """
    Tokens used to auto-route mail into a label.

    Prefer match_query; fall back to the label name. Domains like linkedin.com
    also include the base keyword (linkedin) so subject/body mentions match.
    """
    tokens: list[str] = []
    primary = normalize_match_query(match_query) or normalize_match_query(name)
    if primary:
        tokens.append(primary)
        if "." in primary:
            base = primary.split(".", 1)[0].strip()
            if len(base) >= 3 and base not in tokens:
                tokens.append(base)
    if name:
        for part in re.split(r"[\s/_-]+", name.strip().lower()):
            part = part.strip().removeprefix("www.")
            if len(part) >= 3 and part not in tokens and "." not in part:
                tokens.append(part)
    return tokens


def ensure_label_match_query(label: MailLabel) -> bool:
    """Backfill match_query from name when missing. Returns True if updated."""
    if (label.match_query or "").strip():
        return False
    derived = normalize_match_query(label.name)
    if not derived:
        return False
    label.match_query = derived
    return True


def list_labels(db: Session, user_id: int) -> list[MailLabel]:
    rows = (
        db.query(MailLabel)
        .filter(MailLabel.user_id == user_id)
        .order_by(MailLabel.name.asc())
        .all()
    )
    dirty = False
    for row in rows:
        if ensure_label_match_query(row):
            dirty = True
    if dirty:
        db.commit()
        for row in rows:
            db.refresh(row)
    return rows


def create_label(
    db: Session,
    user_id: int,
    *,
    name: str,
    color: str = "#34d399",
    match_query: str | None = None,
) -> MailLabel:
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError("Label name is required")
    if len(cleaned) > 100:
        raise ValueError("Label name is too long")
    existing = (
        db.query(MailLabel)
        .filter(MailLabel.user_id == user_id, MailLabel.name == cleaned)
        .first()
    )
    if existing:
        raise ValueError("A label with that name already exists")
    # Domain/keyword if provided; otherwise use the label name (e.g. LinkedIn → linkedin).
    normalized = normalize_match_query(match_query) or normalize_match_query(cleaned)
    label = MailLabel(
        user_id=user_id,
        name=cleaned,
        color=(color or "#34d399").strip() or "#34d399",
        match_query=normalized,
    )
    db.add(label)
    db.commit()
    db.refresh(label)
    return label


def delete_label(db: Session, user_id: int, label_id: int) -> bool:
    label = db.query(MailLabel).filter(MailLabel.id == label_id, MailLabel.user_id == user_id).first()
    if not label:
        return False
    db.delete(label)
    db.commit()
    return True


def assign_label(
    db: Session,
    user_id: int,
    *,
    label_id: int,
    folder: str,
    message_uid: str,
    message_id: str | None = None,
    thread_id: str | None = None,
    from_email: str | None = None,
    subject: str | None = None,
    apply_similar: bool = False,
) -> dict:
    label = db.query(MailLabel).filter(MailLabel.id == label_id, MailLabel.user_id == user_id).first()
    if not label:
        raise ValueError("Label not found")

    folder_key = (folder or "inbox").strip().lower() or "inbox"
    uid = (message_uid or "").strip()
    if not uid:
        raise ValueError("message_uid is required")

    subject_key = _norm_subject(subject)
    from_norm = (from_email or "").strip().lower() or None

    def _upsert(
        *,
        message_uid: str,
        message_id: str | None,
        thread_id: str | None,
        from_email: str | None,
        subject_key: str | None,
    ) -> bool:
        row = (
            db.query(MailLabelAssignment)
            .filter(
                MailLabelAssignment.user_id == user_id,
                MailLabelAssignment.label_id == label_id,
                MailLabelAssignment.folder == folder_key,
                MailLabelAssignment.message_uid == message_uid,
            )
            .first()
        )
        if row:
            return False
        db.add(
            MailLabelAssignment(
                label_id=label_id,
                user_id=user_id,
                folder=folder_key,
                message_uid=message_uid,
                message_id=message_id,
                thread_id=thread_id,
                from_email=from_email,
                subject_key=subject_key,
            )
        )
        return True

    created = 0
    if _upsert(
        message_uid=uid,
        message_id=message_id,
        thread_id=thread_id,
        from_email=from_norm,
        subject_key=subject_key,
    ):
        created += 1

    similar = 0
    if apply_similar and (subject_key or from_norm):
        similar = 1 if (subject_key or from_norm) else 0

    db.commit()
    return {"assigned": created, "similar_rule": similar, "label_id": label_id}


def unassign_label(
    db: Session,
    user_id: int,
    *,
    label_id: int,
    folder: str,
    message_uid: str,
) -> bool:
    folder_key = (folder or "inbox").strip().lower() or "inbox"
    row = (
        db.query(MailLabelAssignment)
        .filter(
            MailLabelAssignment.user_id == user_id,
            MailLabelAssignment.label_id == label_id,
            MailLabelAssignment.folder == folder_key,
            MailLabelAssignment.message_uid == message_uid,
        )
        .first()
    )
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True


def labels_for_messages(
    db: Session,
    user_id: int,
    *,
    folder: str,
    message_uids: list[str],
) -> dict[str, list[dict]]:
    if not message_uids:
        return {}
    folder_key = (folder or "inbox").strip().lower() or "inbox"
    rows = (
        db.query(MailLabelAssignment, MailLabel)
        .join(MailLabel, MailLabel.id == MailLabelAssignment.label_id)
        .filter(
            MailLabelAssignment.user_id == user_id,
            MailLabelAssignment.folder == folder_key,
            MailLabelAssignment.message_uid.in_(message_uids),
        )
        .all()
    )
    out: dict[str, list[dict]] = {}
    for assignment, label in rows:
        out.setdefault(assignment.message_uid, []).append(
            {
                "id": label.id,
                "name": label.name,
                "color": label.color,
                "match_query": label.match_query,
            }
        )
    return out


def message_keys_for_label(db: Session, user_id: int, label_id: int) -> list[dict]:
    label = db.query(MailLabel).filter(MailLabel.id == label_id, MailLabel.user_id == user_id).first()
    if not label:
        raise ValueError("Label not found")
    rows = (
        db.query(MailLabelAssignment)
        .filter(MailLabelAssignment.user_id == user_id, MailLabelAssignment.label_id == label_id)
        .all()
    )
    return [
        {
            "folder": r.folder,
            "message_uid": r.message_uid,
            "message_id": r.message_id,
            "thread_id": r.thread_id,
            "from_email": r.from_email,
            "subject_key": r.subject_key,
        }
        for r in rows
    ]


def label_counts(db: Session, user_id: int) -> dict[int, int]:
    from sqlalchemy import func as sa_func

    rows = (
        db.query(MailLabelAssignment.label_id, sa_func.count(MailLabelAssignment.id))
        .filter(MailLabelAssignment.user_id == user_id)
        .group_by(MailLabelAssignment.label_id)
        .all()
    )
    return {int(label_id): int(count) for label_id, count in rows}
