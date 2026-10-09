"""Database engine and session factory. Alembic owns the schema."""

from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings, get_settings

_engine = None
_session_factory = None


def get_engine(settings: Settings | None = None):
    global _engine, _session_factory
    current = settings or get_settings()
    if _engine is None:
        _engine = create_engine(current.database_url, pool_pre_ping=True, future=True)
        _session_factory = sessionmaker(bind=_engine, autoflush=False, autocommit=False, future=True)
    return _engine


def get_session_factory():
    get_engine()
    if _session_factory is None:
        raise RuntimeError("database session factory is not initialised")
    return _session_factory


def reset_engine() -> None:
    """Drop the cached engine. Tests use this when the database URL changes."""
    global _engine, _session_factory
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _session_factory = None


def session_scope() -> Iterator[Session]:
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.close()


def get_db() -> Iterator[Session]:
    yield from session_scope()
