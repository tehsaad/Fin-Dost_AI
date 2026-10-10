"""Cash-flow forecasting engine (Layers 1 and 3).

The projection is built from explicit, inspectable components:

1. Opening cash: the actual balance across cash, bank and wallet today.
2. Recorded future items: open receivables (expected collection date and a
   collection weight by age) and open payables (due dates).
3. Detected recurring items: monthly patterns in history (rent, salary, bills)
   that are not already entered as payables.
4. Supplier-credit pipeline: purchases made on credit after today are paid
   after the business's typical payment lag.
5. Everyday variable flows: day-of-week model of cash sales and cash
   expenses, chosen against a flat-average baseline by rolling back-tests.

Uncertainty comes from back-test errors, not from guesses. Historical
transactions are never invented: with too little history the variable part is
reduced or dropped and the forecast is marked low-confidence.
"""
from __future__ import annotations

import calendar
import copy
import hashlib
import json
import math
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from statistics import median

import numpy as np

from ..money import fmt_pkr
from .categories import expense_group
from .ledger import account_balances, daily_cash_balances
from .snapshot import Rec, Snapshot

Z80 = 1.2816  # two-sided 80% normal interval
GROUPS = ("inventory", "operating", "utilities", "discretionary")

# Share of an open receivable assumed collected, by how overdue it is.
COLLECTION_WEIGHTS = (
    (0, 0.95, "not yet due"),
    (30, 0.80, "1-30 days overdue"),
    (60, 0.60, "31-60 days overdue"),
    (90, 0.40, "61-90 days overdue"),
)
DOUBTFUL_AFTER_DAYS = 90
OVERDUE_EXPECTED_DAYS = 14  # overdue past the usual delay: assume ~2 more weeks


@dataclass
class Event:
    day: int
    amount: int  # signed paisa: + inflow, - outflow
    kind: str  # receivable | payable | recurring_in | recurring_out | pipeline | shock | action
    label: str
    category: str = ""
    ref_type: str | None = None
    ref_id: str | None = None
    certainty: str = "recorded"  # recorded | estimated | simulated
    note: str = ""
    meta: dict = field(default_factory=dict)


@dataclass
class Components:
    today: date
    horizon: int
    opening_balance: int
    reserve: int
    var_in: np.ndarray
    base_var_in: np.ndarray
    var_out: dict[str, np.ndarray]
    sigma_daily: float
    events: list[Event]
    model: dict
    assumptions: list[str]
    warnings: list[str]
    excluded: list[dict]
    recurring: list[dict]
    pipeline: dict | None
    history_days: int
    trend: dict

    def copy(self) -> "Components":
        return copy.deepcopy(self)

    def day_date(self, day: int) -> date:
        return self.today + timedelta(days=day)


# --------------------------------------------------------------------------- models

def cap_spikes(values: np.ndarray, k: float = 4.0) -> np.ndarray:
    """Cap one-off spikes at median + k * MAD so they don't distort everyday averages."""
    if len(values) < 7:
        return values
    med = float(np.median(values))
    mad = float(np.median(np.abs(values - med)))
    if mad == 0:
        return values
    return np.minimum(values, med + k * mad / 0.6745)


def _fit_flat(values: np.ndarray, _dates: list[date], window: int = 28):
    mean = float(values[-window:].mean()) if len(values) else 0.0
    return lambda dates: np.full(len(dates), mean)


def _fit_dow(values: np.ndarray, dates: list[date], weeks: int = 8, decay: float = 0.85):
    by_dow: dict[int, list[float]] = defaultdict(list)
    for v, d in zip(values[::-1], dates[::-1]):
        if len(by_dow[d.weekday()]) < weeks:
            by_dow[d.weekday()].append(float(v))
    overall = float(values.mean()) if len(values) else 0.0
    means = {}
    for dow in range(7):
        vals = by_dow.get(dow, [])
        if vals:
            w = np.array([decay**i for i in range(len(vals))])
            means[dow] = float(np.dot(w, vals) / w.sum())
        else:
            means[dow] = overall
    return lambda ds: np.array([means[d.weekday()] for d in ds])


MODELS = {
    "flat_28d_mean": ("Flat 28-day average (baseline)", _fit_flat),
    "weekday_seasonal": ("Weekday-seasonal weighted average", _fit_dow),
}


def _backtest(inflow: np.ndarray, outflow: np.ndarray, dates: list[date], fit, horizon: int = 7,
              n_origins: int = 4, min_train: int = 21) -> np.ndarray:
    errors: list[float] = []
    n = len(dates)
    for k in range(n_origins, 0, -1):
        origin = n - k * horizon
        if origin < min_train:
            continue
        test_dates = dates[origin:origin + horizon]
        pred_in = fit(inflow[:origin], dates[:origin])(test_dates)
        pred_out = fit(outflow[:origin], dates[:origin])(test_dates)
        actual_net = inflow[origin:origin + horizon] - outflow[origin:origin + horizon]
        errors.extend((actual_net - (pred_in - pred_out)).tolist())
    return np.array(errors)


# --------------------------------------------------------------------------- recurring

def _norm_desc(text: str) -> str:
    words = re.findall(r"[a-z]+", text.lower())
    return " ".join(w for w in words if w not in {"for", "the", "of", "month", "monthly"})[:40]


def detect_recurring(snap: Snapshot, today: date, lookback_days: int = 120) -> list[dict]:
    """Find monthly income/expense patterns (>= 2 occurrences ~30 days apart, stable amount)."""
    start = today - timedelta(days=lookback_days)
    groups: dict[tuple[str, str, str], list] = defaultdict(list)
    for tx in snap.txs:
        if tx.kind not in ("income", "expense", "owner_withdrawal", "loan_repayment") or not (start <= tx.occurred_on <= today):
            continue
        groups[(tx.kind, tx.category, _norm_desc(tx.description))].append(tx)
    found = []
    for (kind, category, desc), txs in groups.items():
        if len(txs) < 2:
            continue
        txs.sort(key=lambda t: t.occurred_on)
        dates = [t.occurred_on for t in txs]
        gaps = [(b - a).days for a, b in zip(dates, dates[1:])]
        amounts = np.array([t.amount for t in txs], dtype=float)
        cv = float(amounts.std() / amounts.mean()) if amounts.mean() else 1.0
        if not all(25 <= g <= 35 for g in gaps) or cv > 0.25:
            continue
        if (today - dates[-1]).days > 40:
            continue  # pattern stopped
        found.append({
            "key": f"{kind}|{category}|{desc}",
            "direction": "in" if kind == "income" else "out",
            "category": category,
            "label": txs[-1].description or category,
            "amount_paisa": int(round(median(amounts.tolist()))),
            "day_of_month": int(median([min(d.day, 28) for d in dates])),
            "last_date": dates[-1],
            "occurrences": len(txs),
            "tx_ids": [t.id for t in txs],
        })
    return found


def _next_monthly_dates(day_of_month: int, last: date, today: date, end: date) -> list[date]:
    out = []
    y, m = last.year, last.month
    for _ in range(4):
        m += 1
        if m > 12:
            y, m = y + 1, 1
        d = date(y, m, min(day_of_month, calendar.monthrange(y, m)[1]))  # 31st -> 30th / 28th / 29th
        if today < d <= end:
            out.append(d)
    return out


# --------------------------------------------------------------------------- receivables

def customer_delay_days(snap: Snapshot) -> tuple[dict[str, float], float]:
    """Average days late per customer from fully paid receivables (never negative)."""
    per: dict[str, list[int]] = defaultdict(list)
    for rec in snap.receivables:
        if rec.payments and rec.outstanding == 0:
            per[rec.customer_id].append(max((rec.payments[-1][0] - rec.due_on).days, 0))
    all_delays = [d for v in per.values() for d in v]
    overall = float(np.mean(all_delays)) if all_delays else 7.0
    return {k: float(np.mean(v)) for k, v in per.items()}, overall


def collection_weight(days_overdue: int) -> tuple[float, str]:
    for limit, weight, label in COLLECTION_WEIGHTS:
        if days_overdue <= limit:
            return weight, label
    return 0.0, f"over {DOUBTFUL_AFTER_DAYS} days overdue (treated as doubtful)"


def expected_collection(rec: Rec, today: date, delays: dict[str, float], overall: float) -> tuple[date, float, str]:
    """Expected collection date and weight for an open receivable.

    Not yet due, or overdue but still within this customer's usual delay:
    due date + their average delay (at least tomorrow). Already later than
    their usual pattern: assumed about 14 days from today.
    """
    days_overdue = (today - rec.due_on).days
    weight, why = collection_weight(days_overdue)
    if rec.expected_on and rec.expected_on > today:
        return rec.expected_on, weight, why + "; date set by you"
    delay = delays.get(rec.customer_id, overall)
    expected = rec.due_on + timedelta(days=round(delay))
    if expected <= today:
        return today + timedelta(days=OVERDUE_EXPECTED_DAYS), weight, why + "; later than this customer's usual pattern"
    return expected, weight, why


# --------------------------------------------------------------------------- build

def build_components(snap: Snapshot, today: date, horizon: int = 30) -> Components:
    horizon = max(7, min(int(horizon), 90))
    end = today + timedelta(days=horizon)
    assumptions: list[str] = []
    warnings: list[str] = []
    events: list[Event] = []
    excluded: list[dict] = []

    opening_balance = account_balances(snap, today)["total"]

    # ---- recurring patterns, skipping ones already scheduled as payables
    recurring = detect_recurring(snap, today)
    recurring_ids = {tid for r in recurring for tid in r["tx_ids"]}
    open_payables = [p for p in snap.payables if p.outstanding > 0]
    recurring_out = []
    for r in recurring:
        projected = []
        for d in _next_monthly_dates(r["day_of_month"], r["last_date"], today, end):
            if r["direction"] == "out" and any(
                p.category == r["category"] and abs((p.due_on - d).days) <= 7 for p in open_payables
            ):
                continue  # already entered as a bill
            projected.append(d)
            sign = 1 if r["direction"] == "in" else -1
            events.append(Event(
                day=(d - today).days, amount=sign * r["amount_paisa"],
                kind="recurring_in" if sign > 0 else "recurring_out", label=r["label"],
                category=r["category"], certainty="estimated",
                note=f"monthly pattern seen {r['occurrences']}x around day {r['day_of_month']}",
            ))
        recurring_out.append({
            "label": r["label"], "category": r["category"], "direction": r["direction"],
            "amount_paisa": r["amount_paisa"], "day_of_month": r["day_of_month"],
            "occurrences": r["occurrences"], "projected_dates": [d.isoformat() for d in projected],
        })
    if recurring:
        assumptions.append(
            f"{len(recurring)} monthly pattern(s) detected in history (e.g. rent, salary, bills) "
            "are projected unless already entered as a payable."
        )

    # ---- receivables
    delays, overall_delay = customer_delay_days(snap)
    for rec in snap.receivables:
        out = rec.outstanding
        if not out:
            continue
        expected, weight, why = expected_collection(rec, today, delays, overall_delay)
        if weight == 0:
            excluded.append({"type": "receivable", "id": rec.id, "label": f"{rec.customer_name} {rec.reference or ''}".strip(),
                             "amount_paisa": out, "reason": why})
            continue
        amount = int(round(out * weight))
        if expected <= end:
            events.append(Event(
                day=(expected - today).days, amount=amount, kind="receivable",
                label=f"{rec.customer_name} {rec.reference or ''}".strip(), category="Customer payment",
                ref_type="receivable", ref_id=rec.id, certainty="estimated",
                note=f"{int(weight * 100)}% of {fmt_pkr(out)} expected ({why})",
            ))
        if weight < 1:
            excluded.append({"type": "receivable_share", "id": rec.id,
                             "label": f"{rec.customer_name} {rec.reference or ''}".strip(),
                             "amount_paisa": out - amount, "reason": f"uncollected share assumed for {why}"})
    if any(r.outstanding for r in snap.receivables):
        assumptions.append(
            f"Customers are expected to pay on their due date plus their own average delay "
            f"(overall average {overall_delay:.0f} days); invoices already later than the customer's usual pattern "
            f"are assumed paid about {OVERDUE_EXPECTED_DAYS} days from today."
        )
        assumptions.append(
            "Each open receivable is weighted by age: 95% if not yet due, 80% for 1-30 days overdue, "
            "60% for 31-60, 40% for 61-90, and 0% after 90 days (shown separately as doubtful)."
        )

    # ---- payables
    for pay in open_payables:
        due = pay.due_on if pay.due_on > today else today + timedelta(days=1)
        if due <= end:
            events.append(Event(
                day=(due - today).days, amount=-pay.outstanding, kind="payable", label=pay.label,
                category=pay.category, ref_type="payable", ref_id=pay.id, certainty="recorded",
                note="overdue - assumed paid tomorrow" if pay.due_on <= today else f"due {pay.due_on.isoformat()}",
            ))
    if open_payables:
        assumptions.append("Payables are paid in full on their due date; overdue payables are assumed paid tomorrow.")

    # ---- history window for the variable model (complete days only: up to yesterday)
    tx_dates = [t.occurred_on for t in snap.txs if t.occurred_on < today]
    first = min(tx_dates) if tx_dates else today
    history_days = (today - first).days
    lookback = min(history_days, 84)
    var_in = np.zeros(horizon + 1)
    var_out = {g: np.zeros(horizon + 1) for g in GROUPS}
    sigma = 0.0
    model_info: dict = {"name": "none", "label": "No everyday-flow model", "history_days": history_days,
                        "band": {"method": "none", "sigma_daily_paisa": 0,
                                 "note": "Not enough history to estimate uncertainty, so no band is shown. "
                                         "The line only reflects recorded bills, invoices and detected patterns."}}

    if lookback >= 7:
        hist_dates = [today - timedelta(days=lookback - i) for i in range(lookback)]
        index = {d: i for i, d in enumerate(hist_dates)}
        h_in = np.zeros(lookback)
        h_out = {g: np.zeros(lookback) for g in GROUPS}
        for tx in snap.txs:
            i = index.get(tx.occurred_on)
            if i is None or tx.id in recurring_ids:
                continue
            if tx.kind == "income":
                h_in[i] += tx.amount
            elif tx.kind == "expense":
                h_out[expense_group(tx.category)][i] += tx.amount
        h_in = cap_spikes(h_in)
        h_out = {g: cap_spikes(v) for g, v in h_out.items()}
        h_out_total = sum(h_out.values())

        results = {}
        if lookback >= 28:
            for name, (label, fit) in MODELS.items():
                errs = _backtest(h_in, h_out_total, hist_dates, fit)
                if len(errs):
                    results[name] = {"label": label, "mae": float(np.abs(errs).mean()),
                                     "rmse": float(math.sqrt((errs ** 2).mean())), "n": int(len(errs))}
        if results:
            chosen = min(results, key=lambda k: results[k]["mae"])
            base = results["flat_28d_mean"]
            improvement = (base["mae"] - results[chosen]["mae"]) / base["mae"] * 100 if base["mae"] else 0.0
            sigma = results[chosen]["rmse"]
            weekly_income = float(h_in[-28:].sum() / 4) if lookback >= 28 else float(h_in.sum())
            model_info = {
                "name": chosen, "label": results[chosen]["label"], "history_days": history_days,
                "backtest": {k: {**v, "mae_paisa": int(v["mae"]), "rmse_paisa": int(v["rmse"])} for k, v in results.items()},
                "baseline": "flat_28d_mean", "improvement_pct": round(improvement, 1),
                "mae_paisa": int(results[chosen]["mae"]),
                "wape_pct": round(results[chosen]["mae"] * 7 / weekly_income * 100, 1) if weekly_income else None,
                "method": "rolling-origin back-test: 4 origins x 7-day horizon, trained only on data before each origin",
                "band": {"method": "backtest_rmse", "sigma_daily_paisa": int(sigma),
                         "note": "Band = 1.28 x back-test daily error (RMSE) x sqrt(days ahead): an 80% range for "
                                 "everyday sales/expense variation only. It does not include late customer payments or "
                                 "unrecorded bills, so the real range is wider (see the SDG Impact page for measured coverage)."},
            }
            fit = MODELS[chosen][1]
        else:
            fit = _fit_flat
            sigma = float((h_in - h_out_total).std()) if lookback > 1 else 0.0
            model_info = {"name": "flat_28d_mean", "label": "Flat average (short history, no back-test)",
                          "history_days": history_days,
                          "band": {"method": "history_std", "sigma_daily_paisa": int(sigma),
                                   "note": f"Rough band from the spread of {lookback} days of net flows; "
                                           "not back-tested, so treat it as indicative only."}}
            warnings.append(f"Only {history_days} days of history: everyday flows use a simple average and are not back-tested.")

        future_dates = [today + timedelta(days=d) for d in range(1, horizon + 1)]
        var_in[1:] = np.maximum(fit(h_in, hist_dates)(future_dates), 0)
        for g in GROUPS:
            var_out[g][1:] = np.maximum(fit(h_out[g], hist_dates)(future_dates), 0)
        assumptions.append(
            f"Everyday cash sales and expenses follow the last {lookback} days "
            f"({model_info['label'].lower()}); recurring items are projected separately and one-off spikes "
            "are capped (median + 4 MAD) so they don't distort the averages."
        )
    else:
        warnings.append("Not enough history (under 7 days) to model everyday sales and expenses; "
                        "the forecast only includes recorded receivables, payables and detected patterns.")

    # ---- supplier credit pipeline (purchases on credit after today, paid after the usual lag)
    pipeline = None
    window_start = today - timedelta(days=56)
    credit_buys = [t for t in snap.txs if t.kind == "credit_purchase" and window_start <= t.occurred_on < today]
    lags = [(p.payments[-1][0] - p.issued_on).days for p in snap.payables
            if p.payments and p.outstanding == 0 and p.supplier_id]
    if len(credit_buys) >= 3 and lags:
        days_span = max((today - window_start).days, 1)
        daily_purchase = sum(t.amount for t in credit_buys) / days_span
        lag = int(round(median(lags)))
        for d in range(1, horizon + 1):
            pay_day = d + lag
            if pay_day <= horizon:
                events.append(Event(day=pay_day, amount=-int(round(daily_purchase)), kind="pipeline",
                                    label="Supplier credit for new stock", category="Inventory Purchase",
                                    certainty="estimated", note=f"purchase on day {d}, paid after {lag} days",
                                    meta={"purchase_day": d}))
        pipeline = {"daily_purchase_paisa": int(daily_purchase), "payment_lag_days": lag,
                    "basis_purchases": len(credit_buys)}
        assumptions.append(
            f"New stock bought on supplier credit continues at about {fmt_pkr(int(daily_purchase * 7))} per week "
            f"(last 8 weeks) and is paid after your typical {lag}-day lag."
        )

    trend = _trend(snap, today)
    return Components(
        today=today, horizon=horizon, opening_balance=opening_balance, reserve=snap.reserve,
        var_in=var_in, base_var_in=var_in.copy(), var_out=var_out, sigma_daily=sigma, events=events, model=model_info,
        assumptions=assumptions, warnings=warnings, excluded=excluded, recurring=recurring_out,
        pipeline=pipeline, history_days=history_days, trend=trend,
    )


def _trend(snap: Snapshot, today: date) -> dict:
    """Net cash from everyday operations: last 4 weeks vs the 4 weeks before."""
    def net(a: date, b: date) -> int:
        total = 0
        for t in snap.txs:
            if a <= t.occurred_on < b and t.kind in ("income", "expense", "customer_payment", "supplier_payment"):
                total += t.amount if t.kind in ("income", "customer_payment") else -t.amount
        return total
    recent = net(today - timedelta(days=28), today)
    prior = net(today - timedelta(days=56), today - timedelta(days=28))
    change = recent - prior
    if abs(change) < max(abs(prior) * 0.05, 1):
        direction = "stable"
    else:
        direction = "improving" if change > 0 else "declining"
    return {"recent_4w_net_paisa": recent, "prior_4w_net_paisa": prior, "change_paisa": change, "direction": direction}


# --------------------------------------------------------------------------- projection

def project(comp: Components) -> dict:
    """Turn components into a daily balance path plus a summary."""
    H = comp.horizon
    event_in = np.zeros(H + 1)
    event_out = np.zeros(H + 1)
    for ev in comp.events:
        if 1 <= ev.day <= H:
            if ev.amount >= 0:
                event_in[ev.day] += ev.amount
            else:
                event_out[ev.day] += -ev.amount
    var_out_total = sum(comp.var_out.values())
    inflow = comp.var_in + event_in
    outflow = var_out_total + event_out
    net = inflow - outflow
    balance = comp.opening_balance + np.cumsum(net)
    balance[0] = comp.opening_balance
    days = np.arange(H + 1)
    spread = Z80 * comp.sigma_daily * np.sqrt(days)
    low, high = balance - spread, balance + spread

    points = []
    for d in range(H + 1):
        points.append({
            "date": comp.day_date(d).isoformat(), "day": d,
            "balance_paisa": int(round(balance[d])),
            "low_paisa": int(round(low[d])), "high_paisa": int(round(high[d])),
            "inflow_paisa": int(round(inflow[d])) if d else 0,
            "outflow_paisa": int(round(outflow[d])) if d else 0,
        })

    min_day = int(np.argmin(balance))
    shortage_day = next((d for d in range(1, H + 1) if balance[d] < 0), None)
    reserve_day = next((d for d in range(1, H + 1) if balance[d] < comp.reserve), None) if comp.reserve > 0 else None
    low_shortage_day = next((d for d in range(1, H + 1) if low[d] < 0), None)

    if shortage_day is not None and shortage_day <= 14:
        risk = "high"
    elif shortage_day is not None or (low_shortage_day is not None and low_shortage_day <= 14):
        risk = "medium"
    elif reserve_day is not None:
        risk = "watch"
    else:
        risk = "low"

    focus_day = shortage_day if shortage_day is not None else min_day
    contributors = sorted(
        [ev for ev in comp.events if ev.amount < 0 and 1 <= ev.day <= max(focus_day, 1)],
        key=lambda e: e.amount,
    )[:8]

    def bal(d: int) -> int:
        return int(round(balance[min(d, H)]))

    by_kind: dict[str, int] = defaultdict(int)
    for ev in comp.events:
        if 1 <= ev.day <= H:
            by_kind[ev.kind] += ev.amount
    by_kind["everyday_sales"] = int(round(comp.var_in.sum()))
    for g in GROUPS:
        by_kind[f"everyday_{g}"] = -int(round(comp.var_out[g].sum()))

    return {
        "points": points,
        "summary": {
            "opening_balance_paisa": comp.opening_balance,
            "balance_d7_paisa": bal(7),
            "balance_d14_paisa": bal(14),
            "balance_end_paisa": bal(H),
            "min_balance_paisa": int(round(balance[min_day])),
            "min_balance_date": comp.day_date(min_day).isoformat(),
            "shortage_date": comp.day_date(shortage_day).isoformat() if shortage_day is not None else None,
            "days_to_shortage": shortage_day,
            "reserve_paisa": comp.reserve,
            "reserve_breach_date": comp.day_date(reserve_day).isoformat() if reserve_day is not None else None,
            "total_inflow_paisa": int(round(inflow[1:].sum())),
            "total_outflow_paisa": int(round(outflow[1:].sum())),
            "shortage_risk": risk,
            "band_available": comp.model.get("band", {}).get("method", "none") != "none",
            # Runway = days until the projected balance first drops below zero (None: not within the horizon).
            "runway_days": shortage_day,
            "avg_daily_net_paisa": int(round((balance[H] - balance[0]) / H)),
            "runway_extrapolated_days": _extrapolated_runway(balance, H) if shortage_day is None else None,
            "flows_by_source_paisa": dict(by_kind),
        },
        "contributors": [_event_dict(ev, comp) for ev in contributors],
        "events": [_event_dict(ev, comp) for ev in sorted(comp.events, key=lambda e: (e.day, e.amount)) if 1 <= ev.day <= H],
    }


def _extrapolated_runway(balance: np.ndarray, horizon: int) -> int | None:
    """If cash is still positive at the horizon but falling on average, days until zero at that average rate.
    Clearly an extrapolation: only shown as such."""
    avg = (balance[horizon] - balance[0]) / horizon
    if avg >= 0 or balance[horizon] <= 0:
        return None
    return horizon + int(balance[horizon] // -avg)


def _event_dict(ev: Event, comp: Components) -> dict:
    return {
        "date": comp.day_date(ev.day).isoformat(), "day": ev.day, "amount_paisa": int(ev.amount),
        "kind": ev.kind, "label": ev.label, "category": ev.category, "ref_type": ev.ref_type,
        "ref_id": ev.ref_id, "certainty": ev.certainty, "note": ev.note,
    }


def confidence(comp: Components) -> dict:
    reasons = []
    score = 0
    if comp.history_days >= 56:
        score += 2
        reasons.append(f"{comp.history_days} days of history")
    elif comp.history_days >= 28:
        score += 1
        reasons.append(f"only {comp.history_days} days of history")
    else:
        reasons.append(f"very short history ({comp.history_days} days)")
    wape = comp.model.get("wape_pct")
    if wape is not None:
        if wape <= 15:
            score += 2
        elif wape <= 30:
            score += 1
        reasons.append(f"back-test weekly error about {wape:.0f}% of weekly sales")
    estimated = sum(abs(e.amount) for e in comp.events if e.certainty == "estimated")
    recorded = sum(abs(e.amount) for e in comp.events if e.certainty == "recorded")
    if recorded >= estimated:
        score += 1
        reasons.append("most known items are recorded bills/invoices")
    else:
        reasons.append("many items are estimated from patterns")
    level = "high" if score >= 4 else "medium" if score >= 2 else "low"
    return {"level": level, "reasons": reasons}


def run_forecast(snap: Snapshot, today: date, horizon: int = 30, history_days: int = 30) -> dict:
    comp = build_components(snap, today, horizon)
    result = project(comp)
    hist = daily_cash_balances(snap, today - timedelta(days=history_days), today)
    result["history"] = [{"date": d.isoformat(), "balance_paisa": b} for d, b in hist]
    result["model"] = comp.model
    result["confidence"] = confidence(comp)
    result["assumptions"] = comp.assumptions
    result["warnings"] = comp.warnings
    result["excluded"] = comp.excluded
    result["recurring"] = comp.recurring
    result["pipeline"] = comp.pipeline
    result["trend"] = comp.trend
    result["horizon_days"] = comp.horizon
    result["as_of"] = today.isoformat()
    result["disclaimer"] = ("Forecast values are estimates built from your recorded data and stated assumptions. "
                            "They are not guaranteed outcomes or financial advice.")
    return result


def input_hash(snap: Snapshot, today: date) -> str:
    payload = {
        "today": today.isoformat(), "opening": snap.opening, "reserve": snap.reserve,
        "tx": [(t.id, t.occurred_on.isoformat(), t.kind, t.amount) for t in snap.txs],
        "rec": [(r.id, r.due_on.isoformat(), r.amount, r.expected_on.isoformat() if r.expected_on else None) for r in snap.receivables],
        "pay": [(p.id, p.due_on.isoformat(), p.amount) for p in snap.payables],
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
