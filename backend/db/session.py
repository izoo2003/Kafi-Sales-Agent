from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from config import settings

# Keep pools modest per worker — auth middleware + route Depends can open 2
# sessions on a cold auth cache miss. Oversized pools exhaust Supabase limits
# and hang the app → Railway 502. Tune via DB_POOL_SIZE / DB_MAX_OVERFLOW.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_timeout=30,
    pool_recycle=280,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
