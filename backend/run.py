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


def main() -> None:
    print("Applying database migrations...")
    try:
        run_migrations()
    except OperationalError as exc:
        print("\nCould not connect to PostgreSQL.")
        print(f"DATABASE_URL: {settings.database_url}")
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
