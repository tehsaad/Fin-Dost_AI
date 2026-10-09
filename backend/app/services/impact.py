"""SDG Impact Center: measured technical performance vs. hypothetical impact.

The benchmark generates synthetic micro-businesses with a known generative
process. For each one the forecaster sees ONLY the history (and bills/invoices
that would already be recorded); the following 14 days are then realised from
the same process with fresh noise and customer lateness the model cannot see.
A "labelled shortage" is a realised balance below zero within 14 days. This
avoids leakage: labels come from the hidden future, never from the model.

Limitations: synthetic data reflects our assumptions about kiryana-style cash
flows; real businesses will be noisier. These numbers measure the software,
not real-world social outcomes.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache

import numpy as np

from .forecast import build_components, project
from .recovery import recommend
from .snapshot import Pay, Rec, Snapshot, Tx

HISTORY = 63
HORIZON = 14

SDG_TARGETS = [
    {"target": "1.4", "goal": "SDG 1 - No Poverty",
     "text": "Equal rights to economic resources and access to basic services and financial services, including microfinance.",
     "link": "FinDost gives very small businesses free cash-flow tools usually only available to firms with accountants."},
    {"target": "1.5", "goal": "SDG 1 - No Poverty",
     "text": "Build the resilience of the poor and vulnerable and reduce their exposure to economic, social and environmental shocks.",
     "link": "The shock simulator and early warnings help owners prepare for floods, price rises and late payments before they hit."},
    {"target": "8.3", "goal": "SDG 8 - Decent Work and Economic Growth",
     "text": "Support productive activities, entrepreneurship and the growth of micro-, small- and medium-sized enterprises, "
             "including through access to financial services.",
     "link": "Better cash planning can help micro-enterprises keep operating through difficult weeks."},
    {"target": "9.3", "goal": "SDG 9 - Industry, Innovation and Infrastructure",
     "text": "Increase access of small-scale enterprises to financial services, including affordable credit, and their integration "
             "into value chains and markets.",
     "link": "Organised, exportable records (ledger, receivables, reports) are a step toward formal finance - FinDost does not "
             "provide credit itself."},
    {"target": "10.2", "goal": "SDG 10 - Reduced Inequalities",
     "text": "Empower and promote the social, economic and political inclusion of all.",
     "link": "Urdu explanations, plain-language terms and mobile layouts aim to include owners without accounting training; "
             "actual reach has not been measured yet."},
]


@dataclass
class SyntheticCase:
    snap: Snapshot
    realised: np.ndarray  # balances day 0..HORIZON
    label_shortage: bool
    label_day: int | None


def _make_case(rng: random.Random, i: int, today: date) -> SyntheticCase:
    nrng = np.random.default_rng(rng.randrange(1 << 30))
    start = today - timedelta(days=HISTORY)
    base_sales = rng.uniform(15_000, 80_000) * 100  # paisa
    dow = np.array([rng.uniform(0.8, 1.3) for _ in range(7)])
    cost_ratio = rng.uniform(0.70, 0.92)
    noise = rng.uniform(0.08, 0.25)
    trend = rng.uniform(-0.004, 0.002)  # daily drift in sales
    rent = int(base_sales * rng.uniform(1.0, 2.5))
    rent_day = rng.randint(1, 28)
    txs: list[Tx] = []
    n = 0

    def sales_on(d: date, k: int) -> float:
        return max(base_sales * dow[d.weekday()] * (1 + trend * k) * (1 + nrng.normal(0, noise)), 0)

    for k in range(HISTORY):
        d = start + timedelta(days=k)
        s_amt = int(sales_on(d, k))
        c_amt = int(s_amt * cost_ratio * (1 + nrng.normal(0, noise / 2)))
        txs.append(Tx(id=f"s{i}-{n}", occurred_on=d, kind="income", amount=max(s_amt, 1), account="cash",
                      category="Sales", description="Sales")); n += 1
        txs.append(Tx(id=f"s{i}-{n}", occurred_on=d, kind="expense", amount=max(c_amt, 1), account="cash",
                      category="Inventory Purchase", description="Stock")); n += 1
        if d.day == rent_day:
            txs.append(Tx(id=f"s{i}-{n}", occurred_on=d, kind="expense", amount=rent, account="bank",
                          category="Rent", description="Shop rent")); n += 1

    # recorded future items: a few bills and invoices
    payables, receivables = [], []
    for j in range(rng.randint(1, 4)):
        due = today + timedelta(days=rng.randint(1, HORIZON))
        payables.append(Pay(id=f"p{i}-{j}", supplier_id=f"sup{j}", supplier_name=f"Supplier {j}",
                            category="Inventory Purchase", issued_on=due - timedelta(days=14), due_on=due,
                            amount=int(base_sales * rng.uniform(1.0, 5.0))))
    lateness = rng.choice([0, 3, 10, 25])
    for j in range(rng.randint(0, 3)):
        due = today + timedelta(days=rng.randint(-20, HORIZON))
        receivables.append(Rec(id=f"r{i}-{j}", customer_id=f"c{i}-{j}", customer_name=f"Customer {j}",
                               issued_on=due - timedelta(days=30), due_on=due,
                               amount=int(base_sales * rng.uniform(0.5, 3.0))))

    # today's balance spans thin to comfortable buffers, so the set mixes trouble and no-trouble cases
    hist_net = sum(t.amount if t.kind == "income" else -t.amount for t in txs)
    target_today = int(base_sales * rng.uniform(1.0, 10.0))
    opening = target_today - hist_net
    snap = Snapshot(business_id=f"synthetic-{i}", kind="sme", name=f"Synthetic {i}", opening_date=start,
                    opening={"cash": opening, "bank": 0, "wallet": 0}, reserve=0, txs=txs,
                    receivables=receivables, payables=payables)

    # realise the hidden future from the same process
    bal = np.zeros(HORIZON + 1)
    bal[0] = target_today
    for k in range(1, HORIZON + 1):
        d = today + timedelta(days=k)
        s_amt = sales_on(d, HISTORY + k)
        c_amt = s_amt * cost_ratio * (1 + nrng.normal(0, noise / 2))
        flow = s_amt - c_amt
        if d.day == rent_day:
            flow -= rent
        flow -= sum(p.amount for p in payables if p.due_on == d)
        for r in receivables:
            paid_on = max(r.due_on + timedelta(days=lateness), today + timedelta(days=1))
            if paid_on == d:
                flow += r.amount
        bal[k] = bal[k - 1] + flow
    neg = [k for k in range(1, HORIZON + 1) if bal[k] < 0]
    return SyntheticCase(snap=snap, realised=bal, label_shortage=bool(neg), label_day=neg[0] if neg else None)


def _naive_shortage(case: SyntheticCase, today: date) -> bool:
    """Baseline rule: today's balance minus recorded bills due in 14 days (ignores sales and collections)."""
    due = sum(p.amount for p in case.snap.payables if p.due_on <= today + timedelta(days=HORIZON))
    return case.realised[0] - due < 0


@lru_cache(maxsize=4)
def run_benchmark(seed: int = 2026, n: int = 120, today_iso: str = "2026-01-15") -> dict:
    today = date.fromisoformat(today_iso)
    rng = random.Random(seed)
    tp = fp = tn = fn = 0
    btp = bfp = btn = bfn = 0
    lead_times, abs_err_14, wape_terms = [], [], []
    recovery_runs = 0
    gains = []
    for i in range(n):
        case = _make_case(rng, i, today)
        comp = build_components(case.snap, today, HORIZON)
        res = project(comp)
        pred_day = res["summary"]["days_to_shortage"]
        pred = pred_day is not None
        if pred and case.label_shortage:
            tp += 1
            lead_times.append(case.label_day)
        elif pred:
            fp += 1
        elif case.label_shortage:
            fn += 1
        else:
            tn += 1
        naive = _naive_shortage(case, today)
        if naive and case.label_shortage:
            btp += 1
        elif naive:
            bfp += 1
        elif case.label_shortage:
            bfn += 1
        else:
            btn += 1
        err = abs(res["points"][HORIZON]["balance_paisa"] - case.realised[HORIZON])
        abs_err_14.append(err)
        wape_terms.append(abs(case.realised[HORIZON] - case.realised[0]) + 1)
        if pred and i % 3 == 0:  # evaluate recovery on a subset to keep the endpoint fast
            rec = recommend(case.snap, today, [], HORIZON)
            recovery_runs += len(rec["strategies"])
            if rec["combined_plan"]:
                gains.append(rec["combined_plan"]["comparison"]["min_balance_change_paisa"])

    def metrics(tp_, fp_, tn_, fn_):
        precision = tp_ / (tp_ + fp_) if tp_ + fp_ else 0.0
        recall = tp_ / (tp_ + fn_) if tp_ + fn_ else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        return {"accuracy": round((tp_ + tn_) / n * 100, 1), "precision": round(precision * 100, 1),
                "recall": round(recall * 100, 1), "f1": round(f1 * 100, 1),
                "confusion": {"tp": tp_, "fp": fp_, "tn": tn_, "fn": fn_}}

    return {
        "businesses_evaluated": n,
        "labelled_shortages": tp + fn,
        "labelled_shortage_rate_pct": round((tp + fn) / n * 100, 1),
        "shortages_identified": tp,
        "model": metrics(tp, fp, tn, fn),
        "naive_baseline": metrics(btp, bfp, btn, bfn),
        "avg_warning_lead_days": round(float(np.mean(lead_times)), 1) if lead_times else None,
        "median_abs_error_day14_paisa": int(np.median(abs_err_14)),
        "recovery_scenarios_evaluated": recovery_runs,
        "avg_min_balance_gain_paisa": int(np.mean(gains)) if gains else 0,
        "method": ("Synthetic micro-businesses (fixed seed). The forecaster sees 9 weeks of history plus recorded bills and "
                   "invoices; labels come from a hidden 14-day future generated with fresh noise and customer lateness. "
                   "The naive baseline subtracts recorded bills from today's cash and ignores sales and collections."),
        "limitations": ("Synthetic data follows our own assumptions about small-shop cash flows, so these figures show how the "
                        "software behaves, not how it performs for real businesses. Real-world validation is still needed."),
    }
