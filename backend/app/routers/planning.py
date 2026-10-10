"""Budgets (all account types) and savings goals (household, student)."""
from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..auth import require_feature
from ..db import get_db
from ..errors import ApiError
from ..models import Budget, Business, SavingsGoal
from ..schemas import BudgetIn, GoalIn, GoalUpdate
from ..services import audit
from ..services.categories import EXPENSE_CATEGORIES
from ..services.planning import BudgetLine, budget_vs_actual, goal_view
from .common import context, owned

router = APIRouter(tags=["planning"])


def budget_lines(db: Session, business: Business) -> list[BudgetLine]:
    rows = db.scalars(select(Budget).where(Budget.business_id == business.id).order_by(Budget.category)).all()
    return [BudgetLine(b.id, b.category, b.monthly_amount_paisa) for b in rows]


@router.get("/budgets")
def get_budgets(month: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
                business: Business = Depends(require_feature("budget")), db: Session = Depends(get_db)):
    snap, today = context(db, business)
    month_day = date.fromisoformat(f"{month}-01") if month else None
    if month_day and month_day > today:
        raise ApiError(422, "validation_error", "Choose the current or a past month")
    report = budget_vs_actual(snap, budget_lines(db, business), today, month_day)
    used = {t.category for t in snap.txs if t.kind in ("expense", "credit_purchase")}
    report["suggested_categories"] = sorted(used | set(EXPENSE_CATEGORIES))
    return report


@router.put("/budgets")
def upsert_budget(body: BudgetIn, business: Business = Depends(require_feature("budget")), db: Session = Depends(get_db)):
    row = db.scalar(select(Budget).where(Budget.business_id == business.id, Budget.category == body.category))
    before = {"monthly_amount_paisa": row.monthly_amount_paisa} if row else None
    if row is None:
        row = Budget(business_id=business.id, category=body.category, monthly_amount_paisa=body.monthly_amount_paisa)
        db.add(row)
    else:
        row.monthly_amount_paisa = body.monthly_amount_paisa
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise ApiError(409, "conflict", "This budget was changed at the same time; try again")
    audit.record(db, business, "budget", row.id, "update" if before else "create", before=before or {},
                 after={"category": row.category, "monthly_amount_paisa": row.monthly_amount_paisa})
    db.commit()
    return {"id": row.id, "category": row.category, "monthly_amount_paisa": row.monthly_amount_paisa}


@router.delete("/budgets/{budget_id}", status_code=204)
def delete_budget(budget_id: str, business: Business = Depends(require_feature("budget")), db: Session = Depends(get_db)):
    row = owned(db, Budget, budget_id, business, "Budget")
    audit.record(db, business, "budget", row.id, "delete",
                 before={"category": row.category, "monthly_amount_paisa": row.monthly_amount_paisa})
    db.delete(row)
    db.commit()


@router.get("/goals")
def list_goals(business: Business = Depends(require_feature("goals")), db: Session = Depends(get_db)):
    snap, today = context(db, business)
    rows = db.scalars(select(SavingsGoal).where(SavingsGoal.business_id == business.id).order_by(SavingsGoal.target_date)).all()
    return {"items": [goal_view(g, snap, today) for g in rows]}


@router.post("/goals", status_code=201)
def create_goal(body: GoalIn, business: Business = Depends(require_feature("goals")), db: Session = Depends(get_db)):
    snap, today = context(db, business)
    if body.target_date <= today:
        raise ApiError(422, "validation_error", "Choose a target date in the future")
    g = SavingsGoal(business_id=business.id, name=body.name, target_paisa=body.target_paisa,
                    saved_paisa=body.saved_paisa, target_date=body.target_date)
    db.add(g)
    db.flush()
    audit.record(db, business, "goal", g.id, "create", after={"name": g.name, "target_paisa": g.target_paisa})
    db.commit()
    return goal_view(g, snap, today)


@router.put("/goals/{goal_id}")
def update_goal(goal_id: str, body: GoalUpdate, business: Business = Depends(require_feature("goals")),
                db: Session = Depends(get_db)):
    g = owned(db, SavingsGoal, goal_id, business, "Goal")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(g, k, v)
    audit.record(db, business, "goal", g.id, "update", extra={"fields": sorted(data)})
    db.commit()
    snap, today = context(db, business)
    return goal_view(g, snap, today)


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: str, business: Business = Depends(require_feature("goals")), db: Session = Depends(get_db)):
    g = owned(db, SavingsGoal, goal_id, business, "Goal")
    audit.record(db, business, "goal", g.id, "delete", before={"name": g.name})
    db.delete(g)
    db.commit()
