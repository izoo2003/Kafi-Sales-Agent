"""One-time Outlook OAuth setup — prints a refresh token for backend/.env.

Microsoft blocks password login for most Outlook.com accounts. Use OAuth instead.

Prerequisites (Azure Portal — free):
  1. https://portal.azure.com → App registrations → New registration
  2. Name: Kafi Sales Agent Inbox
  3. Supported accounts: "Personal Microsoft accounts only" (or both)
  4. Redirect URI: Mobile/desktop → http://localhost
  5. Copy Application (client) ID
  6. Certificates & secrets → New client secret (optional but recommended)
  7. API permissions → Add → APIs my organization uses → search "Office 365 Exchange Online"
     → Delegated → IMAP.AccessAsUser.All + SMTP.Send → Grant admin consent if shown

Run from backend/:
  python scripts/get_outlook_refresh_token.py

Then add printed values to backend/.env and restart python run.py
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

SCOPES = [
    "https://outlook.office.com/IMAP.AccessAsUser.All",
    "https://outlook.office.com/SMTP.Send",
    "offline_access",
]


def main() -> None:
    try:
        from msal import ConfidentialClientApplication, PublicClientApplication
    except ImportError:
        print("Install: pip install msal", file=sys.stderr)
        sys.exit(1)

    print("Outlook Inbox OAuth setup")
    print("=" * 50)
    print(
        "IMPORTANT: Your Azure app must be registered as\n"
        "  'Personal Microsoft accounts only'\n"
        "  OR 'Multitenant + personal Microsoft accounts'\n"
        "NOT 'Single tenant / My organization only' — that causes the\n"
        "'account does not exist in tenant' error for @outlook.com accounts.\n"
    )
    print(
        "Sign in to portal.azure.com with the SAME @outlook.com account\n"
        "you want in the inbox (or create the app under that account).\n"
    )
    client_id = input("Application (client) ID from Azure: ").strip()
    if not client_id:
        print("Client ID is required.", file=sys.stderr)
        sys.exit(1)

    client_secret = input("Client secret (leave blank for public/desktop app only): ").strip()
    tenant = input("Tenant [consumers for personal Outlook]: ").strip() or "consumers"
    authority = f"https://login.microsoftonline.com/{tenant}"

    if client_secret:
        app = ConfidentialClientApplication(
            client_id,
            client_credential=client_secret,
            authority=authority,
        )
    else:
        app = PublicClientApplication(client_id, authority=authority)

    print("\nOpening browser to sign in with your Outlook mailbox account…")
    result = app.acquire_token_interactive(
        scopes=SCOPES,
        prompt="consent",
    )

    if "access_token" not in result:
        print("Auth failed:", result.get("error_description") or result, file=sys.stderr)
        sys.exit(1)

    refresh = result.get("refresh_token")
    if not refresh:
        print(
            "No refresh token returned. Try again or revoke the app at "
            "https://account.microsoft.com/privacy/app-access",
            file=sys.stderr,
        )
        sys.exit(1)

    email = input("\nMailbox email address (e.g. you@outlook.com): ").strip()

    print("\nAdd these lines to backend/.env:\n")
    print(f"MAILBOX_EMAIL={email}")
    print(f"MAILBOX_CLIENT_ID={client_id}")
    if client_secret:
        print(f"MAILBOX_CLIENT_SECRET={client_secret}")
    print(f"MAILBOX_REFRESH_TOKEN={refresh}")
    print(f"MAILBOX_TENANT_ID={tenant}")
    print("MAILBOX_DISPLAY_NAME=Kafi Commodities Sales")
    print("\nYou can remove MAILBOX_PASSWORD — OAuth is used instead.")
    print("Restart the backend: python run.py")


if __name__ == "__main__":
    main()
