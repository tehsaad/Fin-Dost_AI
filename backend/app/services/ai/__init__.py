"""Task routing across AI providers, plus a durable per-business daily quota.

Routing (one provider per request; the next is tried only if the first fails):
  explain          -> Groq, then Gemini       (plain-language / Urdu explanations of computed results)
  extract_receipt  -> Gemini                  (document understanding; Groq takes no images)
"""
from __future__ import annotations

import logging
from datetime import date

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...config import get_settings
from ...errors import ApiError
from ...models import AiUsage, Business
from .base import AIError, AIRequest, AIResult, Attachment
from .providers import GeminiProvider, GroqProvider

__all__ = ["AIError", "AIRequest", "AIResult", "Attachment", "ROUTES", "run", "status", "consume_quota"]

log = logging.getLogger("findost.ai")

ROUTES: dict[str, tuple[str, ...]] = {
    "explain": ("groq", "gemini"),
    "extract_receipt": ("gemini",),
}
FALLBACK_ON = {"unavailable", "rate_limited", "timeout", "http_error", "invalid_output", "unsupported"}


def _providers() -> dict:
    return {"groq": GroqProvider(), "gemini": GeminiProvider()}


def status() -> dict:
    ps = _providers()
    return {
        "providers": {n: {"configured": p.configured(), "model": p.model} for n, p in ps.items()},
        "tasks": {t: {"route": list(r), "available": any(ps[n].configured() for n in r)} for t, r in ROUTES.items()},
        "daily_limit": get_settings().ai_daily_limit,
    }


def run(req: AIRequest) -> AIResult:
    ps = _providers()
    route = [ps[n] for n in ROUTES[req.task] if ps[n].configured()]
    if not route:
        raise AIError("unavailable", "No AI provider is configured for this task")
    last: AIError | None = None
    for provider in route:
        try:
            return provider.generate(req)
        except AIError as exc:
            log.warning("AI task %s via %s failed: %s", req.task, provider.name, exc.code)
            last = exc
            if exc.code not in FALLBACK_ON:
                break
    assert last is not None
    raise last


def consume_quota(db: Session, business: Business, task: str, today: date) -> int:
    """Count one AI call for today; refuse once the daily limit is reached. Returns calls left."""
    limit = get_settings().ai_daily_limit
    for _ in range(2):
        row = db.scalar(select(AiUsage).where(AiUsage.business_id == business.id, AiUsage.day == today,
                                             AiUsage.task == task).with_for_update())
        if row is None:
            row = AiUsage(business_id=business.id, day=today, task=task, calls=0)
            db.add(row)
            try:
                db.flush()
            except IntegrityError:  # created concurrently: read it again
                db.rollback()
                continue
        if row.calls >= limit:
            raise ApiError(429, "ai_quota", f"Today's AI limit ({limit} requests) is used up. "
                                            "FinDost's own calculations keep working without AI.")
        row.calls += 1
        db.commit()
        return limit - row.calls
    raise ApiError(503, "ai_quota_unavailable", "Could not record AI usage, please retry")
