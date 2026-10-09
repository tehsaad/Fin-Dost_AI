"""Deterministic ledger calculations (Layer 1).

Accounting rules kept deliberately explicit:

* Revenue  = cash ``income`` + ``credit_sale``  (a credit sale is revenue, not cash).
* Expenses = cash ``expense`` + ``credit_purchase``.
* Cash moves only for cash kinds; ``customer_payment`` is cash received but NOT
  revenue, ``supplier_payment`` is cash paid but NOT an expense, loans and owner
  withdrawals move cash without touching profit.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

from .snapshot import Pay, Rec, Snapshot, Tx

CASH_IN_KINDS = frozenset({"income", "customer_payment", "loan_received"})
CASH_OUT_KINDS = frozenset({"expense", "supplier_payment", "loan_repayment", "owner_withdrawal"})
REVENUE_KINDS = frozenset({"income", "credit_sale"})
EXPENSE_KINDS = frozenset({"expense", "credit_purchase"})
CREDIT_KINDS = frozenset({"credit_sale", "credit_purchase"})


def account_deltas(tx: Tx) -> dict[str, int]:
    """Signed cash effect of one transaction per account (cash/bank/wallet)."""
    if tx.kind in CASH_IN_KINDS:
        return {tx.account or "cash": tx.amount}
    if tx.kind in CASH_OUT_KINDS:
        return {tx.account or "cash": -tx.amount}
    if tx.kind == "transfer" and tx.account and tx.to_account and tx.account != tx.to_account:
        return {tx.account: -tx.amount, tx.to_account: tx.amount}
    return {}


def cash_delta(tx: Tx) -> int:
    """Net effect on total cash (all accounts). Transfers and credit kinds are zero."""
    return sum(account_deltas(tx).values())


def account_balances(snap: Snapshot, as_of: date) -> dict[str, int]:
    balances = {"cash": snap.opening["cash"], "bank": snap.opening["bank"], "wallet": snap.opening["wallet"]}
    for tx in snap.txs:
        if tx.occurred_on <= as_of:
            for acct, delta in account_deltas(tx).items():
                balances[acct] = balances.get(acct, 0) + delta
    balances["total"] = balances["cash"] + balances["bank"] + balances["wallet"]
    return balances


def daily_cash_balances(snap: Snapshot, start: date, end: date) -> list[tuple[date, int]]:
    """End-of-day total cash for each day in [start, end]."""
    running = snap.opening["cash"] + snap.opening["bank"] + snap.opening["wallet"]
    by_day: dict[date, int] = defaultdict(int)
    for tx in snap.txs:
        d = cash_delta(tx)
        if not d:
            continue
        if tx.occurred_on < start:
            running += d
        elif tx.occurred_on <= end:
            by_day[tx.occurred_on] += d
    out: list[tuple[date, int]] = []
    day = start
    while day <= end:
        running += by_day.get(day, 0)
        out.append((day, running))
        day += timedelta(days=1)
    return out


@dataclass(frozen=True)
class PeriodSummary:
    start: date
    end: date
    revenue: int
    cash_revenue: int
    credit_revenue: int
    expenses: int
    profit: int
    cash_in: int
    cash_out: int
    expense_by_category: dict[str, int]
    revenue_by_category: dict[str, int]


def period_summary(snap: Snapshot, start: date, end: date) -> PeriodSummary:
    revenue = cash_rev = credit_rev = expenses = cash_in = cash_out = 0
    exp_cat: dict[str, int] = defaultdict(int)
    rev_cat: dict[str, int] = defaultdict(int)
    for tx in snap.txs:
        if not (start <= tx.occurred_on <= end):
            continue
        if tx.kind in REVENUE_KINDS:
            revenue += tx.amount
            rev_cat[tx.category] += tx.amount
            if tx.kind == "income":
                cash_rev += tx.amount
            else:
                credit_rev += tx.amount
        if tx.kind in EXPENSE_KINDS:
            expenses += tx.amount
            exp_cat[tx.category] += tx.amount
        d = cash_delta(tx)
        if d > 0:
            cash_in += d
        elif d < 0:
            cash_out += -d
    return PeriodSummary(
        start=start, end=end, revenue=revenue, cash_revenue=cash_rev, credit_revenue=credit_rev,
        expenses=expenses, profit=revenue - expenses, cash_in=cash_in, cash_out=cash_out,
        expense_by_category=dict(sorted(exp_cat.items(), key=lambda kv: -kv[1])),
        revenue_by_category=dict(sorted(rev_cat.items(), key=lambda kv: -kv[1])),
    )


def outstanding_as_of(rec_or_pay: Rec | Pay, as_of: date) -> int:
    paid = sum(a for d, a in rec_or_pay.payments if d <= as_of)
    return max(rec_or_pay.amount - paid, 0)


def aging_bucket(days_overdue: int) -> str:
    if days_overdue <= 0:
        return "current"
    if days_overdue <= 30:
        return "1-30"
    if days_overdue <= 60:
        return "31-60"
    if days_overdue <= 90:
        return "61-90"
    return "90+"


def receivable_view(rec: Rec, today: date) -> dict:
    days_overdue = (today - rec.due_on).days
    outstanding = rec.outstanding
    status = "settled" if outstanding == 0 else ("overdue" if days_overdue > 0 else "open")
    return {
        "id": rec.id,
        "customer_id": rec.customer_id,
        "customer_name": rec.customer_name,
        "reference": rec.reference,
        "description": rec.description,
        "issued_on": rec.issued_on.isoformat(),
        "due_on": rec.due_on.isoformat(),
        "expected_on": rec.expected_on.isoformat() if rec.expected_on else None,
        "amount_paisa": rec.amount,
        "paid_paisa": rec.paid,
        "outstanding_paisa": outstanding,
        "days_overdue": max(days_overdue, 0) if outstanding else 0,
        "aging_bucket": aging_bucket(days_overdue) if outstanding else "settled",
        "status": status,
        "payments": [{"date": d.isoformat(), "amount_paisa": a} for d, a in rec.payments],
    }


def payable_view(pay: Pay, today: date) -> dict:
    days_to_due = (pay.due_on - today).days
    outstanding = pay.outstanding
    status = "paid" if outstanding == 0 else ("overdue" if days_to_due < 0 else "open")
    return {
        "id": pay.id,
        "supplier_id": pay.supplier_id,
        "supplier_name": pay.supplier_name,
        "label": pay.label,
        "reference": pay.reference,
        "description": pay.description,
        "category": pay.category,
        "issued_on": pay.issued_on.isoformat(),
        "due_on": pay.due_on.isoformat(),
        "amount_paisa": pay.amount,
        "paid_paisa": pay.paid,
        "outstanding_paisa": outstanding,
        "days_to_due": days_to_due,
        "is_essential": pay.is_essential,
        "status": status,
        "payments": [{"date": d.isoformat(), "amount_paisa": a} for d, a in pay.payments],
    }


def receivables_summary(snap: Snapshot, today: date) -> dict:
    total = overdue = 0
    overdue_count = 0
    buckets: dict[str, int] = defaultdict(int)
    by_customer: dict[str, int] = defaultdict(int)
    for rec in snap.receivables:
        out = rec.outstanding
        if not out:
            continue
        total += out
        by_customer[rec.customer_name] += out
        days = (today - rec.due_on).days
        buckets[aging_bucket(days)] += out
        if days > 0:
            overdue += out
            overdue_count += 1
    return {
        "total_paisa": total,
        "overdue_paisa": overdue,
        "overdue_count": overdue_count,
        "aging": {k: buckets.get(k, 0) for k in ("current", "1-30", "31-60", "61-90", "90+")},
        "by_customer": dict(sorted(by_customer.items(), key=lambda kv: -kv[1])),
    }


def payables_summary(snap: Snapshot, today: date, within_days: int = 14) -> dict:
    total = upcoming = overdue = 0
    upcoming_items: list[Pay] = []
    for pay in snap.payables:
        out = pay.outstanding
        if not out:
            continue
        total += out
        days = (pay.due_on - today).days
        if days < 0:
            overdue += out
        if days <= within_days:
            upcoming += out
            upcoming_items.append(pay)
    return {
        "total_paisa": total,
        "due_within_paisa": upcoming,
        "within_days": within_days,
        "overdue_paisa": overdue,
        "upcoming": [payable_view(p, today) for p in sorted(upcoming_items, key=lambda p: p.due_on)],
    }


def inventory_value(snap: Snapshot) -> int:
    qty: dict[str, int] = defaultdict(int)
    for m in snap.movements:
        qty[m.product_id] += m.quantity
    return sum(max(qty.get(p.id, 0), 0) * p.unit_cost for p in snap.products)
