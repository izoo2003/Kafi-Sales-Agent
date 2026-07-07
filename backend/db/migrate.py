"""Apply pending Alembic migrations. Safe to run on every startup — no-op if already up to date."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text

from db.session import engine

_BACKEND_DIR = Path(__file__).resolve().parent.parent


def _ensure_buyer_social_columns() -> None:
    """Idempotent guard when alembic_version is ahead of the live schema."""
    inspector = inspect(engine)
    if "buyers" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("buyers")}
    statements: list[str] = []
    if "facebook_company_url" not in existing:
        statements.append(
            "ALTER TABLE buyers ADD COLUMN IF NOT EXISTS facebook_company_url VARCHAR(512)"
        )
    if "instagram_company_url" not in existing:
        statements.append(
            "ALTER TABLE buyers ADD COLUMN IF NOT EXISTS instagram_company_url VARCHAR(512)"
        )

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
    print("Applied missing buyer social URL columns.")


def run_migrations() -> None:
    alembic_cfg = Config(str(_BACKEND_DIR / "alembic.ini"))
    command.upgrade(alembic_cfg, "head")
    _ensure_buyer_social_columns()
