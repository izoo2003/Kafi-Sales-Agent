"""Re-export DB session dependency — the only bridge api/ uses to reach db/."""

from db.session import get_db

__all__ = ["get_db"]
