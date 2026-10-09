"""Database engine and session handling.

SQLite for local development and tests; Supabase Postgres in production. The
Supabase pooler runs in transaction mode, which does not support prepared
statements, so they are disabled for Postgres connections.
"""
from __future__ import annotations

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import get_settings


def _normalize_url(url: str) -> str:
    # Supabase hands out postgres:// or postgresql:// URLs; SQLAlchemy needs the driver.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://"):]
    return url


@lru_cache
def get_engine() -> Engine:
    url = _normalize_url(get_settings().database_url)
    if url.startswith("sqlite"):
        in_memory = url in ("sqlite://", "sqlite:///:memory:")
        engine = create_engine(url, connect_args={"check_same_thread": False},
                               poolclass=StaticPool if in_memory else None)

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - trivial
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.close()

        return engine
    return create_engine(
        url,
        pool_size=3,
        max_overflow=2,
        pool_pre_ping=True,
        pool_recycle=300,
        connect_args={"prepare_threshold": None},
    )


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False, autoflush=False)


def get_db() -> Iterator[Session]:
    session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.close()


def init_db() -> None:
    from .models import Base

    Base.metadata.create_all(get_engine())
