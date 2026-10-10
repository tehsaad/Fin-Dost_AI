"""Scheduled maintenance, called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`."""
from __future__ import annotations

import hmac
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..errors import ApiError
from ..models import Business

router = APIRouter(tags=["internal"], include_in_schema=False)
log = logging.getLogger("findost.internal")


@router.get("/internal/cleanup-demos")
def cleanup_demos(authorization: str | None = Header(default=None), db: Session = Depends(get_db)):
    """Delete private demo workspaces (anonymous owners) older than DEMO_TTL_DAYS. Real accounts are never touched."""
    settings = get_settings()
    if not settings.cron_secret:
        raise ApiError(503, "not_configured", "CRON_SECRET is not set")
    if not authorization or not hmac.compare_digest(authorization, f"Bearer {settings.cron_secret}"):
        raise ApiError(401, "unauthorized", "Invalid cron credentials")
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.demo_ttl_days)
    stale = db.scalars(select(Business).where(Business.is_anonymous.is_(True), Business.created_at < cutoff)).all()
    for b in stale:
        db.delete(b)  # every workspace table cascades on business_id
    db.commit()
    log.info("cleanup-demos removed %d private demo workspace(s)", len(stale))
    return {"deleted": len(stale), "cutoff": cutoff.isoformat()}
