"""Outlook shared-inbox client — IMAP receive + Microsoft Graph send.

Personal @outlook.com mailboxes often have SMTP AUTH disabled (5.7.139),
so outbound mail uses Graph Mail.Send instead of smtp.office365.com.
"""

from __future__ import annotations

import base64
import re
from datetime import datetime
from typing import Any

import httpx

from config import settings
from modules.inbox_cutoff import get_inbox_since, message_is_after_cutoff

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")

# Separate audiences — MSAL refreshes one resource at a time.
IMAP_SCOPES = [
    "https://outlook.office.com/IMAP.AccessAsUser.All",
]
GRAPH_SEND_SCOPES = [
    "https://graph.microsoft.com/Mail.Send",
]

# Kept for scripts / docs that import a combined list.
MAILBOX_SCOPES = IMAP_SCOPES + GRAPH_SEND_SCOPES

_SENT_FOLDER_CANDIDATES = (
    "Sent",
    "Sent Items",
    "Sent Messages",
    "INBOX.Sent",
    "INBOX/Sent",
)


def _html_to_preview(html: str) -> str:
    text = _HTML_TAG_RE.sub(" ", html or "")
    return _WS_RE.sub(" ", text).strip()


def _xoauth2_bytes(email: str, access_token: str) -> bytes:
    return f"user={email}\x01auth=Bearer {access_token}\x01\x01".encode()


def _password_auth_help() -> str:
    return "Outlook mailbox login failed. Check MAILBOX_EMAIL and credentials in backend/.env."


class OutlookClient:
    @property
    def is_configured(self) -> bool:
        if not settings.mailbox_enabled or not settings.mailbox_email:
            return False
        if self._use_oauth():
            return True
        return bool(settings.mailbox_password)

    def _use_oauth(self) -> bool:
        return bool(
            settings.mailbox_client_id
            and settings.mailbox_refresh_token
        )

    def _authority(self) -> str:
        tenant = (settings.mailbox_tenant_id or "consumers").strip()
        return f"https://login.microsoftonline.com/{tenant}"

    def _msal_app(self):
        try:
            from msal import ConfidentialClientApplication, PublicClientApplication
        except ImportError as exc:
            raise RuntimeError("Install msal: pip install msal") from exc

        authority = self._authority()
        if settings.mailbox_client_secret:
            return ConfidentialClientApplication(
                settings.mailbox_client_id,
                client_credential=settings.mailbox_client_secret,
                authority=authority,
            )
        return PublicClientApplication(settings.mailbox_client_id, authority=authority)

    def _acquire_access_token(self, scopes: list[str] | None = None) -> str:
        if not self._use_oauth():
            raise RuntimeError("Mailbox authentication is not configured")

        scopes = scopes or IMAP_SCOPES
        app = self._msal_app()
        result = app.acquire_token_by_refresh_token(
            settings.mailbox_refresh_token,
            scopes=scopes,
        )
        if not result or "access_token" not in result:
            detail = (result or {}).get("error_description") or (result or {}).get("error")
            raise RuntimeError(detail or "Mailbox token refresh failed")
        return result["access_token"]

    def _connect_imap(self):
        import imaplib

        from imap_tools import MailBox

        host = settings.mailbox_imap_host
        port = settings.mailbox_imap_port
        client = imaplib.IMAP4_SSL(host, port)

        if self._use_oauth():
            token = self._acquire_access_token(IMAP_SCOPES)
            client.authenticate(
                "XOAUTH2",
                lambda _challenge: _xoauth2_bytes(settings.mailbox_email, token),
            )
        else:
            if not settings.mailbox_password:
                raise RuntimeError("Mailbox password is not configured")
            try:
                login_result = client.login(settings.mailbox_email, settings.mailbox_password)
            except Exception as exc:
                raise RuntimeError(_password_auth_help()) from exc
            if login_result[0] != "OK":
                raise RuntimeError(_password_auth_help())

        mailbox = MailBox(host, port)
        mailbox.client = client
        mailbox.folder.set("INBOX")
        return mailbox

    def _mailbox(self, folder: str = "INBOX"):
        if not self.is_configured:
            raise RuntimeError(
                "Mailbox is not enabled. Set MAILBOX_ENABLED=true and MAILBOX_EMAIL in backend/.env"
            )
        mailbox = self._connect_imap()
        if folder and folder != "INBOX":
            mailbox.folder.set(folder)
        return mailbox

    def _resolve_sent_folder(self, mailbox) -> str | None:
        try:
            names = {f.name for f in mailbox.folder.list()}
        except Exception:  # noqa: BLE001
            names = set()
        for candidate in _SENT_FOLDER_CANDIDATES:
            if candidate in names:
                return candidate
        # Case-insensitive fallback
        lower_map = {n.lower(): n for n in names}
        for candidate in _SENT_FOLDER_CANDIDATES:
            if candidate.lower() in lower_map:
                return lower_map[candidate.lower()]
        return None

    def _header(self, msg, *names: str) -> str | None:
        obj = msg.obj
        for name in names:
            value = obj.get(name)
            if value:
                return str(value)
        return None

    def _direction(self, from_email: str | None, folder: str) -> str:
        mailbox_email = (settings.mailbox_email or "").strip().lower()
        if folder.lower().startswith("sent"):
            return "outbound"
        if from_email and mailbox_email and from_email.strip().lower() == mailbox_email:
            return "outbound"
        return "inbound"

    def _summarize(self, msg, *, folder: str = "INBOX") -> dict[str, Any]:
        preview = (msg.text or "").strip()
        if not preview and msg.html:
            preview = _html_to_preview(msg.html)
        from_name = msg.from_values.name if msg.from_values else ""
        from_email = msg.from_
        to_addrs = [addr.email for addr in (msg.to_values or []) if addr.email]
        cc_addrs = [addr.email for addr in (msg.cc_values or []) if addr.email]
        return {
            "uid": str(msg.uid),
            "folder": folder,
            "subject": msg.subject or "(no subject)",
            "from_email": from_email,
            "from_name": from_name or None,
            "to": to_addrs,
            "cc": cc_addrs,
            "date": msg.date,
            "preview": preview[:240],
            "unread": "\\Seen" not in msg.flags,
            "has_attachments": bool(msg.attachments),
            "message_id": self._header(msg, "Message-ID", "Message-Id"),
            "in_reply_to": self._header(msg, "In-Reply-To"),
            "references": self._header(msg, "References"),
            "direction": self._direction(from_email, folder),
        }

    def _detail_from_msg(self, msg, *, folder: str = "INBOX") -> dict[str, Any]:
        data = self._summarize(msg, folder=folder)
        data.update(
            {
                "body_text": msg.text or None,
                "body_html": msg.html or None,
                "attachments": [
                    {"filename": att.filename, "size": att.size, "content_type": att.content_type}
                    for att in msg.attachments
                ],
            }
        )
        return data

    def _fetch_folder(
        self,
        mailbox,
        folder: str,
        *,
        limit: int,
        unread_only: bool = False,
        since_date=None,
    ) -> list[dict[str, Any]]:
        from imap_tools import AND

        from modules.inbox_cutoff import has_active_cutoff

        try:
            mailbox.folder.set(folder)
        except Exception:  # noqa: BLE001
            return []

        if since_date is None and has_active_cutoff():
            since_date = get_inbox_since().date()

        if unread_only and since_date is not None:
            criteria = AND(date_gte=since_date, seen=False)
        elif unread_only:
            criteria = AND(seen=False)
        elif since_date is not None:
            criteria = AND(date_gte=since_date)
        else:
            criteria = AND(all=True)

        try:
            messages = list(
                mailbox.fetch(
                    criteria,
                    limit=max(limit, 50),
                    reverse=True,
                    mark_seen=False,
                    bulk=True,
                )
            )
        except Exception:  # noqa: BLE001
            # Some servers reject ALL; fall back to a wide date window.
            try:
                messages = list(
                    mailbox.fetch(
                        AND(date_gte=datetime(2000, 1, 1).date())
                        if not unread_only
                        else AND(date_gte=datetime(2000, 1, 1).date(), seen=False),
                        limit=max(limit, 50),
                        reverse=True,
                        mark_seen=False,
                        bulk=True,
                    )
                )
            except Exception:  # noqa: BLE001
                return []
        return [self._summarize(m, folder=folder) for m in messages]

    def list_messages(self, *, limit: int = 25, unread_only: bool = False) -> list[dict[str, Any]]:
        mailbox = self._mailbox("INBOX")
        try:
            summaries = self._fetch_folder(
                mailbox, "INBOX", limit=limit, unread_only=unread_only
            )
        finally:
            try:
                mailbox.logout()
            except Exception:  # noqa: BLE001
                pass
        filtered = [m for m in summaries if message_is_after_cutoff(m.get("date"))]
        return filtered[:limit]

    def list_conversation_messages(
        self, *, limit: int = 50, unread_only: bool = False
    ) -> list[dict[str, Any]]:
        """Inbox + Sent messages for conversation threading."""
        mailbox = self._mailbox("INBOX")
        try:
            per_folder = max(limit, 50)
            inbox = self._fetch_folder(
                mailbox, "INBOX", limit=per_folder, unread_only=unread_only
            )
            sent: list[dict[str, Any]] = []
            # Unread-only applies to inbox; still include sent for thread context.
            sent_folder = self._resolve_sent_folder(mailbox)
            if sent_folder:
                sent = self._fetch_folder(
                    mailbox, sent_folder, limit=per_folder, unread_only=False
                )
        finally:
            try:
                mailbox.logout()
            except Exception:  # noqa: BLE001
                pass

        combined = inbox + sent
        filtered = [m for m in combined if message_is_after_cutoff(m.get("date"))]
        # Dedupe by message-id when both copies exist.
        seen_ids: set[str] = set()
        unique: list[dict[str, Any]] = []
        for msg in sorted(filtered, key=lambda m: m.get("date") or "", reverse=True):
            mid = (msg.get("message_id") or "").strip().lower()
            if mid:
                if mid in seen_ids:
                    continue
                seen_ids.add(mid)
            unique.append(msg)
        return unique

    def get_message(self, uid: str, *, folder: str = "INBOX") -> dict[str, Any] | None:
        from imap_tools import AND

        mailbox = self._mailbox(folder)
        try:
            messages = list(mailbox.fetch(AND(uid=str(uid)), mark_seen=False, bulk=False))
        finally:
            try:
                mailbox.logout()
            except Exception:  # noqa: BLE001
                pass
        if not messages:
            return None
        return self._detail_from_msg(messages[0], folder=folder)

    def get_messages_by_keys(self, keys: list[str]) -> list[dict[str, Any]]:
        """Fetch full message bodies for folder:uid keys in one IMAP session when possible."""
        from imap_tools import AND

        grouped: dict[str, list[str]] = {}
        for key in keys:
            if ":" not in key:
                grouped.setdefault("INBOX", []).append(key)
                continue
            folder, uid = key.split(":", 1)
            grouped.setdefault(folder, []).append(uid)

        out: list[dict[str, Any]] = []
        mailbox = self._mailbox("INBOX")
        try:
            for folder, uids in grouped.items():
                try:
                    mailbox.folder.set(folder)
                except Exception:  # noqa: BLE001
                    continue
                for uid in uids:
                    try:
                        messages = list(
                            mailbox.fetch(AND(uid=str(uid)), mark_seen=False, bulk=False)
                        )
                    except Exception:  # noqa: BLE001
                        continue
                    if messages:
                        out.append(self._detail_from_msg(messages[0], folder=folder))
        finally:
            try:
                mailbox.logout()
            except Exception:  # noqa: BLE001
                pass
        out.sort(key=lambda m: m.get("date") or "")
        return out

    def unread_count(self) -> int:
        return sum(1 for m in self.list_messages(limit=100, unread_only=True) if m.get("unread"))

    def mark_read(self, uid: str, seen: bool = True, *, folder: str = "INBOX") -> None:
        from imap_tools import MailMessageFlags

        mailbox = self._mailbox(folder)
        try:
            mailbox.flag(str(uid), MailMessageFlags.SEEN, seen)
        finally:
            try:
                mailbox.logout()
            except Exception:  # noqa: BLE001
                pass

    def _graph_file_attachments(self, attachments: list[dict]) -> list[dict[str, Any]] | dict[str, Any]:
        """Build Graph fileAttachment payloads, or return an error dict."""
        from modules.email_attachments import load_bytes

        out: list[dict[str, Any]] = []
        for meta in attachments:
            try:
                data, filename, content_type = load_bytes(meta)
            except FileNotFoundError as exc:
                return {"status": "error", "message": str(exc)}
            out.append(
                {
                    "@odata.type": "#microsoft.graph.fileAttachment",
                    "name": filename,
                    "contentType": content_type,
                    "contentBytes": base64.b64encode(data).decode("ascii"),
                }
            )
        return out

    def send_reply(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        in_reply_to: str | None = None,
        references: str | None = None,
        cc: str | None = None,
        attachments: list[dict] | None = None,
    ) -> dict[str, Any]:
        if not self.is_configured:
            return {
                "status": "not_configured",
                "message": "Mailbox is not enabled. Set MAILBOX_ENABLED=true in backend/.env",
            }
        if not to:
            return {"status": "error", "message": "Recipient email is missing"}
        if not self._use_oauth():
            return {
                "status": "error",
                "message": (
                    "Outlook SMTP is disabled for this mailbox. "
                    "Set MAILBOX_CLIENT_ID and MAILBOX_REFRESH_TOKEN (Graph Mail.Send) in backend/.env."
                ),
            }

        att_list = attachments or []
        graph_attachments: list[dict[str, Any]] = []
        if att_list:
            built = self._graph_file_attachments(att_list)
            if isinstance(built, dict):
                return built
            graph_attachments = built

        message: dict[str, Any] = {
            "subject": subject,
            "body": {"contentType": "Text", "content": body},
            "toRecipients": [{"emailAddress": {"address": to}}],
        }
        if settings.mailbox_display_name:
            message["from"] = {
                "emailAddress": {
                    "address": settings.mailbox_email,
                    "name": settings.mailbox_display_name,
                }
            }
        if cc:
            message["ccRecipients"] = [{"emailAddress": {"address": cc}}]
        if graph_attachments:
            message["attachments"] = graph_attachments
        # Graph rejects non-x- custom internetMessageHeaders (In-Reply-To/References).
        # Threading is preserved via Re: subject + quoted body from the inbox module.
        _ = (in_reply_to, references)

        payload = {"message": message, "saveToSentItems": True}

        try:
            token = self._acquire_access_token(GRAPH_SEND_SCOPES)
            response = httpx.post(
                "https://graph.microsoft.com/v1.0/me/sendMail",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=60.0,
            )
        except Exception as exc:  # noqa: BLE001
            return {"status": "error", "message": f"Reply send failed: {exc}"}

        if response.status_code in (202, 200):
            return {"status": "sent", "message": "Reply sent", "to": to, "subject": subject}

        detail = response.text
        try:
            err = response.json().get("error") or {}
            detail = err.get("message") or detail
        except Exception:  # noqa: BLE001
            pass
        return {
            "status": "error",
            "message": f"Reply send failed: Graph {response.status_code}: {detail}",
        }

    def send_approved(
        self,
        *,
        to: str,
        subject: str,
        body: str,
        attachments: list[dict] | None = None,
    ) -> dict[str, Any]:
        """Send an approved outbound email (quotations, outreach, bulk campaigns)."""
        return self.send_reply(to=to, subject=subject, body=body, attachments=attachments)


outlook_client = OutlookClient()
