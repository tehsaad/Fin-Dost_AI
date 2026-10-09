"""Authentication and business ownership.

The frontend signs users in with Supabase Auth (email + password protected by
Cloudflare Turnstile, or Google). It sends the Supabase access token as a
Bearer JWT, which is verified here:

* asymmetric keys (ES256/RS256) via the project's JWKS endpoint, or
* the legacy HS256 project secret (``SUPABASE_JWT_SECRET``), or
* ``DEV_AUTH_SECRET`` (HS256) for local development and tests only.

Every business-scoped route resolves the caller's single business through
``get_business``; all queries then filter on that business id, so one user can
never read or change another user's data.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import jwt
from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .errors import ApiError
from .models import Business

# Which modules each account type can use. The 4 account types are separated
# by login: a user's business kind decides the modules they see and can call.
FEATURES: dict[str, frozenset[str]] = {
    "sme": frozenset({"ledger", "receivables", "payables", "inventory", "import", "forecast",
                      "alerts", "simulator", "recovery", "reports", "copilot", "impact"}),
    "enterprise": frozenset({"ledger", "receivables", "payables", "inventory", "import", "forecast",
                             "alerts", "simulator", "recovery", "reports", "copilot", "impact"}),
    "household": frozenset({"ledger", "payables", "import", "forecast", "alerts", "simulator",
                            "recovery", "reports", "copilot", "impact"}),
    "student": frozenset({"ledger", "payables", "import", "forecast", "alerts", "simulator",
                          "recovery", "reports", "copilot", "impact"}),
}


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@lru_cache
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600)


def _decode(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise ApiError(401, "invalid_token", "Malformed access token") from exc

    alg = header.get("alg", "")
    options = {"require": ["sub", "exp"]}
    try:
        if alg == "HS256":
            secrets = [s for s in (settings.supabase_jwt_secret, settings.dev_auth_secret) if s]
            if not secrets:
                raise ApiError(401, "invalid_token", "HS256 tokens are not accepted")
            last_exc: Exception | None = None
            for secret in secrets:
                try:
                    return jwt.decode(token, secret, algorithms=["HS256"],
                                      audience="authenticated", options=options)
                except jwt.InvalidSignatureError as exc:
                    last_exc = exc
            raise ApiError(401, "invalid_token", "Invalid token signature") from last_exc
        if alg in ("ES256", "RS256") and settings.supabase_url:
            key = _jwks_client(settings.supabase_url).get_signing_key_from_jwt(token)
            return jwt.decode(token, key.key, algorithms=[alg], audience="authenticated",
                              options=options)
    except jwt.ExpiredSignatureError as exc:
        raise ApiError(401, "token_expired", "Session expired, please sign in again") from exc
    except jwt.PyJWTError as exc:
        raise ApiError(401, "invalid_token", "Invalid access token") from exc
    raise ApiError(401, "invalid_token", f"Unsupported token algorithm {alg!r}")


def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise ApiError(401, "unauthorized", "Sign in required")
    claims = _decode(authorization.split(" ", 1)[1].strip())
    if claims.get("role") not in (None, "authenticated"):
        raise ApiError(401, "unauthorized", "Not a signed-in user")
    meta = claims.get("user_metadata") or {}
    return CurrentUser(id=str(claims["sub"]), email=claims.get("email"),
                       metadata=meta if isinstance(meta, dict) else {})


def get_business(
    user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)
) -> Business:
    business = db.scalar(select(Business).where(Business.owner_id == user.id))
    if business is None:
        raise ApiError(409, "onboarding_required", "Choose your account type to get started")
    from .services.seed import rebase_demo_dates

    rebase_demo_dates(db, business)
    return business


def require_feature(feature: str):
    def _check(business: Business = Depends(get_business)) -> Business:
        if feature not in FEATURES.get(business.kind, frozenset()):
            raise ApiError(403, "feature_unavailable",
                           f"'{feature}' is not part of the {business.kind} account type")
        return business

    return _check
