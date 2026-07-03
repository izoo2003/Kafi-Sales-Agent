"""
Start the Kafi Sales Agent API.

Runs database migrations automatically, then starts the server with hot-reload in dev.

Usage (from backend/):
    python run.py

Or from repo root:
    python run.py
"""

import os
import sys
from pathlib import Path

# Ensure imports and relative paths work regardless of cwd
_BACKEND_DIR = Path(__file__).resolve().parent
os.chdir(_BACKEND_DIR)
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

import uvicorn
from sqlalchemy.exc import OperationalError

from config import settings
from db.migrate import run_migrations


def _redact_database_url(url: str) -> str:
    """Show host/db for debugging without printing credentials."""
    try:
        without_scheme = url.split("://", 1)[1]
        host_part = without_scheme.rsplit("@", 1)[1]
        return host_part.split("?")[0]
    except (IndexError, ValueError):
        return "(could not parse DATABASE_URL)"


def main() -> None:
    print("Applying database migrations...")
    try:
        run_migrations()
    except OperationalError as exc:
        err_text = str(exc).lower()
        print("\nCould not connect to PostgreSQL.")
        print(f"DATABASE_URL host: {_redact_database_url(settings.database_url)}")
        if "could not translate host name" in err_text or "name resolution" in err_text:
            print(
                "\nDNS lookup failed — your PC could not resolve the database hostname."
                "\nThis is usually a network/DNS issue, not a wrong password."
                "\n\nFix on Windows:"
                "\n  1. Settings → Network → your adapter → DNS → set 8.8.8.8 and 1.1.1.1"
                "\n  2. If you see a DNS suffix like kafi.com, try disabling it on that adapter"
                "\n  3. Retry: nslookup aws-1-ap-south-1.pooler.supabase.com"
                "\n  4. Confirm internet/VPN is up, then run: python run.py"
            )
        else:
            print(
                "\nStart PostgreSQL locally, or replace DATABASE_URL in backend/.env "
                "with a hosted Postgres URL from Neon/Supabase."
            )
        print("\nOriginal error:")
        print(exc)
        raise SystemExit(1) from exc
    print("Migrations complete.")

    print(f"Starting server at http://{settings.api_host}:{settings.api_port}")
    print(f"API docs: http://127.0.0.1:{settings.api_port}/docs")

    uvicorn.run(
        "main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.api_debug,
    )


if __name__ == "__main__":
    main()
