"""Runtime configuration, read once from environment variables.

Secrets (database password, JWT secrets, LLM key) only ever live in the backend
environment; the frontend never sees them.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import date, datetime
from functools import lru_cache
from zoneinfo import ZoneInfo

PKT = ZoneInfo("Asia/Karachi")


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    database_url: str
    supabase_url: str | None
    supabase_jwt_secret: str | None
    dev_auth_secret: str | None
    cors_origins: tuple[str, ...]
    gemini_api_key: str | None
    gemini_model: str
    llm_timeout_seconds: float
    today_override: str | None
    max_upload_bytes: int
    environment: str


@lru_cache
def get_settings() -> Settings:
    return Settings(
        database_url=os.getenv("DATABASE_URL", "sqlite:///./findost.db"),
        supabase_url=(os.getenv("SUPABASE_URL") or "").rstrip("/") or None,
        supabase_jwt_secret=os.getenv("SUPABASE_JWT_SECRET") or None,
        dev_auth_secret=os.getenv("DEV_AUTH_SECRET") or None,
        cors_origins=tuple(
            o.strip()
            for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
            if o.strip()
        ),
        gemini_api_key=os.getenv("GEMINI_API_KEY") or None,
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
        llm_timeout_seconds=float(os.getenv("LLM_TIMEOUT_SECONDS", "8")),
        today_override=os.getenv("FINDOST_TODAY") or None,
        max_upload_bytes=int(os.getenv("MAX_UPLOAD_BYTES", str(2 * 1024 * 1024))),
        environment=os.getenv("ENVIRONMENT", "development"),
    )


def today() -> date:
    """Business "today" in Pakistan time. FINDOST_TODAY pins it for tests and demos."""
    override = get_settings().today_override
    if override:
        return date.fromisoformat(override)
    return datetime.now(PKT).date()
