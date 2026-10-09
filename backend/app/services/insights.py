"""Dashboard KPIs, financial health index, data quality and report insights.

Every figure is computed from the business's records. Each KPI is labelled as
``actual`` (recorded), ``estimated`` (derived with a stated simplification) or
``forecast`` (projection) so the UI can show the distinction.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

import numpy as np

from ..money import fmt_pkr
from .ledger import (
    account_balances,
    inventory_value,
    payables_summary,
    period_summary,
    receivables_summary,
)
from .snapshot import Snapshot


def _clamp(x: float, lo: float = 0, hi: float = 100) -> float:
    return max(lo, min(hi, x))


def health_index(snap: Snapshot, today: date, forecast: dict, period30) -> dict:
    """0-100 index from five transparent components. Not a credit score or probability."""
    comps = []
    balance = account_balances(snap, today)["total"]
    daily_out = period30.cash_out / 30 if period30.cash_out else 0
    cover_days = balance / daily_out if daily_out else 60
    comps.append(("Liquidity", 25, _clamp(cover_days / 30 * 100),
                  f"Cash covers about {max(cover_days, 0):.0f} days of recent spending"))

    s = forecast["summary"]
    if s["shortage_date"] and s["days_to_shortage"] <= 14:
        fscore, ftext = 10, f"Projected shortage on {s['shortage_date']}"
    elif s["shortage_date"]:
        fscore, ftext = 35, f"Projected shortage on {s['shortage_date']} (beyond 2 weeks)"
    elif s["reserve_breach_date"]:
        fscore, ftext = 60, f"Projected to dip below your reserve on {s['reserve_breach_date']}"
    else:
        fscore, ftext = 90, "No shortage projected in the forecast window"
    comps.append(("Forecast safety", 25, fscore, ftext))

    rec = receivables_summary(snap, today)
    if rec["total_paisa"]:
        rscore = (1 - rec["overdue_paisa"] / rec["total_paisa"]) * 100
        comps.append(("Receivables quality", 15, rscore,
                      f"{fmt_pkr(rec['overdue_paisa'])} of {fmt_pkr(rec['total_paisa'])} owed to you is overdue"))

    if period30.revenue:
        margin = period30.profit / period30.revenue * 100
        label = "Savings rate" if snap.kind in ("household", "student") else "Profit margin"
        comps.append((label, 20, _clamp((margin + 10) / 25 * 100), f"{label} {margin:.1f}% over the last 30 days"))

    weekly = []
    for w in range(8):
        end = today - timedelta(days=7 * w)
        ps = period_summary(snap, end - timedelta(days=6), end)
        weekly.append(ps.cash_in - ps.cash_out)
    weekly = np.array(weekly, dtype=float)
    if np.abs(weekly).sum() > 0:
        cv = float(weekly.std() / (np.abs(weekly.mean()) + 1e-9))
        sscore = _clamp(100 - (cv - 0.3) / 1.2 * 80) if cv > 0.3 else 100
        comps.append(("Cash-flow stability", 15, sscore, "Week-to-week swings in net cash over 8 weeks"))

    total_w = sum(w for _, w, _, _ in comps)
    score = sum(w * v for _, w, v, _ in comps) / total_w if total_w else 0
    label = "Strong" if score >= 75 else "Fair" if score >= 55 else "Weak" if score >= 35 else "Critical"
    return {
        "score": round(score),
        "label": label,
        "components": [{"name": n, "weight": w, "score": round(v), "detail": d} for n, w, v, d in comps],
        "note": "Financial health index (0-100) built from the components shown. "
                "It is not a credit score, a rating of any person, or a probability.",
    }


def data_quality(snap: Snapshot, today: date) -> dict:
    txs = snap.txs
    issues = []
    if not txs:
        return {"score": 0, "history_days": 0, "issues": ["No transactions recorded yet."], "transactions": 0}
    first = min(t.occurred_on for t in txs)
    last = max(t.occurred_on for t in txs)
    history_days = (today - first).days
    uncategorized = sum(1 for t in txs if t.category in ("Uncategorized", "Miscellaneous", ""))
    stale = (today - last).days
    if history_days < 28:
        issues.append(f"Only {history_days} days of history; 8+ weeks gives better forecasts.")
    if uncategorized / len(txs) > 0.1:
        issues.append(f"{uncategorized} transactions are uncategorized or 'Miscellaneous'.")
    if stale > 3:
        issues.append(f"No transactions recorded in the last {stale} days; recent sales may be missing.")
    no_desc = sum(1 for t in txs if not t.description.strip())
    if no_desc / len(txs) > 0.2:
        issues.append(f"{no_desc} transactions have no description.")
    score = 100
    score -= 30 if history_days < 28 else 10 if history_days < 56 else 0
    score -= min(uncategorized / len(txs) * 100, 30)
    score -= min(stale * 5, 25)
    return {
        "score": round(_clamp(score)),
        "history_days": history_days,
        "transactions": len(txs),
        "first_date": first.isoformat(),
        "last_date": last.isoformat(),
        "uncategorized": uncategorized,
        "days_since_last_entry": stale,
        "issues": issues,
    }


def dashboard(snap: Snapshot, today: date, forecast: dict, alerts: list[dict], start: date, end: date,
              features: frozenset[str], recovery: dict | None = None) -> dict:
    balances = account_balances(snap, today)
    period = period_summary(snap, start, end)
    period30 = period_summary(snap, today - timedelta(days=29), today)
    rec = receivables_summary(snap, today)
    pay = payables_summary(snap, today, 14)
    s = forecast["summary"]
    pts = {p["day"]: p for p in forecast["points"]}

    kpis = {
        "cash_balance": {"value_paisa": balances["total"], "type": "actual",
                         "accounts": {k: balances[k] for k in ("cash", "bank", "wallet")}},
        "revenue": {"value_paisa": period.revenue, "type": "actual",
                    "cash_paisa": period.cash_revenue, "credit_paisa": period.credit_revenue},
        "expenses": {"value_paisa": period.expenses, "type": "actual"},
        "net_profit": {"value_paisa": period.profit, "type": "estimated",
                       "margin_pct": round(period.profit / period.revenue * 100, 1) if period.revenue else None,
                       "note": "Revenue minus expenses for the period. Stock purchases count as expenses when bought, "
                               "so this is an estimate, not an accountant's profit."},
        "receivables": {"value_paisa": rec["total_paisa"], "overdue_paisa": rec["overdue_paisa"],
                        "overdue_count": rec["overdue_count"], "type": "actual"},
        "upcoming_payables": {"value_paisa": pay["due_within_paisa"], "within_days": 14,
                              "count": len(pay["upcoming"]), "overdue_paisa": pay["overdue_paisa"], "type": "actual"},
        "expected_cash_7d": {"value_paisa": s["balance_d7_paisa"], "low_paisa": pts[7]["low_paisa"],
                             "high_paisa": pts[7]["high_paisa"], "type": "forecast"},
        "expected_cash_14d": {"value_paisa": s["balance_d14_paisa"], "low_paisa": pts[14]["low_paisa"],
                              "high_paisa": pts[14]["high_paisa"], "type": "forecast"},
        "shortage_risk": {"level": s["shortage_risk"], "shortage_date": s["shortage_date"],
                          "days_to_shortage": s["days_to_shortage"], "min_balance_paisa": s["min_balance_paisa"],
                          "min_balance_date": s["min_balance_date"], "type": "forecast"},
        "health": {**health_index(snap, today, forecast, period30), "type": "index"},
    }
    if "inventory" in features:
        kpis["inventory_value"] = {"value_paisa": inventory_value(snap), "type": "estimated",
                                   "note": "Stock on hand valued at purchase cost."}

    top_actions = []
    if recovery:
        for st in recovery["strategies"][:3]:
            top_actions.append({"id": st["id"], "title": st["title"], "timing": st["timing"],
                                "min_balance_change_paisa": st["comparison"]["min_balance_change_paisa"],
                                "removes_shortage": st["comparison"]["removes_shortage"]})

    total_exp = sum(period.expense_by_category.values()) or 1
    return {
        "as_of": today.isoformat(),
        "period": {"from": start.isoformat(), "to": end.isoformat()},
        "kpis": kpis,
        "forecast": {"history": forecast["history"],
                     "points": forecast["points"], "summary": s, "confidence": forecast["confidence"]},
        "alerts": alerts[:5],
        "alert_counts": {lvl: sum(1 for a in alerts if a["level"] == lvl) for lvl in ("critical", "high", "medium", "low")},
        "recommended_actions": top_actions,
        "expense_breakdown": [{"category": c, "amount_paisa": a, "share_pct": round(a / total_exp * 100, 1)}
                              for c, a in list(period.expense_by_category.items())[:8]],
        "revenue_breakdown": [{"category": c, "amount_paisa": a} for c, a in list(period.revenue_by_category.items())[:6]],
        "data_quality": data_quality(snap, today),
    }


def report_insights(snap: Snapshot, today: date, forecast: dict, inventory: dict | None, recovery: dict | None,
                    scenarios: list[dict]) -> list[dict]:
    out = []
    s = forecast["summary"]
    flows = s["flows_by_source_paisa"]
    if s["min_balance_paisa"] < s["opening_balance_paisa"]:
        outflows = sorted(((k, v) for k, v in flows.items() if v < 0), key=lambda kv: kv[1])[:3]
        names = {"payable": "recorded bills", "pipeline": "new stock on supplier credit", "recurring_out": "monthly bills",
                 "everyday_inventory": "everyday stock buying", "everyday_operating": "everyday running costs",
                 "everyday_discretionary": "optional spending", "everyday_utilities": "utilities"}
        out.append({
            "title": "Why the projected cash balance dips",
            "detail": f"From {fmt_pkr(s['opening_balance_paisa'])} today the lowest point is {fmt_pkr(s['min_balance_paisa'])} "
                      f"on {s['min_balance_date']}. The biggest outflows over the forecast are "
                      + ", ".join(f"{names.get(k, k)} ({fmt_pkr(-v)})" for k, v in outflows) + ".",
            "evidence": [f"{c['date']}: {c['label']} {fmt_pkr(c['amount_paisa'])}" for c in forecast["contributors"][:5]],
        })
    p90 = period_summary(snap, today - timedelta(days=89), today)
    total = sum(p90.expense_by_category.values())
    if total:
        top = list(p90.expense_by_category.items())[:3]
        out.append({
            "title": "Where the money goes (last 90 days)",
            "detail": "; ".join(f"{c}: {a / total * 100:.0f}% ({fmt_pkr(a)})" for c, a in top) + ".",
            "evidence": [f"Total expenses {fmt_pkr(total)}"],
        })
    contributing = [e for e in forecast["excluded"] if e["type"] == "receivable"]
    late = sorted([r for r in snap.receivables if r.outstanding and r.due_on < today], key=lambda r: -r.outstanding)
    if late:
        out.append({
            "title": "Invoices that weaken the cash position",
            "detail": f"{len(late)} overdue invoices total {fmt_pkr(sum(r.outstanding for r in late))}. "
                      f"The forecast only counts part of them, and {fmt_pkr(sum(e['amount_paisa'] for e in contributing))} "
                      "older than 90 days is treated as doubtful.",
            "evidence": [f"{r.customer_name} {r.reference or ''}: {fmt_pkr(r.outstanding)} ({(today - r.due_on).days} days overdue)"
                         for r in late[:5]],
        })
    if inventory and inventory["products"]:
        with_margin = [p for p in inventory["products"] if p["gross_margin_pct"] is not None and p["daily_demand"] > 0]
        if with_margin:
            best = sorted(with_margin, key=lambda p: -(p["sale_price_paisa"] - p["unit_cost_paisa"]) * p["daily_demand"])[:3]
            out.append({
                "title": "Products earning the most gross margin",
                "detail": ", ".join(f"{p['name']} (~{fmt_pkr(int((p['sale_price_paisa'] - p['unit_cost_paisa']) * p['daily_demand'] * 30))}/month, "
                                    f"{p['gross_margin_pct']}% margin)" for p in best) + ".",
                "evidence": ["Margin = (sale price - purchase cost) x average daily units sold x 30"],
            })
    for sc in scenarios[:2]:
        if sc.get("comparison"):
            c = sc["comparison"]
            out.append({
                "title": f"Shock test: {sc['name']}",
                "detail": f"Lowest balance changes by {fmt_pkr(c['min_balance_change_paisa'])}; "
                          + (f"shortage on {c['scenario_shortage_date']}." if c["scenario_shortage_date"] else "no shortage."),
                "evidence": sc.get("notes", [])[:3],
            })
    if recovery and recovery["strategies"]:
        best = recovery["strategies"][0]
        out.append({
            "title": "Best-ranked recovery option under current priorities",
            "detail": f"{best['title']}: {best['numerical_reasoning']}.",
            "evidence": best["assumptions"],
        })
    return out


def category_totals(snap: Snapshot, start: date, end: date) -> dict[str, int]:
    totals: dict[str, int] = defaultdict(int)
    for t in snap.txs:
        if start <= t.occurred_on <= end and t.kind in ("expense", "credit_purchase"):
            totals[t.category] += t.amount
    return dict(totals)
