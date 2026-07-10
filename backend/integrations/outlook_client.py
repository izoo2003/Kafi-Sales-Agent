"""Outlook shared-inbox client — IMAP receive + SMTP send.

Supports OAuth2 (recommended for Outlook.com) or legacy password auth.
"""

from __future__ import annotations

import base64
import re
import smtplib
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Any

from config import settings
from modules.inbox_cutoff import get_inbox_since, message_is_after_cutoff

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")

MAILBOX_SCOPES = [
    "https://outlook.office.com/IMAP.AccessAsUser.All",
    "https://outlook.office.com/SMTP.Send",
    "offline_access",
]


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

    def _acquire_access_token(self) -> str:
        if not self._use_oauth():
            raise RuntimeError("Mailbox authentication is not configured")

        try:
            from msal import ConfidentialClientApplication, PublicClientApplication
        except ImportError as exc:
            raise RuntimeError("Install msal: pip install msal") from exc

        authority = self._authority()
        if settings.mailbox_client_secret:
            app = ConfidentialClientApplication(
                settings.mailbox_client_id,
                client_credential=settings.mailbox_client_secret,
                authority=authority,
            )
        else:
            app = PublicClientApplication(settings.mailbox_client_id, authority=authority)

        result = app.acquire_token_by_refresh_token(
            settings.mailbox_refresh_token,
            scopes=MAILBOX_SCOPES,
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
            token = self._acquire_access_token()
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

    def _mailbox(self):
        if not self.is_configured:
            raise RuntimeError(
                "Mailbox is not enabled. Set MAILBOX_ENABLED=true and MAILBOX_EMAIL in backend/.env"
            )
        return self._connect_imap()

    @staticmethod
    def _summarize(msg) -> dict[str, Any]:
        preview = (msg.text or "").strip()
        if not preview and msg.html:
            preview = _html_to_preview(msg.html)
        from_name = msg.from_values.name if msg.from_values else ""
        return {
            "uid": msg.uid,
            "subject": msg.subject or "(no subject)",
            "from_email": msg.from_,
            "from_name": from_name or None,
            "date": msg.date,
            "preview": preview[:240],
            "unread": "\\Seen" not in msg.flags,
            "has_attachments": bool(msg.attachments),
            "message_id": msg.obj.get("Message-ID"),
        }

    def list_messages(self, *, limit: int = 25, unread_only: bool = False) -> list[dict[str, Any]]:
        from imap_tools import AND

        since = get_inbox_since().date()
        criteria = AND(date_gte=since, seen=False) if unread_only else AND(date_gte=since)
        mailbox = self._mailbox()
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
        finally:
            try:
                mailbox.logout()
            except Exception:  # noqa: BLE001
                pass
        summaries = [self._summarize(m) for m in messages]
        filtered = [m for m in summaries if message_is_after_cutoff(m.get("date"))]
        return filtered[:limit]

    def get_message(self, uid: str) -> dict[str, Any] | None:
        from imap_tools import AND

        mailbox = self._mailbox()
        try:
            messages = list(mailbox.fetch(AND(uid=str(uid)), mark_seen=False, bulk=False))
        finally:
            try:
                mailbox.logout()
            except Exception:  # noqa: BLE001
                pass
        if not messages:
            return None
        msg = messages[0]
        data = self._summarize(msg)
        data.update(
            {
                "to": [addr.email for addr in (msg.to_values or [])],
                "cc": [addr.email for addr in (msg.cc_values or [])],
                "body_text": msg.text or None,
                "body_html": msg.html or None,
                "attachments": [
                    {"filename": att.filename, "size": att.size, "content_type": att.content_type}
                    for att in msg.attachments
                ],
            }
        )
        return data

    def unread_count(self) -> int:
        return sum(1 for m in self.list_messages(limit=100, unread_only=True) if m.get("unread"))

    def mark_read(self, uid: str, seen: bool = True) -> None:
        from imap_tools import MailMessageFlags

        mailbox = self._mailbox()
        try:
            mailbox.flag(str(uid), MailMessageFlags.SEEN, seen)
        finally:
            try:
                mailbox.logout()
            except Exception:  # noqa: BLE001
                pass

    def _smtp_login(self, server: smtplib.SMTP) -> None:
        if self._use_oauth():
            token = self._acquire_access_token()
            auth_b64 = base64.b64encode(
                _xoauth2_bytes(settings.mailbox_email, token)
            ).decode()
            code, resp = server.docmd("AUTH", "XOAUTH2 " + auth_b64)
            if code != 235:
                detail = resp.decode() if isinstance(resp, bytes) else str(resp)
                raise RuntimeError(f"SMTP login failed: {detail}")
            return
        if not settings.mailbox_password:
            raise RuntimeError("Mailbox password is not configured")
        server.login(settings.mailbox_email, settings.mailbox_password)

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

        from modules.email_attachments import load_bytes

        att_list = attachments or []
        if att_list:
            message = MIMEMultipart()
            message.attach(MIMEText(body, "plain", "utf-8"))
            for meta in att_list:
                try:
                    data, filename, content_type = load_bytes(meta)
                except FileNotFoundError as exc:
                    return {"status": "error", "message": str(exc)}
                part = MIMEBase(*content_type.split("/", 1))
                part.set_payload(data)
                encoders.encode_base64(part)
                part.add_header("Content-Disposition", "attachment", filename=filename)
                message.attach(part)
        else:
            message = MIMEText(body, "plain", "utf-8")

        display = settings.mailbox_display_name
        message["From"] = formataddr((display, settings.mailbox_email)) if display else settings.mailbox_email
        message["To"] = to
        message["Subject"] = subject
        if cc:
            message["Cc"] = cc
        if in_reply_to:
            message["In-Reply-To"] = in_reply_to
            message["References"] = references or in_reply_to

        recipients = [to] + ([cc] if cc else [])
        try:
            with smtplib.SMTP(settings.mailbox_smtp_host, settings.mailbox_smtp_port, timeout=60) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                self._smtp_login(server)
                server.sendmail(settings.mailbox_email, recipients, message.as_string())
        except Exception as exc:  # noqa: BLE001
            return {"status": "error", "message": f"Reply send failed: {exc}"}

        return {"status": "sent", "message": "Reply sent", "to": to, "subject": subject}

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
