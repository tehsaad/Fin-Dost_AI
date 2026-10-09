"""Recovery strategy engine (Layer 5: decision support).

Candidate actions are generated from the business's own records (overdue
invoices, upcoming bills, discretionary spend, slow stock). Each candidate is
evaluated by re-running the scenario projection with that action added, so its
effect on the minimum balance and shortage date is calculated, never assumed.

Feasibility, cost and risk are explicit rule-based ratings with stated reasons;
they are judgement aids, not probabilities.
"""
from __future__ import annotations

from datetime import date, timedelta

from ..money import fmt_pkr
from .forecast import Components, build_components, project
from .inventory import inventory_analytics
from .simulation import apply_adjustment, compare_paths
from .snapshot import Snapshot

DEFAULT_WEIGHTS = {"liquidity": 0.45, "feasibility": 0.25, "cost": 0.15, "risk": 0.15}


def _run(base: Components, snap: Snapshot, adjustments: list[dict]) -> dict:
    comp = base.copy()
    for adj in adjustments:
        apply_adjustment(comp, snap, adj)
    for ev in comp.events:
        ev.day = max(ev.day, 1)
    return project(comp)


def generate_candidates(snap: Snapshot, today: date, scenario_result: dict, horizon: int) -> list[dict]:
    summary = scenario_result["summary"]
    focus_day = summary["days_to_shortage"] or (date.fromisoformat(summary["min_balance_date"]) - today).days or horizon
    focus_day = max(focus_day, 1)
    cands: list[dict] = []

    # 1. Follow up on overdue receivables (largest first), realistic partial collection.
    overdue = sorted([r for r in snap.receivables if r.outstanding > 0 and r.due_on < today],
                     key=lambda r: -r.outstanding)
    if overdue:
        top = overdue[:3]
        ages = [(today - r.due_on).days for r in top]
        pct = 60 if max(ages) <= 60 else 40
        total = sum(r.outstanding for r in top)
        cands.append({
            "id": "collect_overdue", "action_type": "collect_receivables",
            "title": f"Follow up on {len(top)} overdue customer{'s' if len(top) > 1 else ''}",
            "problem": f"{fmt_pkr(total)} is overdue from {', '.join(r.customer_name for r in top)}.",
            "action": f"Call or WhatsApp each customer this week and agree to collect about {pct}% within 7 days.",
            "adjustments": [{"type": "collect_receivables", "receivable_ids": [r.id for r in top],
                             "collect_percent": pct, "day": 7}],
            "timing": "Within 7 days",
            "feasibility": 0.7 if max(ages) <= 60 else 0.5,
            "feasibility_reason": f"invoices are {min(ages)}-{max(ages)} days overdue; older debts are harder to recover",
            "cost_paisa": 0, "risk": 0.2,
            "tradeoffs": "May strain customer relationships; collection is not guaranteed.",
            "assumptions": [f"{pct}% of the selected invoices is collected by day 7",
                            "the rest stays on its original expected date"],
            "evidence_quality": "high", "evidence": [f"{r.customer_name} {r.reference or ''}: {fmt_pkr(r.outstanding)}, "
                                                     f"{(today - r.due_on).days} days overdue" for r in top],
        })

    # 2. Ask customers with invoices due after the pressure point to pay part early.
    later = sorted([r for r in snap.receivables if r.outstanding > 0 and r.due_on >= today],
                   key=lambda r: -r.outstanding)[:3]
    if later:
        cands.append({
            "id": "partial_early", "action_type": "request_partial_payment",
            "title": "Request partial early payment (2% discount)",
            "problem": "Cash arrives after the pressure point while invoices are still open.",
            "action": f"Offer {', '.join(r.customer_name for r in later)} a 2% discount to pay 40% now.",
            "adjustments": [{"type": "request_partial_payment", "receivable_ids": [r.id for r in later],
                             "percent": 40, "discount_percent": 2, "day": 5}],
            "timing": "Within 5 days",
            "feasibility": 0.5, "feasibility_reason": "depends on customers having spare cash",
            "cost_paisa": int(sum(r.outstanding for r in later) * 0.4 * 0.02), "risk": 0.15,
            "tradeoffs": "Costs a 2% discount on the early portion.",
            "assumptions": ["40% of each selected invoice is paid on day 5 with a 2% discount"],
            "evidence_quality": "high",
            "evidence": [f"{r.customer_name}: {fmt_pkr(r.outstanding)} due {r.due_on.isoformat()}" for r in later],
        })

    # 3. Negotiate supplier payment schedule for bills due before the pressure point.
    window_end = today + timedelta(days=focus_day + 3)
    bills = sorted([p for p in snap.payables if p.outstanding > 0 and p.due_on <= window_end and p.supplier_id],
                   key=lambda p: -p.outstanding)[:3]
    if bills:
        cands.append({
            "id": "defer_suppliers", "action_type": "defer_payables",
            "title": "Negotiate 14 more days with suppliers",
            "problem": f"{fmt_pkr(sum(p.outstanding for p in bills))} of supplier bills fall due before the cash low point.",
            "action": f"Ask {', '.join(p.supplier_name or p.label for p in bills)} to split or move payment by 14 days.",
            "adjustments": [{"type": "defer_payables", "payable_ids": [p.id for p in bills], "defer_days": 14}],
            "timing": "Before the due dates",
            "feasibility": 0.45, "feasibility_reason": "suppliers may refuse or charge a late fee",
            "cost_paisa": 0, "risk": 0.4,
            "tradeoffs": "Suppliers may tighten credit terms or raise prices later. Late fees are not modelled.",
            "assumptions": ["the selected suppliers accept a 14-day extension"],
            "evidence_quality": "high",
            "evidence": [f"{p.label}: {fmt_pkr(p.outstanding)} due {p.due_on.isoformat()}" for p in bills],
        })

    # 4. Delay non-essential purchases (only when the business buys stock).
    if snap.kind in ("sme", "enterprise") and (scenario_result["summary"]["flows_by_source_paisa"].get("everyday_inventory", 0) != 0
                                               or any(e["kind"] == "pipeline" for e in scenario_result["events"])):
        cands.append({
            "id": "delay_purchases", "action_type": "delay_purchases",
            "title": "Delay non-essential stock purchases by 2 weeks",
            "problem": "Stock buying is a large share of outgoing cash.",
            "action": "Buy only fast-moving items for the next 14 days; postpone slow-moving bulk orders.",
            "adjustments": [{"type": "delay_purchases", "percent": 30, "start_day": 1, "duration_days": 14}],
            "timing": "Next 14 days",
            "feasibility": 0.65, "feasibility_reason": "under your control, but fast movers must stay in stock",
            "cost_paisa": 0, "risk": 0.35,
            "tradeoffs": "Risk of stock-outs and lost sales if demand rises.",
            "assumptions": ["stock purchases fall 30% for 14 days without reducing sales"],
            "evidence_quality": "medium", "evidence": ["based on your purchase history over the last 8 weeks"],
        })

    # 5. Reduce discretionary spending.
    disc = scenario_result["summary"]["flows_by_source_paisa"].get("everyday_discretionary", 0)
    if disc < 0:
        cands.append({
            "id": "cut_discretionary", "action_type": "reduce_discretionary",
            "title": "Cut discretionary spending by 30%",
            "problem": f"About {fmt_pkr(-disc)} of discretionary spending is expected over the forecast period.",
            "action": "Pause dining, shopping and other optional spending for the next month.",
            "adjustments": [{"type": "reduce_discretionary", "percent": 30}],
            "timing": "Immediately",
            "feasibility": 0.85, "feasibility_reason": "fully under your control",
            "cost_paisa": 0, "risk": 0.1,
            "tradeoffs": "Lifestyle or staff-welfare trade-offs.",
            "assumptions": ["discretionary categories drop 30% for the forecast period"],
            "evidence_quality": "medium", "evidence": ["based on your spending categories over the last 12 weeks"],
        })

    # 6. Clear slow-moving stock.
    inv = inventory_analytics(snap, today)
    slow = [p for p in inv["products"] if p["slow_moving"] and p["stock_value_paisa"] > 0]
    if slow:
        stock_retail = sum(p["quantity"] * p["sale_price_paisa"] for p in slow)
        expected = int(stock_retail * 0.40 * 0.90)
        margin_lost = int(stock_retail * 0.40 * 0.10)
        cands.append({
            "id": "clear_slow_stock", "action_type": "liquidate_stock",
            "title": "Clearance sale of slow-moving stock",
            "problem": f"{len(slow)} products have more than 60 days of stock on hand.",
            "action": f"Run a 10% discount on {', '.join(p['name'] for p in slow[:3])} for two weeks.",
            "adjustments": [{"type": "liquidate_stock", "expected_cash_paisa": expected, "days": 14}],
            "timing": "Next 14 days",
            "feasibility": 0.55, "feasibility_reason": "assumes 40% of that stock sells at the discount",
            "cost_paisa": margin_lost, "risk": 0.25,
            "tradeoffs": "Lower margin on discounted items.",
            "assumptions": ["40% of slow-moving stock sells within 14 days at a 10% discount"],
            "evidence_quality": "medium",
            "evidence": [f"{p['name']}: {p['quantity']} {p['unit']} on hand, ~{p['days_of_cover']} days of cover" for p in slow[:5]],
        })
    return cands


def recommend(snap: Snapshot, today: date, scenario_adjustments: list[dict], horizon: int = 30,
              weights: dict | None = None) -> dict:
    weights = {**DEFAULT_WEIGHTS, **(weights or {})}
    total_w = sum(max(float(v), 0) for v in weights.values()) or 1.0
    weights = {k: max(float(v), 0) / total_w for k, v in weights.items()}

    base = build_components(snap, today, horizon)
    baseline = project(base)
    scenario = _run(base, snap, scenario_adjustments)
    candidates = generate_candidates(snap, today, scenario, horizon)

    evaluated = []
    for cand in candidates:
        result = _run(base, snap, scenario_adjustments + cand["adjustments"])
        cmp = compare_paths(scenario, result)
        cand = {**cand, "result": result["summary"], "comparison": cmp,
                "points": [{"date": p["date"], "balance_paisa": p["balance_paisa"]} for p in result["points"]]}
        evaluated.append(cand)

    max_gain = max((c["comparison"]["min_balance_change_paisa"] for c in evaluated), default=0) or 1
    max_cost = max((c["cost_paisa"] for c in evaluated), default=0) or 1
    for c in evaluated:
        gain = max(c["comparison"]["min_balance_change_paisa"], 0)
        parts = {
            "liquidity": gain / max_gain if max_gain > 0 else 0.0,
            "feasibility": c["feasibility"],
            "cost": 1 - c["cost_paisa"] / max_cost,
            "risk": 1 - c["risk"],
        }
        c["score_parts"] = {k: round(v, 3) for k, v in parts.items()}
        c["score"] = round(sum(weights[k] * parts[k] for k in parts) * 100, 1)
        c["numerical_reasoning"] = (
            f"Raises the lowest projected balance by {fmt_pkr(c['comparison']['min_balance_change_paisa'])} "
            f"(from {fmt_pkr(scenario['summary']['min_balance_paisa'])} to {fmt_pkr(c['result']['min_balance_paisa'])})"
            + (f"; shortage {'removed' if c['comparison']['removes_shortage'] else 'moved'}"
               if scenario["summary"]["shortage_date"] else "")
        )
    evaluated.sort(key=lambda c: -c["score"])

    # Greedy combined plan: add best-ranked actions until the shortage disappears.
    plan_ids: list[str] = []
    plan_adj: list[dict] = []
    plan_result = scenario
    for c in evaluated:
        if plan_result["summary"]["shortage_date"] is None and plan_ids:
            break
        if c["comparison"]["min_balance_change_paisa"] <= 0:
            continue
        plan_ids.append(c["id"])
        plan_adj += c["adjustments"]
        plan_result = _run(base, snap, scenario_adjustments + plan_adj)
    combined = None
    if plan_ids:
        combined = {
            "action_ids": plan_ids,
            "result": plan_result["summary"],
            "comparison": compare_paths(scenario, plan_result),
            "points": [{"date": p["date"], "balance_paisa": p["balance_paisa"]} for p in plan_result["points"]],
        }

    info_only = [
        {"id": "review_unusual", "title": "Investigate unusual expenses",
         "detail": "Open the Alerts page and check any 'unusual transaction' flags. Unusual does not mean wrong - confirm with receipts.",
         "quantified": False},
        {"id": "support_programs", "title": "Explore verified business-support programmes",
         "detail": "Check eligibility for government or bank SME support (for example SMEDA advisory services or State Bank of Pakistan "
                   "SME finance schemes) on their official websites. FinDost does not estimate any financing amount.",
         "quantified": False},
    ]
    return {
        "weights": weights,
        "baseline": {"summary": baseline["summary"],
                     "points": [{"date": p["date"], "balance_paisa": p["balance_paisa"]} for p in baseline["points"]]},
        "scenario": {"summary": scenario["summary"],
                     "points": [{"date": p["date"], "balance_paisa": p["balance_paisa"]} for p in scenario["points"]],
                     "adjustments": scenario_adjustments},
        "strategies": evaluated,
        "combined_plan": combined,
        "information_only": info_only,
        "disclaimer": "Decision support only. Effects are calculated from your data under the stated assumptions; "
                      "outcomes are not guaranteed and FinDost does not replace a qualified adviser.",
    }


def compare_strategies(snap: Snapshot, today: date, scenario_adjustments: list[dict],
                       strategies: list[dict], horizon: int = 30) -> dict:
    """Side-by-side evaluation of user-chosen strategies (each a list of adjustments)."""
    base = build_components(snap, today, horizon)
    scenario = _run(base, snap, scenario_adjustments)
    rows = []
    for s in strategies:
        result = _run(base, snap, scenario_adjustments + list(s.get("adjustments", [])))
        rows.append({
            "id": s.get("id"), "label": s.get("label") or s.get("id"),
            "summary": result["summary"], "comparison": compare_paths(scenario, result),
            "points": [{"date": p["date"], "balance_paisa": p["balance_paisa"]} for p in result["points"]],
        })
    best = max(rows, key=lambda r: r["summary"]["min_balance_paisa"])["id"] if rows else None
    return {
        "scenario": {"summary": scenario["summary"],
                     "points": [{"date": p["date"], "balance_paisa": p["balance_paisa"]} for p in scenario["points"]]},
        "strategies": rows,
        "best_by_min_balance": best,
        "disclaimer": "Simulation only. Compare under the same assumptions; real outcomes depend on customers and suppliers.",
    }
