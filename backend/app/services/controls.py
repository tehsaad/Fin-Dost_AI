"""Financial controls: read-only data checks over the ledger, receivables and payables.

Each check lists the exact records involved and why, so finance staff can investigate. Nothing is changed
automatically. This is not bank reconciliation: FinDost has no bank feed to match against.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date

from ..money import fmt_pkr
from .ledger import account_balances, cash_delta
from .risk import detect_anomalies
from .snapshot import Snapshot

SEVERITY_ORDER = {"high": 0, "medium": 1, "low": 2}


def _check(cid: str, severity: str, title: str, explanation: str, records: list[dict], next_step: str) -> dict:
    return {"id": cid, "severity": severity, "title": title, "explanation": explanation, "count": len(records),
            "records": records[:25], "next_step": next_step, "status": "issue" if records else "pass"}


def _tx_ref(t) -> dict:
    return {"type": "transaction", "id": t.id, "date": t.occurred_on.isoformat(), "label": t.description or t.category,
            "amount_paisa": t.amount}


def run_checks(snap: Snapshot, today: date) -> dict:
    tx_by_id = snap.tx_by_id()
    anomalies = detect_anomalies(snap, today, recent_days=60)
    dups = [a for a in anomalies if a["type"] == "possible_duplicate"]
    outliers = [a for a in anomalies if a["type"] == "amount_outlier"]
    checks = []

    checks.append(_check(
        "possible_duplicates", "high", "Possible duplicate payments",
        "Same amount and description within 2 days (last 60 days, Rs. 1,000 or more).",
        [{**_tx_ref(tx_by_id[a["id"]]), "reason": a["reason"], "duplicate_of": a.get("duplicate_of")} for a in dups
         if a["id"] in tx_by_id],
        "Compare with receipts; delete the duplicate entry only if it was recorded twice."))

    uncategorized = [t for t in snap.txs if (t.category or "").strip().lower() in ("", "uncategorized")]
    checks.append(_check(
        "uncategorized", "medium", "Transactions without a category",
        "Uncategorized records weaken spending analysis, budgets and the forecast's expense groups.",
        [_tx_ref(t) for t in uncategorized], "Edit these transactions and choose a category."))

    future = [t for t in snap.txs if t.occurred_on > today]
    checks.append(_check(
        "future_dated", "medium", "Transactions dated in the future",
        "Future-dated entries already change today's balance; scheduled items belong in bills or invoices.",
        [_tx_ref(t) for t in future], "Correct the date, or record it as a bill/invoice with a due date."))

    over_settled = [r for r in snap.receivables if r.paid > r.amount] + [p for p in snap.payables if p.paid > p.amount]
    checks.append(_check(
        "over_settled", "high", "Invoices or bills paid more than their amount",
        "Payments linked to an invoice or bill exceed its amount (possible double entry).",
        [{"type": "receivable" if hasattr(x, "customer_id") else "payable", "id": x.id,
          "label": getattr(x, "customer_name", None) or getattr(x, "label", ""), "amount_paisa": x.amount,
          "reason": f"paid {fmt_pkr(x.paid)} on {fmt_pkr(x.amount)}"} for x in over_settled],
        "Open the invoice/bill and remove the extra payment."))

    linked = defaultdict(int)
    for t in snap.txs:
        if t.kind == "credit_sale" and t.receivable_id:
            linked[("r", t.receivable_id)] += t.amount
        if t.kind == "credit_purchase" and t.payable_id:
            linked[("p", t.payable_id)] += t.amount
    mismatched = [r for r in snap.receivables if ("r", r.id) in linked and linked[("r", r.id)] != r.amount]
    mismatched += [p for p in snap.payables if ("p", p.id) in linked and linked[("p", p.id)] != p.amount]
    checks.append(_check(
        "invoice_sale_mismatch", "high", "Invoice/bill amount differs from its sale or purchase",
        "The credit sale or purchase that created an invoice/bill no longer matches its amount.",
        [{"type": "receivable" if hasattr(x, "customer_id") else "payable", "id": x.id,
          "label": getattr(x, "customer_name", None) or getattr(x, "label", ""), "amount_paisa": x.amount,
          "reason": f"linked entry total {fmt_pkr(linked[('r' if hasattr(x, 'customer_id') else 'p', x.id)])}"}
         for x in mismatched],
        "Edit the sale/purchase or the invoice so both carry the same amount."))

    unlinked_payments = [t for t in snap.txs if (t.kind == "customer_payment" and not t.receivable_id)
                         or (t.kind == "supplier_payment" and not t.payable_id)]
    checks.append(_check(
        "unmatched_payments", "medium", "Payments not linked to an invoice or bill",
        "Customer/supplier payments should settle a specific invoice or bill so outstanding balances stay correct.",
        [_tx_ref(t) for t in unlinked_payments], "Record these through the invoice/bill 'Record payment' action."))

    checks.append(_check(
        "unusual_amounts", "low", "Unusually large amounts",
        "Robust z-score of 3.5 or more within the category (last 60 days). Unusual is not the same as wrong.",
        [{**_tx_ref(tx_by_id[a["id"]]), "reason": a["reason"]} for a in outliers if a["id"] in tx_by_id],
        "Check the receipt; no action is needed if it is correct."))

    # Totals consistency: balance from the per-account ledger equals opening + every cash movement.
    balances = account_balances(snap, today)
    recomputed = sum(snap.opening.values()) + sum(cash_delta(t) for t in snap.txs if t.occurred_on <= today)
    checks.append(_check(
        "cash_totals", "high", "Cash totals are internally consistent",
        f"Account balances add up to {fmt_pkr(balances['total'])}; opening balances plus every recorded cash "
        f"movement give {fmt_pkr(recomputed)}.",
        [] if balances["total"] == recomputed else [{"type": "workspace", "id": snap.business_id, "label": "cash totals",
                                                     "amount_paisa": balances["total"] - recomputed}],
        "If these differ, contact support: it indicates a data integrity problem."))

    checks.sort(key=lambda c: (c["status"] == "pass", SEVERITY_ORDER[c["severity"]]))
    issues = [c for c in checks if c["status"] == "issue"]
    return {
        "checked_on": today.isoformat(), "checks": checks, "issue_count": len(issues),
        "records_flagged": sum(c["count"] for c in issues),
        "scope": "Read-only checks over your FinDost records. FinDost has no bank feed, so this is not bank "
                 "reconciliation, and it never changes records automatically.",
    }
