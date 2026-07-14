from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from config import settings

# Keep pools small per worker — auth middleware + route Depends can open 2 sessions
# per request, and Railway runs multiple uvicorn workers. Oversized pools exhaust
# Supabase connection limits and make the app hang → Railway 502 (fake CORS).
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=2,
    max_overflow=3,
    pool_timeout=15,
    pool_recycle=280,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
