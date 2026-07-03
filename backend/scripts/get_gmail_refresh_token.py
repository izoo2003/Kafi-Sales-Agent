"""One-time Gmail OAuth setup — prints a refresh token for backend/.env.

Prerequisites (Google Cloud Console):
  1. Enable Gmail API for your project.
  2. OAuth consent screen configured; add your sending Gmail as a test user.
  3. Create OAuth client ID → Application type: **Desktop app**.
  4. Download JSON → save as backend/credentials.json (do not commit).

Run from backend/:
  python scripts/get_gmail_refresh_token.py

Then add to backend/.env:
  GMAIL_CLIENT_ID=...
  GMAIL_CLIENT_SECRET=...
  GMAIL_REFRESH_TOKEN=...
  GMAIL_SENDER_EMAIL=your@gmail.com
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

SCOPES = ["https://www.googleapis.com/auth/gmail.send"]
BACKEND_DIR = Path(__file__).resolve().parents[1]
CREDENTIALS_FILE = BACKEND_DIR / "credentials.json"


def main() -> None:
    if not CREDENTIALS_FILE.is_file():
        print(f"Missing {CREDENTIALS_FILE}", file=sys.stderr)
        print(
            "Download OAuth client JSON (Desktop app) from Google Cloud Console "
            "and save it as backend/credentials.json",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("Install: pip install google-auth-oauthlib", file=sys.stderr)
        sys.exit(1)

    with CREDENTIALS_FILE.open(encoding="utf-8") as fh:
        client_config = json.load(fh)

    # Google sometimes exports "web" or "installed" wrapper keys.
    installed = client_config.get("installed") or client_config.get("web")
    if not installed:
        print("credentials.json must contain 'installed' or 'web' client config.", file=sys.stderr)
        sys.exit(1)

    flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
    creds = flow.run_local_server(port=0, prompt="consent")

    if not creds.refresh_token:
        print(
            "No refresh token returned. Revoke access at "
            "https://myaccount.google.com/permissions and run again.",
            file=sys.stderr,
        )
        sys.exit(1)

    client_id = installed.get("client_id", "")
    client_secret = installed.get("client_secret", "")

    print("\nAdd these lines to backend/.env:\n")
    print(f"GMAIL_CLIENT_ID={client_id}")
    print(f"GMAIL_CLIENT_SECRET={client_secret}")
    print(f"GMAIL_REFRESH_TOKEN={creds.refresh_token}")
    print("GMAIL_SENDER_EMAIL=your-sending-address@gmail.com")
    print("\nReplace GMAIL_SENDER_EMAIL with the Google account you signed in with.")


if __name__ == "__main__":
    main()
