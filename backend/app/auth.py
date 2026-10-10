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

from contextvars import ContextVar
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import jwt
from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .errors import ApiError
from .models import Business, WorkspaceMember

# Which modules each account type can use. The 4 account types are separated
# by login: a user's business kind decides the modules they see and can call.
# SDG impact is no longer a workspace module: it lives on the public landing page (/public/benchmark).
FEATURES: dict[str, frozenset[str]] = {
    "sme": frozenset({"ledger", "receivables", "payables", "inventory", "import", "forecast", "alerts",
                      "simulator", "recovery", "reports", "copilot", "budget", "controls", "actions"}),
    "enterprise": frozenset({"ledger", "receivables", "payables", "inventory", "import", "forecast", "alerts",
                             "simulator", "recovery", "reports", "copilot", "budget", "controls", "actions", "team"}),
    "household": frozenset({"ledger", "payables", "import", "forecast", "alerts", "simulator",
                            "recovery", "reports", "copilot", "budget", "goals"}),
    "student": frozenset({"ledger", "payables", "import", "forecast", "alerts", "simulator",
                          "recovery", "reports", "copilot", "budget", "goals"}),
}

# Workspace roles. The creator of a workspace is always "owner". Unknown roles get no permissions.
PERMISSIONS: dict[str, frozenset[str]] = {
    "owner": frozenset({"read", "export", "write", "propose", "approve", "admin"}),
    "editor": frozenset({"read", "export", "write", "propose"}),
    "viewer": frozenset({"read", "export"}),
}
# POST endpoints that only calculate (never persist): allowed for read-only roles.
READ_ONLY_POSTS = ("/scenarios/simulate", "/scenarios/compare", "/recovery/recommendations", "/recovery/compare",
                   "/copilot/query", "/copilot/stream", "/ai/test")

# Who is acting in this request (for the audit log); set by get_business.
current_actor: ContextVar[str | None] = ContextVar("current_actor", default=None)


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    is_anonymous: bool = False


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
            # The developer secret is never honoured in production, even if it is set by mistake.
            dev_secret = settings.dev_auth_secret if settings.environment != "production" else None
            secrets = [s for s in (settings.supabase_jwt_secret, dev_secret) if s]
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
    return CurrentUser(id=str(claims["sub"]), email=claims.get("email") or None,
                       metadata=meta if isinstance(meta, dict) else {}, is_anonymous=claims.get("is_anonymous") is True)


@dataclass(frozen=True)
class Access:
    business: Business
    user: CurrentUser
    role: str

    def can(self, permission: str) -> bool:
        return permission in PERMISSIONS.get(self.role, frozenset())


def memberships(db: Session, user_id: str) -> list[tuple[Business, str]]:
    """Every workspace this user may open, with their role (own workspace first)."""
    out: list[tuple[Business, str]] = []
    own = db.scalar(select(Business).where(Business.owner_id == user_id))
    if own is not None:
        out.append((own, "owner"))
    rows = db.execute(select(Business, WorkspaceMember.role).join(WorkspaceMember, WorkspaceMember.business_id == Business.id)
                      .where(WorkspaceMember.user_id == user_id, WorkspaceMember.status == "active")
                      .order_by(WorkspaceMember.created_at)).all()
    out.extend((b, role) for b, role in rows if own is None or b.id != own.id)
    return out


def resolve_access(db: Session, user: CurrentUser, workspace_id: str | None) -> Access | None:
    """The workspace for this request. A client-supplied id is only honoured if this user owns it or is an
    active member; otherwise the user's own workspace (or first membership) is used."""
    options = memberships(db, user.id)
    if workspace_id:
        match = next(((b, r) for b, r in options if b.id == workspace_id), None)
        if match is None:
            raise ApiError(404, "workspace_not_found", "Workspace not found")
        return Access(match[0], user, match[1])
    return Access(options[0][0], user, options[0][1]) if options else None


def get_access(request: Request, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db),
               x_workspace_id: str | None = Header(default=None)) -> Access:
    access = resolve_access(db, user, (x_workspace_id or "").strip()[:36] or None)
    if access is None:
        raise ApiError(409, "onboarding_required", "Choose your account type to get started")
    business = access.business
    # Default-deny for read-only roles: any request that can change data needs "write".
    mutating = request.method not in ("GET", "HEAD", "OPTIONS")
    leaving = request.method == "DELETE" and request.url.path.endswith(f"/team/members/{user.id}")
    if mutating and not access.can("write") and not request.url.path.endswith(READ_ONLY_POSTS) and not leaving:
        raise ApiError(403, "read_only_role", "Your role in this workspace can view and export, but not change data")
    current_actor.set(user.id)
    request.state.access = access
    if access.role == "owner" and business.owner_id == user.id:
        if business.is_anonymous and not user.is_anonymous:
            # The demo user added an email and password: keep the workspace (no longer auto-deleted).
            business.is_anonymous = False
            db.commit()
        from .services.seed import rebase_demo_dates

        rebase_demo_dates(db, business)
    return access


def get_business(access: Access = Depends(get_access)) -> Business:
    return access.business


def require_permission(permission: str):
    def _check(access: Access = Depends(get_access)) -> Access:
        if not access.can(permission):
            raise ApiError(403, "forbidden", f"Your role ({access.role}) cannot do this in this workspace")
        return access

    return _check


def require_feature(feature: str):
    def _check(business: Business = Depends(get_business)) -> Business:
        if feature not in FEATURES.get(business.kind, frozenset()):
            raise ApiError(403, "feature_unavailable",
                           f"'{feature}' is not part of the {business.kind} account type")
        return business

    return _check
