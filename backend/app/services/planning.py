"""Budgets and savings goals, computed only from the user's own budgets/goals and ledger.

Budget vs actual uses the same `period_summary` (expense categories) as the dashboard and reports, so the
figures always agree. Nothing is assumed when a budget or goal has not been entered.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from ..money import fmt_pkr
from .ledger import period_summary
from .snapshot import Snapshot

NEAR_LIMIT = 0.9  # 90% of the monthly budget used


@dataclass(frozen=True)
class BudgetLine:
    id: str
    category: str
    monthly_amount: int


def month_bounds(day: date) -> tuple[date, date]:
    return day.replace(day=1), day.replace(day=calendar.monthrange(day.year, day.month)[1])


def budget_vs_actual(snap: Snapshot, budgets: list[BudgetLine], today: date, month: date | None = None) -> dict:
    """Budget vs actual expenses for one calendar month (default: the current month to date)."""
    start, end = month_bounds(month or today)
    to = min(end, today)
    spent = period_summary(snap, start, to).expense_by_category if to >= start else {}
    elapsed = (to - start).days + 1 if to >= start else 0
    days = (end - start).days + 1
    lines = []
    for b in budgets:
        actual = spent.get(b.category, 0)
        used = actual / b.monthly_amount
        status = "over" if actual > b.monthly_amount else "near" if used >= NEAR_LIMIT else "ok"
        lines.append({
            "id": b.id, "category": b.category, "budget_paisa": b.monthly_amount, "actual_paisa": actual,
            "variance_paisa": b.monthly_amount - actual, "used_pct": round(used * 100, 1), "status": status,
            # pro-rata expectation so far this month: a simple pace check, labelled as such
            "expected_to_date_paisa": int(round(b.monthly_amount * elapsed / days)),
        })
    budgeted = {b.category for b in budgets}
    unbudgeted = [{"category": c, "actual_paisa": a} for c, a in spent.items() if c not in budgeted]
    total_budget = sum(b.monthly_amount for b in budgets)
    total_actual = sum(line["actual_paisa"] for line in lines)
    return {
        "month": start.strftime("%Y-%m"), "from": start.isoformat(), "to": to.isoformat(), "days_elapsed": elapsed,
        "days_in_month": days, "lines": sorted(lines, key=lambda x: (x["status"] != "over", -x["used_pct"])),
        "unbudgeted": sorted(unbudgeted, key=lambda x: -x["actual_paisa"]),
        "totals": {"budget_paisa": total_budget, "actual_paisa": total_actual, "variance_paisa": total_budget - total_actual},
        "has_budgets": bool(budgets),
        "note": "Actual = expenses recorded in your ledger this month (credit purchases count when bought). "
                "'Expected to date' is the budget spread evenly over the month, a pace check only.",
    }


def budget_alerts(report: dict) -> list[dict]:
    """Over-budget categories for the alerts engine (only when budgets exist)."""
    out = []
    for line in report["lines"]:
        if line["status"] != "over":
            continue
        over = line["actual_paisa"] - line["budget_paisa"]
        out.append({"category": line["category"], "over_paisa": over, "budget_paisa": line["budget_paisa"],
                    "actual_paisa": line["actual_paisa"], "used_pct": line["used_pct"]})
    return out


def goal_view(goal, snap: Snapshot, today: date) -> dict:
    """Progress and the monthly amount still needed; feasibility against the last 90 days' average net income."""
    remaining = max(goal.target_paisa - goal.saved_paisa, 0)
    days_left = (goal.target_date - today).days
    months_left = max(days_left / 30.44, 0)
    monthly_needed = int(round(remaining / months_left)) if months_left >= 1 else remaining
    p90 = period_summary(snap, today - timedelta(days=89), today)
    avg_monthly_net = int(round((p90.cash_in - p90.cash_out) / 3))
    if remaining == 0:
        status, note = "reached", "Goal reached."
    elif days_left < 0:
        status, note = "overdue", "The target date has passed; set a new date to plan monthly savings."
    elif avg_monthly_net <= 0:
        status = "at_risk"
        note = (f"Over the last 90 days more cash went out than came in (average {fmt_pkr(avg_monthly_net)} a month), "
                f"so the {fmt_pkr(monthly_needed)} a month needed is not covered by your current pattern.")
    elif monthly_needed > avg_monthly_net:
        status = "at_risk"
        note = (f"You need {fmt_pkr(monthly_needed)} a month but have recently kept about {fmt_pkr(avg_monthly_net)} "
                "a month. Consider a later date or lower spending.")
    else:
        status = "on_track"
        note = (f"{fmt_pkr(monthly_needed)} a month is within your recent average surplus of {fmt_pkr(avg_monthly_net)}.")
    return {
        "id": goal.id, "name": goal.name, "target_paisa": goal.target_paisa, "saved_paisa": goal.saved_paisa,
        "remaining_paisa": remaining, "target_date": goal.target_date.isoformat(), "days_left": days_left,
        "progress_pct": round(min(goal.saved_paisa / goal.target_paisa, 1) * 100, 1),
        "monthly_needed_paisa": monthly_needed, "avg_monthly_net_paisa": avg_monthly_net, "status": status, "note": note,
        "basis": "Average monthly net cash = (cash in − cash out) over the last 90 days ÷ 3. 'Saved' is the amount you entered.",
    }
