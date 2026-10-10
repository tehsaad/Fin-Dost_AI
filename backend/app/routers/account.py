"""Account, onboarding (module/account-type selection) and business settings."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import (FEATURES, PERMISSIONS, Access, CurrentUser, get_business, get_current_user, memberships,
                    require_permission, resolve_access)
from ..config import get_settings
from ..config import today as get_today
from ..db import get_db
from ..errors import ApiError
from ..models import Business, WorkspaceMember
from ..schemas import AccountSettingsIn, BusinessUpdate, OnboardingIn
from ..services import audit
from ..services.i18n import GLOSSARY
from ..services.recovery import DEFAULT_WEIGHTS
from ..services.seed import DEMO_PROFILES, clear_business_data, rebase_demo_dates, seed_demo

router = APIRouter(tags=["account"])

KIND_LABELS = {
    "sme": "Small business / shop (SME)",
    "student": "Student",
    "household": "Household",
    "enterprise": "Enterprise",
}


def business_dict(b: Business) -> dict:
    return {
        "id": b.id, "name": b.name, "kind": b.kind, "kind_label": KIND_LABELS[b.kind], "city": b.city,
        "currency": b.currency, "opening_date": b.opening_date.isoformat(),
        "opening_cash_paisa": b.opening_cash_paisa, "opening_bank_paisa": b.opening_bank_paisa,
        "opening_wallet_paisa": b.opening_wallet_paisa, "cash_reserve_paisa": b.cash_reserve_paisa,
        "is_demo": b.is_demo, "ai_consent": b.ai_consent, "language": b.language,
        "recovery_weights": b.recovery_weights or DEFAULT_WEIGHTS,
        "features": sorted(FEATURES[b.kind]),
        "is_anonymous": b.is_anonymous,
        "demo_expires_on": ((b.created_at.date() + timedelta(days=get_settings().demo_ttl_days)).isoformat()
                            if b.is_anonymous and b.created_at else None),
    }


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db),
       x_workspace_id: str | None = Header(default=None)):
    """Who is signed in, and every workspace they may open. The identity (Supabase user) and the active workspace
    are separate: a user may own one workspace and be a member of others. A workspace id from the browser is only
    honoured for its owner or an active member; otherwise ``workspace_denied`` is true and no workspace is returned,
    so the app asks the user to choose again instead of silently opening a different one."""
    options = memberships(db, user.id)
    requested = (x_workspace_id or "").strip()[:36] or None
    denied = False
    try:
        access = resolve_access(db, user, requested)
    except ApiError:  # revoked membership, or an id that was never this user's
        access, denied = None, True
    business = access.business if access else None
    if business is not None and access.role == "owner" and business.owner_id == user.id:
        rebase_demo_dates(db, business)
    joined = {m.business_id: m.created_at for m in db.scalars(
        select(WorkspaceMember).where(WorkspaceMember.user_id == user.id, WorkspaceMember.status == "active"))}
    own = next((b for b, _ in options if b.owner_id == user.id), None)
    suggested = user.metadata.get("account_type")
    return {
        "user": {"id": user.id, "email": user.email, "name": user.metadata.get("full_name") or user.metadata.get("name"),
                 "is_anonymous": user.is_anonymous},
        "business": business_dict(business) if business else None,
        "role": access.role if access else None,
        "permissions": sorted(PERMISSIONS.get(access.role, ())) if access else [],
        "workspaces": [{"id": b.id, "name": b.name, "kind": b.kind, "kind_label": KIND_LABELS[b.kind], "city": b.city,
                        "role": r, "is_own": b.owner_id == user.id, "is_demo": b.is_demo,
                        "joined_at": joined[b.id].isoformat() if b.id in joined and joined[b.id] else None}
                       for b, r in options],
        "own_workspace_id": own.id if own else None,
        "workspace_denied": denied,
        "needs_onboarding": not options,
        "suggested_kind": suggested if suggested in FEATURES else None,
        "suggested_business_name": user.metadata.get("business_name"),
    }


@router.post("/onboarding", status_code=201)
def onboarding(body: OnboardingIn, user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    if db.scalar(select(Business).where(Business.owner_id == user.id)) is not None:
        raise ApiError(409, "already_onboarded", "This account already has a workspace. Account types cannot be switched.")
    today = get_today()
    business = Business(owner_id=user.id, name=body.business_name, kind=body.kind, city=body.city,
                        opening_date=today, language="en", is_anonymous=user.is_anonymous)
    db.add(business)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "already_onboarded", "This account already has a workspace.")
    if body.load_demo:
        seed_demo(db, business, today)
        business.name = body.business_name or DEMO_PROFILES[body.kind]["name"]
    db.commit()
    return {"business": business_dict(business)}


@router.get("/business")
def get_business_settings(business: Business = Depends(get_business)):
    return business_dict(business)


@router.put("/business")
def update_business(body: BusinessUpdate, access: Access = Depends(require_permission("admin")), db: Session = Depends(get_db)):
    business = access.business
    data = body.model_dump(exclude_unset=True)
    if "opening_date" in data and data["opening_date"] > get_today():
        raise ApiError(422, "validation_error", "Opening date cannot be in the future")
    for key, value in data.items():
        setattr(business, key, value)
    db.commit()
    return business_dict(business)


def settings_dict(b: Business) -> dict:
    return {"ai_assistance_enabled": bool(b.ai_consent), "language": b.language}


@router.get("/account/settings")
def get_account_settings(business: Business = Depends(get_business)):
    """Per-user preferences, read from the signed-in owner's workspace row (the single source of truth)."""
    return settings_dict(business)


@router.put("/account/settings")
def update_account_settings(body: AccountSettingsIn, access: Access = Depends(require_permission("admin")),
                            db: Session = Depends(get_db)):
    """Saves immediately, so a toggle survives reloads and new sign-ins without pressing a separate Save.
    Workspace-wide (AI consent covers the company's data), so only an owner may change it."""
    business = access.business
    if body.ai_assistance_enabled is not None:
        business.ai_consent = body.ai_assistance_enabled
    if body.language is not None:
        business.language = body.language
    db.commit()
    db.refresh(business)
    return settings_dict(business)


@router.post("/business/reset-demo")
def reset_demo(access: Access = Depends(require_permission("admin")), db: Session = Depends(get_db)):
    business = access.business
    seed_demo(db, business, get_today())
    audit.record(db, business, "workspace", business.id, "reset", extra={"note": "demo data restored"})
    db.commit()
    return {"ok": True, "business": business_dict(business)}


@router.post("/business/clear")
def clear_data(access: Access = Depends(require_permission("admin")), db: Session = Depends(get_db)):
    business = access.business
    """Start fresh with your own data: removes all records (demo and user) for this workspace."""
    clear_business_data(db, business)
    business.is_demo = False
    business.demo_anchor = None
    business.opening_cash_paisa = business.opening_bank_paisa = business.opening_wallet_paisa = 0
    business.opening_date = get_today() - timedelta(days=1)
    audit.record(db, business, "workspace", business.id, "clear", extra={"note": "all records removed by the owner"})
    db.commit()
    return {"ok": True, "business": business_dict(business)}


@router.get("/glossary")
def glossary():
    return {"terms": GLOSSARY}
