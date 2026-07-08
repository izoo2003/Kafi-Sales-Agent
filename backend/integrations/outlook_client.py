"""Outlook shared-inbox client — IMAP receive + SMTP send.

Supports OAuth2 (recommended for Outlook.com) or legacy password auth.
"""

from __future__ import annotations

import base64
import re
import smtplib
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Any

from config import settings

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


class OutlookClient:
    @property
    def is_configured(self) -> bool:
        if not settings.mailbox_email:
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
            raise RuntimeError("OAuth is not configured for this mailbox")

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
            raise RuntimeError(
                detail
                or "OAuth token refresh failed — re-run python scripts/get_outlook_refresh_token.py"
            )
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
            login_result = client.login(settings.mailbox_email, settings.mailbox_password)
            if login_result[0] != "OK":
                raise RuntimeError(login_result[1][0].decode() if login_result[1] else "IMAP login failed")

        mailbox = MailBox(host, port)
        mailbox.client = client
        mailbox.folder.set("INBOX")
        return mailbox

    def _mailbox(self):
        if not self.is_configured:
            raise RuntimeError(
                "Mailbox is not configured. Set MAILBOX_EMAIL plus either "
                "MAILBOX_REFRESH_TOKEN (OAuth) or MAILBOX_PASSWORD in backend/.env"
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

        criteria = AND(seen=False) if unread_only else "ALL"
        mailbox = self._mailbox()
        try:
            messages = list(
                mailbox.fetch(
                    criteria,
                    limit=limit,
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
        return [self._summarize(m) for m in messages]

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
        from imap_tools import AND

        mailbox = self._mailbox()
        try:
            return len(mailbox.numbers(AND(seen=False)))
        finally:
            try:
                mailbox.logout()
            except Exception:  # noqa: BLE001
                pass

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
                raise RuntimeError(f"SMTP OAuth failed: {detail}")
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
    ) -> dict[str, Any]:
        if not self.is_configured:
            return {
                "status": "not_configured",
                "message": "Mailbox is not configured in backend/.env",
            }
        if not to:
            return {"status": "error", "message": "Recipient email is missing"}

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
            with smtplib.SMTP(settings.mailbox_smtp_host, settings.mailbox_smtp_port, timeout=30) as server:
                server.ehlo()
                server.starttls()
                server.ehlo()
                self._smtp_login(server)
                server.sendmail(settings.mailbox_email, recipients, message.as_string())
        except Exception as exc:  # noqa: BLE001
            return {"status": "error", "message": f"Reply send failed: {exc}"}

        return {"status": "sent", "message": "Reply sent", "to": to, "subject": subject}


outlook_client = OutlookClient()
