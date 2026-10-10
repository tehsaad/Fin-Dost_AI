"""Account, onboarding (module/account-type selection) and business settings."""
from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import FEATURES, CurrentUser, get_business, get_current_user
from ..config import get_settings
from ..config import today as get_today
from ..db import get_db
from ..errors import ApiError
from ..models import Business
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
def me(user: CurrentUser = Depends(get_current_user), db: Session = Depends(get_db)):
    business = db.scalar(select(Business).where(Business.owner_id == user.id))
    if business is not None:
        rebase_demo_dates(db, business)
    suggested = user.metadata.get("account_type")
    return {
        "user": {"id": user.id, "email": user.email, "name": user.metadata.get("full_name") or user.metadata.get("name"),
                 "is_anonymous": user.is_anonymous},
        "business": business_dict(business) if business else None,
        "needs_onboarding": business is None,
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
def update_business(body: BusinessUpdate, business: Business = Depends(get_business), db: Session = Depends(get_db)):
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
def update_account_settings(body: AccountSettingsIn, business: Business = Depends(get_business),
                            db: Session = Depends(get_db)):
    """Saves immediately, so a toggle survives reloads and new sign-ins without pressing a separate Save."""
    if body.ai_assistance_enabled is not None:
        business.ai_consent = body.ai_assistance_enabled
    if body.language is not None:
        business.language = body.language
    db.commit()
    db.refresh(business)
    return settings_dict(business)


@router.post("/business/reset-demo")
def reset_demo(business: Business = Depends(get_business), db: Session = Depends(get_db)):
    seed_demo(db, business, get_today())
    audit.record(db, business, "workspace", business.id, "reset", extra={"note": "demo data restored"})
    db.commit()
    return {"ok": True, "business": business_dict(business)}


@router.post("/business/clear")
def clear_data(business: Business = Depends(get_business), db: Session = Depends(get_db)):
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
