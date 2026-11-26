from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

_sqlite = settings.DATABASE_URL.startswith("sqlite")
_args = {"check_same_thread": False} if _sqlite else {}
_pool = {} if _sqlite else dict(pool_size=settings.DB_POOL_SIZE, max_overflow=settings.DB_MAX_OVERFLOW,
                                pool_timeout=30, pool_recycle=1800)
engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, connect_args=_args, **_pool)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()