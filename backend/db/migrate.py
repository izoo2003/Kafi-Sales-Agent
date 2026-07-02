"""Apply pending Alembic migrations. Safe to run on every startup — no-op if already up to date."""

from alembic import command
from alembic.config import Config


def run_migrations() -> None:
    alembic_cfg = Config("alembic.ini")
    command.upgrade(alembic_cfg, "head")
