"""Financial controls (data checks) and the controlled action workflow (propose → approve → complete)."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Access, get_access, require_feature
from ..db import get_db
from ..errors import ApiError
from ..models import ACTION_STATUSES, Business, FinanceAction
from ..schemas import ActionDecisionIn, ActionIn
from ..services import audit
from ..services.controls import run_checks
from ..services.simulation import AdjustmentError, simulate
from .common import context, owned

router = APIRouter(tags=["workflow"])


@router.get("/controls")
def controls(business: Business = Depends(require_feature("controls")), db: Session = Depends(get_db)):
    snap, today = context(db, business)
    return run_checks(snap, today)


def action_dict(a: FinanceAction) -> dict:
    return {
        "id": a.id, "title": a.title, "description": a.description, "source_type": a.source_type,
        "source_ref": a.source_ref, "adjustments": a.adjustments, "estimated_impact_paisa": a.estimated_impact_paisa,
        "impact_basis": a.impact_basis, "due_on": a.due_on.isoformat() if a.due_on else None,
        "requires_approval": a.requires_approval, "status": a.status, "created_by": a.created_by,
        "decided_by": a.decided_by, "decided_at": a.decided_at.isoformat() if a.decided_at else None,
        "decision_note": a.decision_note, "completed_by": a.completed_by,
        "completed_at": a.completed_at.isoformat() if a.completed_at else None, "outcome_note": a.outcome_note,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def _access(access: Access = Depends(get_access)) -> Access:
    from ..auth import FEATURES

    if "actions" not in FEATURES.get(access.business.kind, frozenset()):
        raise ApiError(403, "feature_unavailable", f"'actions' is not part of the {access.business.kind} account type")
    return access


@router.get("/actions")
def list_actions(status: str | None = Query(default=None), access: Access = Depends(_access), db: Session = Depends(get_db)):
    stmt = select(FinanceAction).where(FinanceAction.business_id == access.business.id)
    if status:
        wanted = [s for s in status.split(",") if s in ACTION_STATUSES]
        stmt = stmt.where(FinanceAction.status.in_(wanted))
    rows = db.scalars(stmt.order_by(FinanceAction.created_at.desc()).limit(200)).all()
    counts: dict[str, int] = {}
    for a in db.scalars(select(FinanceAction).where(FinanceAction.business_id == access.business.id)):
        counts[a.status] = counts.get(a.status, 0) + 1
    return {"items": [action_dict(a) for a in rows], "counts": counts, "your_role": access.role,
            "can_approve": access.can("approve"), "can_propose": access.can("propose")}


@router.post("/actions", status_code=201)
def create_action(body: ActionIn, access: Access = Depends(_access), db: Session = Depends(get_db)):
    if not access.can("propose"):
        raise ApiError(403, "forbidden", "Your role cannot create actions")
    business = access.business
    impact, basis = None, None
    if body.adjustments:
        # Never trust a client-sent impact: re-run the same simulation the Recovery page uses.
        snap, today = context(db, business)
        try:
            sim = simulate(snap, today, body.adjustments, 30)
        except AdjustmentError as exc:
            raise ApiError(422, "invalid_adjustment", str(exc))
        impact = sim["comparison"]["min_balance_change_paisa"]
        basis = "Change in the lowest projected balance over 30 days if this is done (simulation, not a guarantee)."
    a = FinanceAction(business_id=business.id, title=body.title, description=body.description,
                      source_type=body.source_type, source_ref=body.source_ref, adjustments=body.adjustments,
                      estimated_impact_paisa=impact, impact_basis=basis, due_on=body.due_on,
                      requires_approval=body.requires_approval, status="proposed", created_by=access.user.id)
    db.add(a)
    db.flush()
    audit.record(db, business, "action", a.id, "create", after={"title": a.title, "status": a.status,
                                                                 "estimated_impact_paisa": impact})
    db.commit()
    return action_dict(a)


TRANSITIONS = {
    # action: (allowed from-statuses, to-status, permission)
    "submit": (("proposed",), "pending_approval", "propose"),
    "approve": (("pending_approval",), "approved", "approve"),
    "reject": (("pending_approval",), "rejected", "approve"),
    "complete": (("approved", "proposed"), "completed", "propose"),
    "cancel": (("proposed", "pending_approval", "approved"), "cancelled", "propose"),
}


@router.post("/actions/{action_id}/{verb}")
def transition(action_id: str, verb: str, body: ActionDecisionIn | None = None, access: Access = Depends(_access),
               db: Session = Depends(get_db)):
    if verb not in TRANSITIONS:
        raise ApiError(404, "not_found", "Unknown action step")
    a = owned(db, FinanceAction, action_id, access.business, "Action", lock=True)
    allowed, target, permission = TRANSITIONS[verb]
    if not access.can(permission):
        raise ApiError(403, "forbidden", f"Your role ({access.role}) cannot {verb} actions")
    if a.status not in allowed:
        raise ApiError(409, "invalid_state", f"Cannot {verb} an action that is {a.status.replace('_', ' ')}")
    if verb == "complete" and a.status == "proposed" and a.requires_approval:
        raise ApiError(409, "approval_required", "This action needs approval before it can be marked completed")
    now = datetime.now(timezone.utc)
    note = body.note if body else None
    before = a.status
    a.status = target
    if verb in ("approve", "reject"):
        a.decided_by, a.decided_at, a.decision_note = access.user.id, now, note
    if verb == "complete":
        a.completed_by, a.completed_at, a.outcome_note = access.user.id, now, note
    audit.record(db, access.business, "action", a.id, verb, extra={"from": before, "to": target, "note": note})
    db.commit()
    return action_dict(a)
