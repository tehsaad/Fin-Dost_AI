"""Scenario engine: shocks, what-if decisions and recovery actions.

Every scenario is a list of adjustments applied to the same forecast
components the dashboard uses, then re-projected. Nothing here is a
placeholder: each number comes from re-running the projection.

Adjustment types
----------------
Shocks:   sales_decline, delayed_payment, supplier_price_increase, unexpected_expense,
          utility_increase, rent_increase, business_interruption, flood_disruption, customer_loss
What-if:  move_receivable, move_payable, sales_change, opex_change, purchase_change,
          emergency_expense, revenue_recovery
Recovery: collect_receivables, request_partial_payment, defer_payables, reduce_discretionary,
          delay_purchases, liquidate_stock, cash_injection
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np

from ..money import fmt_pkr
from .categories import is_rent, is_utility
from .forecast import Components, Event, build_components, project
from .snapshot import Snapshot

SHOCK_TYPES = {"sales_decline", "delayed_payment", "supplier_price_increase", "unexpected_expense",
               "utility_increase", "rent_increase", "business_interruption", "flood_disruption", "customer_loss"}
WHAT_IF_TYPES = {"move_receivable", "move_payable", "sales_change", "opex_change", "purchase_change",
                 "emergency_expense", "revenue_recovery", "income_change", "income_delay"}
ACTION_TYPES = {"collect_receivables", "request_partial_payment", "defer_payables", "reduce_discretionary",
                "delay_purchases", "liquidate_stock", "cash_injection"}
ALL_TYPES = SHOCK_TYPES | WHAT_IF_TYPES | ACTION_TYPES


class AdjustmentError(ValueError):
    pass


def _num(adj: dict, key: str, default: float, lo: float, hi: float) -> float:
    raw = adj.get(key, default)
    try:
        value = float(raw)
    except (TypeError, ValueError):
        raise AdjustmentError(f"{adj.get('type')}: '{key}' must be a number")
    if not (lo <= value <= hi):
        raise AdjustmentError(f"{adj.get('type')}: '{key}' must be between {lo:g} and {hi:g}")
    return value


def _window(comp: Components, adj: dict, default_duration: int | None = None) -> slice:
    start = int(_num(adj, "start_day", 1, 0, 365))
    duration = adj.get("duration_days", default_duration)
    start = max(start, 1)
    if duration is None:
        return slice(start, comp.horizon + 1)
    duration = int(_num({**adj, "duration_days": duration}, "duration_days", 14, 1, 365))
    return slice(start, min(start + duration, comp.horizon + 1))


def _scale_events(comp: Components, pred, factor: float, start_day: int = 1) -> None:
    for ev in comp.events:
        if ev.day >= start_day and pred(ev):
            ev.amount = int(round(ev.amount * factor))


def _shift_receivables(comp: Components, ids: set[str] | None, delay: int, snap: Snapshot,
                       customer_id: str | None = None) -> int:
    moved = 0
    rec_customer = {r.id: r.customer_id for r in snap.receivables}
    for ev in comp.events:
        if ev.ref_type != "receivable":
            continue
        if ids is not None and ev.ref_id not in ids:
            continue
        if customer_id and rec_customer.get(ev.ref_id) != customer_id:
            continue
        ev.day += delay
        ev.note = (ev.note + f"; delayed {delay} days (simulated)").strip("; ")
        moved += ev.amount
    return moved


def _top_receivable_ids(snap: Snapshot, today: date, count: int, overdue_only: bool) -> set[str]:
    recs = [r for r in snap.receivables if r.outstanding > 0 and (not overdue_only or r.due_on < today)]
    recs.sort(key=lambda r: -r.outstanding)
    return {r.id for r in recs[:count]}


def apply_adjustment(comp: Components, snap: Snapshot, adj: dict[str, Any]) -> list[str]:
    """Mutate components for one adjustment. Returns human-readable notes."""
    kind = adj.get("type")
    if kind not in ALL_TYPES:
        raise AdjustmentError(f"Unknown adjustment type: {kind!r}")
    notes: list[str] = []
    H = comp.horizon
    label = adj.get("label")

    if kind in ("sales_decline", "sales_change"):
        pct = _num(adj, "percent", 20 if kind == "sales_decline" else 0, -100 if kind == "sales_change" else 0, 100 if kind == "sales_decline" else 200)
        w = _window(comp, adj, adj.get("duration_days"))
        factor = (1 - pct / 100) if kind == "sales_decline" else (1 + pct / 100)
        comp.var_in[w] *= factor
        notes.append(f"Everyday sales x{factor:.2f} from day {w.start} to day {w.stop - 1}")

    elif kind == "business_interruption":
        loss = _num(adj, "revenue_loss_percent", 100, 0, 100)
        w = _window(comp, adj, 7)
        comp.var_in[w] *= (1 - loss / 100)
        notes.append(f"Business interrupted days {w.start}-{w.stop - 1}: sales down {loss:.0f}%, fixed costs continue")

    elif kind == "flood_disruption":
        w = _window(comp, adj, 10)
        comp.var_in[w] *= (1 - _num(adj, "revenue_loss_percent", 80, 0, 100) / 100)
        repair = int(_num(adj, "repair_cost_paisa", 0, 0, 10**13))
        if repair:
            comp.events.append(Event(day=w.start, amount=-repair, kind="shock", label=label or "Flood repair cost",
                                     category="Repairs & Maintenance", certainty="simulated"))
        moved = _shift_receivables(comp, None, int(_num(adj, "receivable_delay_days", 14, 0, 120)), snap)
        notes.append(f"Flood/disruption days {w.start}-{w.stop - 1}; repairs {fmt_pkr(repair)}; "
                     f"{fmt_pkr(moved)} of collections delayed")

    elif kind == "delayed_payment":
        delay = int(_num(adj, "delay_days", 30, 1, 180))
        ids = set(adj.get("receivable_ids") or [])
        if not ids and not adj.get("customer_id"):
            ids = _top_receivable_ids(snap, comp.today, int(_num(adj, "top_n", 3, 1, 50)), overdue_only=False)
        moved = _shift_receivables(comp, ids or None, delay, snap, adj.get("customer_id"))
        notes.append(f"{fmt_pkr(moved)} of expected customer payments delayed by {delay} days")

    elif kind == "customer_loss":
        cust = adj.get("customer_id")
        if not cust:
            raise AdjustmentError("customer_loss: 'customer_id' is required")
        duration = int(_num(adj, "duration_days", 30, 1, 365))
        moved = _shift_receivables(comp, None, duration, snap, cust)
        share = _customer_sales_share(snap, comp.today, cust)
        w = _window(comp, {**adj, "start_day": 1}, duration)
        comp.var_in[w] *= (1 - share)
        notes.append(f"Customer paused for {duration} days: {fmt_pkr(moved)} collections pushed out and "
                     f"everyday sales reduced by their {share * 100:.0f}% share")

    elif kind in ("supplier_price_increase", "purchase_change"):
        pct = _num(adj, "percent", 15 if kind == "supplier_price_increase" else 0, -100, 200)
        start = int(_num(adj, "start_day", 1, 1, 365))
        factor = 1 + pct / 100
        comp.var_out["inventory"][start:] *= factor
        _scale_events(comp, lambda e: e.kind == "pipeline", factor, start)
        notes.append(f"Stock purchases x{factor:.2f} from day {start}")

    elif kind == "opex_change":
        pct = _num(adj, "percent", 0, -100, 200)
        factor = 1 + pct / 100
        for g in ("operating", "utilities", "discretionary"):
            comp.var_out[g][1:] *= factor
        notes.append(f"Everyday operating expenses x{factor:.2f}")

    elif kind == "utility_increase":
        pct = _num(adj, "percent", 25, 0, 300)
        factor = 1 + pct / 100
        comp.var_out["utilities"][1:] *= factor
        _scale_events(comp, lambda e: e.amount < 0 and is_utility(e.category), factor)
        notes.append(f"Utility bills x{factor:.2f}")

    elif kind == "income_change":
        # Personal finance: salary/allowance (monthly patterns) and everyday income both change by `percent`.
        pct = _num(adj, "percent", -20, -100, 200)
        factor = 1 + pct / 100
        w = _window(comp, adj, adj.get("duration_days"))
        comp.var_in[w] *= factor
        changed = 0
        for ev in comp.events:
            if ev.kind == "recurring_in" and w.start <= ev.day < w.stop:
                before = ev.amount
                ev.amount = int(round(ev.amount * factor))
                changed += ev.amount - before
        notes.append(f"Income x{factor:.2f} from day {w.start} to day {w.stop - 1}"
                     + (f" (monthly income changes by {fmt_pkr(changed)})" if changed else ""))

    elif kind == "income_delay":
        delay = int(_num(adj, "delay_days", 10, 1, 90))
        moved = 0
        for ev in comp.events:
            if ev.kind == "recurring_in":
                ev.day += delay
                ev.note = (ev.note + f"; arrives {delay} days late (simulated)").strip("; ")
                moved += ev.amount
        notes.append(f"{fmt_pkr(moved)} of salary/allowance arrives {delay} days late" if moved else
                     "No monthly income pattern was found in your records, so nothing was delayed.")

    elif kind == "rent_increase":
        pct = _num(adj, "percent", 10, 0, 300)
        start = int(_num(adj, "start_day", 1, 1, 365))
        factor = 1 + pct / 100
        rent_events = [e for e in comp.events if e.amount < 0 and e.day >= start and is_rent(e.category)]
        before = sum(e.amount for e in rent_events)
        _scale_events(comp, lambda e: e.amount < 0 and is_rent(e.category), factor, start)
        extra = sum(e.amount for e in rent_events) - before
        if rent_events:
            notes.append(f"Rent x{factor:.2f} from day {start}: {len(rent_events)} payment(s), {fmt_pkr(-extra)} more")
        else:
            notes.append("No rent payment falls inside the forecast window, so this shock changes nothing. "
                         "Record rent as a bill or let FinDost detect it from monthly history.")

    elif kind in ("unexpected_expense", "emergency_expense", "cash_injection"):
        amount = int(_num(adj, "amount_paisa", 0, 1, 10**13))
        day = int(_num(adj, "day", 1, 1, H))
        sign = 1 if kind == "cash_injection" else -1
        comp.events.append(Event(day=day, amount=sign * amount,
                                 kind="action" if sign > 0 else "shock",
                                 label=label or ("Cash injection" if sign > 0 else "Unexpected expense"),
                                 category="Financing" if sign > 0 else "Emergency", certainty="simulated"))
        notes.append(f"{'+' if sign > 0 else '-'}{fmt_pkr(amount)} on day {day}")

    elif kind == "move_receivable":
        rid = adj.get("receivable_id")
        new_date = _date(adj.get("expected_date"), "expected_date")
        moved = False
        for ev in comp.events:
            if ev.ref_type == "receivable" and ev.ref_id == rid:
                ev.day = (new_date - comp.today).days
                ev.note += "; date changed in what-if"
                moved = True
        if not moved:
            rec = next((r for r in snap.receivables if r.id == rid and r.outstanding > 0), None)
            if rec is None:
                raise AdjustmentError("move_receivable: open receivable not found")
            comp.events.append(Event(day=(new_date - comp.today).days, amount=rec.outstanding, kind="receivable",
                                     label=f"{rec.customer_name} {rec.reference or ''}".strip(),
                                     ref_type="receivable", ref_id=rec.id, certainty="simulated",
                                     note="collection date set in what-if"))
        notes.append(f"Receivable expected on {new_date.isoformat()}")

    elif kind == "move_payable":
        pid = adj.get("payable_id")
        new_date = _date(adj.get("due_date"), "due_date")
        found = False
        for ev in comp.events:
            if ev.ref_type == "payable" and ev.ref_id == pid:
                ev.day = (new_date - comp.today).days
                ev.note += "; date changed in what-if"
                found = True
        if not found:
            pay = next((p for p in snap.payables if p.id == pid and p.outstanding > 0), None)
            if pay is None:
                raise AdjustmentError("move_payable: open payable not found")
            comp.events.append(Event(day=(new_date - comp.today).days, amount=-pay.outstanding, kind="payable",
                                     label=pay.label, category=pay.category, ref_type="payable", ref_id=pay.id,
                                     certainty="simulated"))
        notes.append(f"Payable paid on {new_date.isoformat()}")

    elif kind == "revenue_recovery":
        # After a decline, sales ramp linearly back to the pre-shock level over N days.
        start = int(_num(adj, "start_day", 1, 1, H))
        days = int(_num(adj, "recover_days", 14, 1, 120))
        for d in range(start, H + 1):
            frac = min((d - start + 1) / days, 1.0)
            comp.var_in[d] = comp.var_in[d] + (comp.base_var_in[d] - comp.var_in[d]) * frac
        notes.append(f"Sales recover linearly to normal over {days} days from day {start}")

    elif kind == "collect_receivables":
        ids = set(adj.get("receivable_ids") or [])
        pct = _num(adj, "collect_percent", 50, 1, 100) / 100
        day = int(_num(adj, "day", 7, 1, H))
        total = 0
        for rec in snap.receivables:
            if rec.id in ids and rec.outstanding > 0:
                amount = int(round(rec.outstanding * pct))
                total += amount
                # The collected part arrives on `day`; reduce the already-expected event for this invoice.
                remaining = amount
                for ev in comp.events:
                    if ev.ref_type == "receivable" and ev.ref_id == rec.id and ev.amount > 0 and remaining > 0:
                        take = min(ev.amount, remaining)
                        ev.amount -= take
                        remaining -= take
                comp.events.append(Event(day=day, amount=amount, kind="action",
                                         label=f"Follow-up collection: {rec.customer_name}",
                                         category="Customer payment", ref_type="receivable", ref_id=rec.id,
                                         certainty="simulated"))
        notes.append(f"Collect {pct * 100:.0f}% ({fmt_pkr(total)}) of selected invoices by day {day}")

    elif kind == "request_partial_payment":
        ids = set(adj.get("receivable_ids") or [])
        pct = _num(adj, "percent", 40, 1, 100) / 100
        discount = _num(adj, "discount_percent", 2, 0, 20) / 100
        day = int(_num(adj, "day", 5, 1, H))
        total = cost = 0
        for rec in snap.receivables:
            if rec.id in ids and rec.outstanding > 0:
                part = int(round(rec.outstanding * pct))
                received = int(round(part * (1 - discount)))
                total += received
                cost += part - received
                remaining = part
                for ev in comp.events:
                    if ev.ref_type == "receivable" and ev.ref_id == rec.id and ev.amount > 0 and remaining > 0:
                        take = min(ev.amount, remaining)
                        ev.amount -= take
                        remaining -= take
                comp.events.append(Event(day=day, amount=received, kind="action",
                                         label=f"Early partial payment: {rec.customer_name}",
                                         category="Customer payment", ref_type="receivable", ref_id=rec.id,
                                         certainty="simulated"))
        notes.append(f"{pct * 100:.0f}% early from selected customers on day {day} "
                     f"({fmt_pkr(total)} received, {fmt_pkr(cost)} discount cost)")

    elif kind == "defer_payables":
        ids = set(adj.get("payable_ids") or [])
        days = int(_num(adj, "defer_days", 14, 1, 90))
        split = bool(adj.get("split", False))
        total = 0
        new_events = []
        for ev in comp.events:
            if ev.ref_type == "payable" and ev.ref_id in ids:
                total += -ev.amount
                if split:
                    half = ev.amount // 2
                    new_events.append(Event(day=ev.day + days, amount=ev.amount - half, kind="payable",
                                            label=ev.label + " (2nd half)", category=ev.category,
                                            ref_type="payable", ref_id=ev.ref_id, certainty="simulated"))
                    ev.amount = half
                    ev.note += "; split 50/50 (negotiated)"
                else:
                    ev.day += days
                    ev.note += f"; deferred {days} days (negotiated)"
        comp.events.extend(new_events)
        notes.append(f"{fmt_pkr(total)} of supplier bills {'split' if split else 'deferred'} by {days} days")

    elif kind == "reduce_discretionary":
        pct = _num(adj, "percent", 25, 1, 100) / 100
        comp.var_out["discretionary"][1:] *= (1 - pct)
        comp.var_out["operating"][1:] *= (1 - pct * _num(adj, "operating_share", 0, 0, 1))
        notes.append(f"Discretionary spending cut by {pct * 100:.0f}%")

    elif kind == "delay_purchases":
        pct = _num(adj, "percent", 30, 1, 100) / 100
        w = _window(comp, adj, 14)
        comp.var_out["inventory"][w] *= (1 - pct)
        for ev in comp.events:
            if ev.kind == "pipeline":
                purchase_day = ev.meta.get("purchase_day", ev.day)
                if w.start <= purchase_day < w.stop:
                    ev.amount = int(round(ev.amount * (1 - pct)))
        notes.append(f"Non-essential stock purchases cut {pct * 100:.0f}% for days {w.start}-{w.stop - 1}")

    elif kind == "liquidate_stock":
        amount = int(_num(adj, "expected_cash_paisa", 0, 0, 10**13))
        days = int(_num(adj, "days", 14, 1, H))
        if amount:
            per_day = amount / days
            comp.var_in[1:days + 1] += per_day
        notes.append(f"Clearance sale of slow-moving stock brings about {fmt_pkr(amount)} over {days} days")

    return notes


def _date(raw: Any, field: str) -> date:
    try:
        return date.fromisoformat(str(raw))
    except (TypeError, ValueError):
        raise AdjustmentError(f"'{field}' must be a date (YYYY-MM-DD)")


def _customer_sales_share(snap: Snapshot, today: date, customer_id: str) -> float:
    start = today - timedelta(days=60)
    total = cust = 0
    for t in snap.txs:
        if start <= t.occurred_on <= today and t.kind in ("income", "credit_sale"):
            total += t.amount
            if t.customer_id == customer_id:
                cust += t.amount
    return min(cust / total, 1.0) if total else 0.0


def simulate(snap: Snapshot, today: date, adjustments: list[dict], horizon: int = 30,
             base: Components | None = None) -> dict:
    """Project baseline and adjusted scenario; return both paths and the deltas."""
    base = base or build_components(snap, today, horizon)
    baseline = project(base)
    scenario = base.copy()
    notes: list[str] = []
    for adj in adjustments:
        notes.extend(apply_adjustment(scenario, snap, adj))
    for ev in scenario.events:  # moved items may fall outside the window
        ev.day = max(ev.day, 1)
    result = project(scenario)
    return {
        "baseline": baseline,
        "scenario": result,
        "notes": notes,
        "comparison": compare_paths(baseline, result),
        "disclaimer": "Simulation only - not an actual event or a certain prediction.",
    }


def compare_paths(baseline: dict, scenario: dict) -> dict:
    b, s = baseline["summary"], scenario["summary"]
    b_pts = np.array([p["balance_paisa"] for p in baseline["points"]], dtype=float)
    s_pts = np.array([p["balance_paisa"] for p in scenario["points"]], dtype=float)
    diff = s_pts - b_pts
    shortfall_b = float(-np.minimum(b_pts, 0).min())
    shortfall_s = float(-np.minimum(s_pts, 0).min())
    days_negative_b = int((b_pts[1:] < 0).sum())
    days_negative_s = int((s_pts[1:] < 0).sum())
    shift = None
    if b["days_to_shortage"] is not None and s["days_to_shortage"] is not None:
        shift = s["days_to_shortage"] - b["days_to_shortage"]
    return {
        "min_balance_change_paisa": s["min_balance_paisa"] - b["min_balance_paisa"],
        "end_balance_change_paisa": s["balance_end_paisa"] - b["balance_end_paisa"],
        "balance_d14_change_paisa": s["balance_d14_paisa"] - b["balance_d14_paisa"],
        "baseline_shortage_date": b["shortage_date"],
        "scenario_shortage_date": s["shortage_date"],
        "shortage_shift_days": shift,
        "baseline_max_shortfall_paisa": int(shortfall_b),
        "scenario_max_shortfall_paisa": int(shortfall_s),
        "baseline_days_negative": days_negative_b,
        "scenario_days_negative": days_negative_s,
        "max_gap_paisa": int(diff.min()) if len(diff) else 0,
        "creates_shortage": b["shortage_date"] is None and s["shortage_date"] is not None,
        "removes_shortage": b["shortage_date"] is not None and s["shortage_date"] is None,
        "additional_pressure_paisa": int(max(-(diff[-1] if len(diff) else 0), 0)),
    }


PERSONAL_PRESETS = [
    {"id": "income_late", "label": "Salary / allowance arrives 10 days late", "icon": "clock",
     "adjustments": [{"type": "income_delay", "delay_days": 10}]},
    {"id": "income_drop", "label": "Income falls 20% for a month", "icon": "trending-down",
     "adjustments": [{"type": "income_change", "percent": -20, "start_day": 1, "duration_days": 30}]},
    {"id": "personal_emergency", "label": "Unexpected expense Rs. 15,000 next week", "icon": "alert-triangle",
     "adjustments": [{"type": "unexpected_expense", "amount_paisa": 1_500_000, "day": 7, "label": "Unexpected expense"}]},
    {"id": "bills_up", "label": "Utility bills up 30%", "icon": "zap",
     "adjustments": [{"type": "utility_increase", "percent": 30}]},
    {"id": "rent_up", "label": "Rent up 10%", "icon": "home",
     "adjustments": [{"type": "rent_increase", "percent": 10}]},
]

SHOCK_PRESETS = [
    {"id": "sales_drop_20", "label": "Sales fall 20% for 3 weeks", "icon": "trending-down",
     "adjustments": [{"type": "sales_decline", "percent": 20, "start_day": 1, "duration_days": 21}]},
    {"id": "late_customers", "label": "Top 3 customers pay 30 days late", "icon": "clock",
     "adjustments": [{"type": "delayed_payment", "top_n": 3, "delay_days": 30}]},
    {"id": "supplier_hike", "label": "Supplier prices up 15%", "icon": "package",
     "adjustments": [{"type": "supplier_price_increase", "percent": 15, "start_day": 1}]},
    {"id": "electricity_spike", "label": "Electricity bill up 40% (summer)", "icon": "zap",
     "adjustments": [{"type": "utility_increase", "percent": 40}]},
    {"id": "rent_hike", "label": "Shop rent up 10%", "icon": "home",
     "adjustments": [{"type": "rent_increase", "percent": 10}]},
    {"id": "emergency", "label": "Emergency expense Rs. 50,000 next week", "icon": "alert-triangle",
     "adjustments": [{"type": "unexpected_expense", "amount_paisa": 5_000_000, "day": 7, "label": "Emergency expense"}]},
    {"id": "closure_week", "label": "Shop closed for 7 days", "icon": "store",
     "adjustments": [{"type": "business_interruption", "start_day": 3, "duration_days": 7, "revenue_loss_percent": 100}]},
    {"id": "flood", "label": "Flood disruption (10 days)", "icon": "cloud-rain",
     "adjustments": [{"type": "flood_disruption", "start_day": 2, "duration_days": 10, "revenue_loss_percent": 80,
                      "repair_cost_paisa": 6_000_000, "receivable_delay_days": 14}]},
]
