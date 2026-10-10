"""Early-warning intelligence (Layers 2 and 3).

Explainable rules over the ledger and the forecast, plus statistical anomaly
detection (robust z-score on amounts within a category). Every alert carries:
level, a 0-100 severity index (rule-based, NOT a probability), the triggering
evidence, amounts and dates, contributing records, a next step and its
limitations. "Unusual" never means "fraudulent".
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

import numpy as np

import re

from ..money import fmt_pkr
from .forecast import detect_recurring
from .snapshot import Snapshot, Tx

SCORE_NOTE = "Severity index from rule thresholds (0-100). It ranks urgency; it is not a probability."


def level_for(score: int) -> str:
    return "critical" if score >= 80 else "high" if score >= 60 else "medium" if score >= 40 else "low"


def _tx_dict(t: Tx) -> dict:
    return {"id": t.id, "date": t.occurred_on.isoformat(), "description": t.description, "kind": t.kind,
            "category": t.category, "amount_paisa": t.amount}


def _records(transactions: list[dict], items: list[dict], item_type: str | None) -> list[dict]:
    """Stable references to the ledger records behind an alert."""
    refs = [{"type": "transaction", "id": t["id"]} for t in transactions]
    for it in items:
        if it.get("ref_type") and it.get("ref_id"):
            refs.append({"type": it["ref_type"], "id": it["ref_id"]})
        elif item_type and it.get("id"):
            refs.append({"type": item_type, "id": it["id"]})
    seen, out = set(), []
    for r in refs:
        if (r["type"], r["id"]) not in seen:
            seen.add((r["type"], r["id"]))
            out.append(r)
    return out


def _alert(rule: str, key: str, score: int, title: str, explanation: str, *, evidence=None, amounts=None,
           dates=None, transactions=None, items=None, item_type: str | None = None, impact_paisa: int | None = None,
           impact_label: str | None = None, next_step: str, limitations: str, link: str) -> dict:
    score = int(max(0, min(score, 100)))
    transactions, items = transactions or [], items or []
    return {
        "rule": rule, "entity_key": key, "score": score, "level": level_for(score), "title": title,
        "explanation": explanation, "evidence": evidence or [], "amounts": amounts or {}, "dates": dates or {},
        "transactions": transactions, "items": items, "records": _records(transactions, items, item_type),
        "impact_paisa": int(impact_paisa) if impact_paisa is not None else None, "impact_label": impact_label,
        "next_step": next_step, "limitations": limitations, "link": link, "score_note": SCORE_NOTE,
    }


def _desc_key(text: str) -> str:
    """First two meaningful words: groups 'Loader rickshaw (mandi)' entries together."""
    words = [w for w in re.findall(r"[a-z]+", text.lower()) if len(w) >= 3 and w not in {"the", "and", "for", "from"}]
    return " ".join(words[:2])


def _revenue(snap: Snapshot, start: date, end: date, exclude: set[str]) -> tuple[int, int]:
    total = count = 0
    for t in snap.txs:
        if start <= t.occurred_on <= end and t.kind in ("income", "credit_sale") and t.id not in exclude:
            total += t.amount
            count += 1
    return total, count


def detect_anomalies(snap: Snapshot, today: date, recent_days: int = 30) -> list[dict]:
    """Robust z-score (median/MAD) of expense amounts within each category, plus near-duplicates."""
    flagged = []
    start = today - timedelta(days=120)
    by_cat: dict[tuple[str, str], list[Tx]] = defaultdict(list)
    for t in snap.txs:
        if t.kind in ("expense", "credit_purchase") and start <= t.occurred_on <= today:
            by_cat[(t.category, _desc_key(t.description))].append(t)
    for (cat, _key), txs in by_cat.items():
        if len(txs) < 8:
            continue
        amounts = np.array([t.amount for t in txs], dtype=float)
        med = float(np.median(amounts))
        mad = float(np.median(np.abs(amounts - med)))
        if mad == 0:
            continue
        for t in txs:
            if (today - t.occurred_on).days > recent_days:
                continue
            z = 0.6745 * (t.amount - med) / mad
            if z >= 3.5 and t.amount >= 2 * med:
                flagged.append({**_tx_dict(t), "reason": f"{t.amount / med:.1f}x the usual {cat} amount "
                                                         f"(typical {fmt_pkr(int(med))}, robust z {z:.1f})",
                                "z_score": round(z, 1), "type": "amount_outlier"})
    # near-duplicates: same amount and description within 2 days
    recent = sorted([t for t in snap.txs if (today - t.occurred_on).days <= recent_days and t.kind in ("expense", "supplier_payment")],
                    key=lambda t: t.occurred_on)
    for i, a in enumerate(recent):
        for b in recent[i + 1:]:
            if (b.occurred_on - a.occurred_on).days > 2:
                break
            if (a.amount == b.amount and a.amount >= 100_000 and a.description
                    and a.description.strip().lower() == b.description.strip().lower()):
                flagged.append({**_tx_dict(b), "reason": f"same amount and description as {a.occurred_on.isoformat()} - possible duplicate entry",
                                "type": "possible_duplicate", "duplicate_of": a.id})
    return flagged


def compute_alerts(snap: Snapshot, today: date, forecast: dict, inventory: dict | None = None) -> list[dict]:
    alerts: list[dict] = []
    s = forecast["summary"]
    tx_by_id = snap.tx_by_id()

    # 1. Projected shortage
    if s["shortage_date"]:
        days = s["days_to_shortage"]
        score = 95 if days <= 7 else 80 if days <= 14 else 60
        contributors = forecast["contributors"][:6]
        alerts.append(_alert(
            "projected_shortage", "cash", score,
            f"Cash may run out on {s['shortage_date']} (in {days} days)",
            f"Starting from {fmt_pkr(s['opening_balance_paisa'])} today, the projected balance falls to "
            f"{fmt_pkr(s['min_balance_paisa'])} on {s['min_balance_date']}.",
            evidence=[f"{c['date']}: {c['label']} {fmt_pkr(c['amount_paisa'])} ({c['certainty']})" for c in contributors],
            amounts={"opening_balance": s["opening_balance_paisa"], "minimum_balance": s["min_balance_paisa"]},
            dates={"shortage": s["shortage_date"], "minimum": s["min_balance_date"]},
            items=contributors,
            impact_paisa=-s["min_balance_paisa"], impact_label="Cash gap at the lowest point",
            next_step="Open the Recovery page to compare collection, supplier and spending options.",
            limitations="Depends on the forecast assumptions (customer payment timing, everyday sales). "
                        "See the Forecast page for the model's back-test error.",
            link="/recovery",
        ))

    # 2. Reserve breach
    if s["reserve_paisa"] > 0:
        if s["opening_balance_paisa"] < s["reserve_paisa"]:
            alerts.append(_alert(
                "reserve_breach", "now", 70, "Cash is already below your safety reserve",
                f"Balance {fmt_pkr(s['opening_balance_paisa'])} is below your reserve of {fmt_pkr(s['reserve_paisa'])}.",
                amounts={"balance": s["opening_balance_paisa"], "reserve": s["reserve_paisa"]},
                impact_paisa=s["reserve_paisa"] - s["opening_balance_paisa"], impact_label="Needed to restore the reserve",
                next_step="Hold non-essential payments until the reserve is rebuilt.",
                limitations="The reserve level is your own setting.", link="/forecast"))
        elif s["reserve_breach_date"]:
            breach = date.fromisoformat(s["reserve_breach_date"])
            causing = [e for e in forecast["events"] if e["amount_paisa"] < 0 and e["kind"] in ("payable", "recurring_out")
                       and date.fromisoformat(e["date"]) <= breach][-3:]
            alerts.append(_alert(
                "reserve_breach", "projected", 55, f"Cash projected below your reserve on {s['reserve_breach_date']}",
                f"Your reserve is {fmt_pkr(s['reserve_paisa'])}; the projection dips to {fmt_pkr(s['min_balance_paisa'])}."
                + (" Bills due by then: " + ", ".join(f"{e['label']} {fmt_pkr(-e['amount_paisa'])} on {e['date']}" for e in causing) + "."
                   if causing else ""),
                evidence=[f"{e['date']}: {e['label']} {fmt_pkr(-e['amount_paisa'])} ({e['certainty']})" for e in causing],
                items=causing,
                impact_paisa=s["reserve_paisa"] - s["min_balance_paisa"], impact_label="Shortfall below the reserve",
                amounts={"reserve": s["reserve_paisa"], "minimum_balance": s["min_balance_paisa"]},
                dates={"breach": s["reserve_breach_date"]},
                next_step="Review upcoming bills on the Forecast page.",
                limitations="Forecast-based; see assumptions on the Forecast page.", link="/forecast"))

    # 3. Scheduled obligations that may not be covered
    points = {p["day"]: p["balance_paisa"] for p in forecast["points"]}
    at_risk = [e for e in forecast["events"] if e["kind"] == "payable" and e["day"] <= 14 and points.get(e["day"], 0) < 0]
    if at_risk:
        total = -sum(e["amount_paisa"] for e in at_risk)
        alerts.append(_alert(
            "obligations_at_risk", "next14", 75 if len(at_risk) > 1 else 65,
            f"{len(at_risk)} bill(s) due in the next 14 days may not be covered",
            f"{fmt_pkr(total)} of scheduled payments fall on days when the projected balance is negative.",
            evidence=[f"{e['date']}: {e['label']} {fmt_pkr(-e['amount_paisa'])}" for e in at_risk],
            amounts={"total_due": total}, items=at_risk, impact_paisa=total, impact_label="Bills that may not be covered",
            next_step="Talk to these suppliers early about timing, or collect overdue invoices first.",
            limitations="Assumes bills are paid in full on their due dates.", link="/recovery"))

    # 4. Revenue decline (last 14 days vs the 28 days before, scaled), recurring income excluded
    recurring = detect_recurring(snap, today)
    recurring_ids = {tid for r in recurring for tid in r["tx_ids"]}
    recent, _ = _revenue(snap, today - timedelta(days=13), today, recurring_ids)
    prior_total, prior_count = _revenue(snap, today - timedelta(days=41), today - timedelta(days=14), recurring_ids)
    prior = prior_total / 2
    if prior_count >= 6 and prior > 0 and recent < prior * 0.85:
        drop = (prior - recent) / prior * 100
        alerts.append(_alert(
            "revenue_decline", "14d", 50 + min(int(drop), 45),
            f"Revenue down {drop:.0f}% in the last 14 days",
            f"{fmt_pkr(recent)} in the last 14 days vs an average of {fmt_pkr(int(prior))} per 14 days before "
            "(monthly salary/allowance excluded).",
            amounts={"recent_14d": recent, "prior_avg_14d": int(prior)},
            impact_paisa=int(prior - recent), impact_label="Less revenue than usual (14 days)",
            dates={"from": (today - timedelta(days=13)).isoformat(), "to": today.isoformat()},
            next_step="Check whether fewer customers, lower prices or missing entries explain the drop.",
            limitations="Unrecorded sales look like a decline. Seasonal dips (e.g. after Eid) are normal.",
            link="/transactions"))

    # 4b. Recurring bill increases (e.g. electricity), latest vs earlier occurrences
    by_id = snap.tx_by_id()
    for r in recurring:
        if r["direction"] != "out" or r["occurrences"] < 2:
            continue
        txs = sorted((by_id[i] for i in r["tx_ids"] if i in by_id), key=lambda t: t.occurred_on)
        latest, earlier = txs[-1], [t.amount for t in txs[:-1]]
        typical = float(np.median(earlier))
        if typical > 0 and latest.amount >= typical * 1.15 and (today - latest.occurred_on).days <= 35:
            rise = (latest.amount / typical - 1) * 100
            alerts.append(_alert(
                "bill_increase", r["key"][:80], 40 + min(int(rise), 30),
                f"{r['label']} up {rise:.0f}% vs usual",
                f"Latest {fmt_pkr(latest.amount)} on {latest.occurred_on.isoformat()} vs a typical {fmt_pkr(int(typical))}.",
                transactions=[_tx_dict(t) for t in txs],
                amounts={"latest": latest.amount, "typical": int(typical)},
                impact_paisa=latest.amount - int(typical), impact_label="Extra cost on the latest bill",
                next_step="Check the bill for tariff or usage changes; the next one is already in the forecast.",
                limitations="Seasonal bills (summer electricity, winter gas) naturally rise and fall.",
                link="/forecast"))

    # 5. Expense spikes by category (last 14 days vs prior 8 weeks)
    recent_cat: dict[str, list[Tx]] = defaultdict(list)
    base_cat: dict[str, int] = defaultdict(int)
    for t in snap.txs:
        if t.kind not in ("expense", "credit_purchase") or t.id in recurring_ids:
            continue
        age = (today - t.occurred_on).days
        if 0 <= age < 14:
            recent_cat[t.category].append(t)
        elif 14 <= age < 70:
            base_cat[t.category] += t.amount
    monthly_rev = max(_revenue(snap, today - timedelta(days=29), today, set())[0], 1)
    for cat, txs in recent_cat.items():
        spent = sum(t.amount for t in txs)
        expected = base_cat.get(cat, 0) / 4  # 56 days -> per 14 days
        extra = spent - expected
        if expected > 0 and spent >= expected * 1.5 and extra >= max(monthly_rev * 0.02, 500_000):
            ratio = spent / expected
            alerts.append(_alert(
                "expense_spike", cat, 45 + min(int((ratio - 1.5) * 20), 35),
                f"{cat} spending is {ratio:.1f}x its usual level",
                f"{fmt_pkr(spent)} in the last 14 days vs about {fmt_pkr(int(expected))} normally ({fmt_pkr(int(extra))} extra).",
                transactions=[_tx_dict(t) for t in sorted(txs, key=lambda t: -t.amount)[:6]],
                amounts={"recent_14d": spent, "usual_14d": int(expected), "extra": int(extra)},
                impact_paisa=int(extra), impact_label="Spent above the usual level",
                next_step="Check whether this is a planned purchase, a price rise or a one-off.",
                limitations="Compares with your own last 8 weeks only; planned bulk buys can trigger this.",
                link="/transactions"))

    # 6. Overdue receivables
    overdue = sorted([r for r in snap.receivables if r.outstanding > 0 and r.due_on < today], key=lambda r: -r.outstanding)
    if overdue:
        total = sum(r.outstanding for r in overdue)
        oldest = max((today - r.due_on).days for r in overdue)
        alerts.append(_alert(
            "overdue_receivables", "all", 50 + min(oldest // 3, 40),
            f"{fmt_pkr(total)} overdue from {len(overdue)} customer invoice(s)",
            f"The oldest is {oldest} days past due.",
            evidence=[f"{r.customer_name} {r.reference or ''}: {fmt_pkr(r.outstanding)}, {(today - r.due_on).days} days overdue"
                      for r in overdue[:6]],
            amounts={"total_overdue": total}, dates={"oldest_due": min(r.due_on for r in overdue).isoformat()},
            items=[{"id": r.id, "customer": r.customer_name, "reference": r.reference, "outstanding_paisa": r.outstanding,
                    "days_overdue": (today - r.due_on).days} for r in overdue[:10]],
            item_type="receivable", impact_paisa=total, impact_label="Overdue money owed to you",
            next_step="Send polite payment reminders from the Khata page, largest and oldest first.",
            limitations="A late payment is not a judgement about the customer; there may be a dispute or a simple delay.",
            link="/transactions?tab=receivables"))

    # 7. Credit exposure and concentration
    open_recs = [r for r in snap.receivables if r.outstanding > 0]
    total_rec = sum(r.outstanding for r in open_recs)
    if total_rec and monthly_rev > 1:
        ratio = total_rec / monthly_rev
        if ratio >= 0.5:
            alerts.append(_alert(
                "credit_exposure", "total", 45 + min(int(ratio * 20), 40),
                f"Customer credit equals {ratio * 100:.0f}% of a month's revenue",
                f"{fmt_pkr(total_rec)} is owed to you vs {fmt_pkr(monthly_rev)} revenue in the last 30 days.",
                amounts={"receivables": total_rec, "monthly_revenue": monthly_rev},
                items=[{"id": r.id} for r in open_recs[:20]], item_type="receivable",
                impact_paisa=total_rec, impact_label="Cash tied up in customer credit",
                next_step="Consider credit limits or shorter terms for new credit sales.",
                limitations="Uses the last 30 days of revenue; seasonal businesses vary.",
                link="/transactions?tab=receivables"))
        by_cust: dict[str, int] = defaultdict(int)
        for r in open_recs:
            by_cust[r.customer_name] += r.outstanding
        top_name, top_amt = max(by_cust.items(), key=lambda kv: kv[1])
        if len(by_cust) >= 2 and top_amt / total_rec >= 0.35:
            alerts.append(_alert(
                "customer_concentration", top_name, 45, f"{top_name} holds {top_amt / total_rec * 100:.0f}% of your receivables",
                f"{fmt_pkr(top_amt)} of {fmt_pkr(total_rec)} owed to you is from one customer.",
                amounts={"customer": top_amt, "total": total_rec},
                items=[{"id": r.id} for r in open_recs if r.customer_name == top_name], item_type="receivable",
                impact_paisa=top_amt, impact_label="Owed by this customer",
                next_step="Avoid extending more credit to this customer until older invoices are paid.",
                limitations="Concentration is a risk signal, not a statement about the customer.",
                link="/transactions?tab=receivables"))

    # 8. Supplier concentration (last 60 days of purchases)
    by_sup: dict[str, int] = defaultdict(int)
    for t in snap.txs:
        if t.kind in ("credit_purchase", "expense") and t.supplier_id and (today - t.occurred_on).days <= 60:
            by_sup[snap.suppliers.get(t.supplier_id, "Supplier")] += t.amount
    total_sup = sum(by_sup.values())
    if total_sup and len(by_sup) >= 2:
        name, amt = max(by_sup.items(), key=lambda kv: kv[1])
        if amt / total_sup >= 0.5:
            alerts.append(_alert(
                "supplier_concentration", name, 40, f"{amt / total_sup * 100:.0f}% of purchases come from {name}",
                f"{fmt_pkr(amt)} of {fmt_pkr(total_sup)} purchases in the last 60 days.",
                amounts={"supplier": amt, "total": total_sup},
                impact_paisa=amt, impact_label="Purchases from this supplier (60 days)",
                next_step="Keep a second supplier for key items to reduce dependence on one source.",
                limitations="Some products only have one distributor; this may be unavoidable.", link="/transactions"))

    # 9. Unusual transactions
    for a in detect_anomalies(snap, today):
        alerts.append(_alert(
            "unusual_transaction", a["id"], 42 if a["type"] == "amount_outlier" else 38,
            ("Unusual amount: " if a["type"] == "amount_outlier" else "Possible duplicate: ") + (a["description"] or a["category"]),
            a["reason"],
            transactions=[{k: a[k] for k in ("id", "date", "description", "kind", "category", "amount_paisa")}]
            + ([_tx_dict(tx_by_id[a["duplicate_of"]])] if a.get("duplicate_of") in tx_by_id else []),
            amounts={"amount": a["amount_paisa"]}, dates={"date": a["date"]},
            impact_paisa=a["amount_paisa"], impact_label="Amount to check",
            next_step="Check the receipt. If it is correct, no action is needed.",
            limitations="Statistical outlier only. Unusual does not mean wrong or fraudulent.",
            link="/transactions"))

    # 10. Slow-moving inventory
    if inventory:
        slow = [p for p in inventory["products"] if p["slow_moving"] and p["stock_value_paisa"] > 0]
        if slow:
            value = sum(p["stock_value_paisa"] for p in slow)
            alerts.append(_alert(
                "slow_inventory", "all", 40 + min(int(value / max(inventory["total_value_paisa"], 1) * 50), 30),
                f"{fmt_pkr(value)} tied up in {len(slow)} slow-moving product(s)",
                "These items have more than 60 days of stock at the current sales rate.",
                evidence=[f"{p['name']}: {p['quantity']} {p['unit']}, ~{p['days_of_cover'] or 'no'} days of cover" for p in slow[:6]],
                amounts={"value": value},
                items=[{"id": p["id"]} for p in slow if p.get("id")], item_type="product",
                impact_paisa=value, impact_label="Cash tied up in slow stock",
                next_step="Pause reorders for these items or consider a small discount.",
                limitations="Based on the last 28 days of recorded sales; seasonal items may pick up.",
                link="/inventory"))

    # 11. Data sufficiency
    if forecast["model"].get("history_days", 0) < 28:
        alerts.append(_alert(
            "insufficient_history", "history", 30, "Forecast confidence is limited by short history",
            f"Only {forecast['model'].get('history_days', 0)} days of transactions are recorded.",
            next_step="Import older transactions (CSV) to improve the forecast.",
            limitations="Forecasts with short history can miss weekly and monthly patterns.", link="/import"))

    alerts.sort(key=lambda a: -a["score"])
    return alerts


def budget_overrun_alerts(budget_report: dict) -> list[dict]:
    """One alert per category whose recorded spending this month exceeds the budget the user entered."""
    out = []
    for line in budget_report.get("lines", []):
        if line["status"] != "over":
            continue
        over = line["actual_paisa"] - line["budget_paisa"]
        pct = line["used_pct"]
        out.append(_alert(
            "budget_overrun", line["category"][:80], 55 + min(int(pct - 100), 30),
            f"{line['category']} is over budget by {fmt_pkr(over)} ({pct:.0f}% used)",
            f"{fmt_pkr(line['actual_paisa'])} spent in {budget_report['month']} against a monthly budget of "
            f"{fmt_pkr(line['budget_paisa'])}.",
            amounts={"budget": line["budget_paisa"], "actual": line["actual_paisa"], "over": over},
            dates={"from": budget_report["from"], "to": budget_report["to"]},
            impact_paisa=over, impact_label="Spent above this month's budget",
            next_step="Open Budget to review the category, or adjust the budget if it was set too low.",
            limitations="Compares recorded expenses with the budget you entered; unrecorded spending is not counted.",
            link="/budget"))
    return out
