"""Engine tests on small synthetic snapshots with hand-calculated expected values."""
from datetime import date, timedelta

import pytest

from app.money import fmt_pkr, parse_amount, rupees
from app.services.forecast import build_components, project, run_forecast
from app.services.ingestion import build_preview, infer_day_first, parse_date, read_csv, TEMPLATES
from app.services.ledger import account_balances, period_summary
from app.services.llm import mask_names, numbers_grounded
from app.services.recovery import compare_strategies, recommend
from app.services.simulation import AdjustmentError, simulate
from app.services.snapshot import Pay, Rec, Snapshot, Tx

T = date(2026, 10, 10)


def d(offset: int) -> date:
    return T + timedelta(days=offset)


def snap(txs=(), recs=(), pays=(), opening_cash=0, opening_bank=0, reserve=0) -> Snapshot:
    return Snapshot(business_id="b1", kind="sme", name="Test", opening_date=d(-60),
                    opening={"cash": opening_cash, "bank": opening_bank, "wallet": 0}, reserve=reserve,
                    txs=list(txs), receivables=list(recs), payables=list(pays))


# ------------------------------------------------------------------ money

def test_money_parsing_and_formatting():
    assert rupees("1250.50") == 125050
    assert parse_amount("Rs. 1,25,000.50") == 12500050
    assert parse_amount("(500)") == -50000
    assert parse_amount("750-") == -75000
    assert parse_amount("abc") is None
    assert parse_amount("") is None
    assert fmt_pkr(12500050) == "Rs. 125,001"
    assert fmt_pkr(-50000) == "-Rs. 500"
    assert fmt_pkr(12500050, paisa_digits=True) == "Rs. 125,000.50"


# ------------------------------------------------------------------ ledger

def test_cash_balances_by_account():
    s = snap(opening_cash=rupees(10_000), opening_bank=rupees(5_000), txs=[
        Tx("1", d(-5), "income", rupees(5_000), account="cash"),
        Tx("2", d(-4), "expense", rupees(2_000), account="bank"),
        Tx("3", d(-3), "transfer", rupees(1_000), account="cash", to_account="bank"),
        Tx("4", d(-2), "owner_withdrawal", rupees(500), account="cash"),
        Tx("5", d(-1), "loan_received", rupees(3_000), account="bank"),
    ])
    b = account_balances(s, T)
    assert b["cash"] == rupees(10_000 + 5_000 - 1_000 - 500)
    assert b["bank"] == rupees(5_000 - 2_000 + 1_000 + 3_000)
    assert b["total"] == rupees(20_500)
    # balance as of an earlier date ignores later rows
    assert account_balances(s, d(-5))["total"] == rupees(20_000)


def test_credit_sale_is_revenue_not_cash():
    s = snap(opening_cash=rupees(1_000), txs=[
        Tx("1", d(-10), "credit_sale", rupees(50_000), category="Sales", receivable_id="r1"),
        Tx("2", d(-5), "customer_payment", rupees(20_000), account="cash", receivable_id="r1"),
        Tx("3", d(-4), "credit_purchase", rupees(30_000), category="Inventory Purchase"),
        Tx("4", d(-3), "loan_received", rupees(10_000), account="cash"),
    ])
    p = period_summary(s, d(-30), T)
    assert p.revenue == rupees(50_000)          # credit sale counts as revenue
    assert p.credit_revenue == rupees(50_000)
    assert p.cash_revenue == 0                  # customer payment is NOT revenue
    assert p.expenses == rupees(30_000)         # credit purchase is an expense
    assert p.profit == rupees(20_000)
    assert p.cash_in == rupees(30_000)          # payment + loan; loan is not revenue
    assert account_balances(s, T)["total"] == rupees(31_000)


def test_receivable_outstanding_with_partial_payments():
    r = Rec(id="r1", customer_id="c1", customer_name="A", issued_on=d(-40), due_on=d(-10), amount=rupees(60_000),
            payments=[(d(-20), rupees(10_000)), (d(-5), rupees(15_000))])
    assert r.paid == rupees(25_000)
    assert r.outstanding == rupees(35_000)


# ------------------------------------------------------------------ forecast

def test_forecast_recorded_items_exact_path():
    s = snap(opening_cash=rupees(100_000),
             pays=[Pay("p1", "s1", "Supplier", "Inventory Purchase", d(-5), d(3), rupees(30_000))],
             recs=[Rec("r1", "c1", "Cust", d(-20), d(5), rupees(20_000), expected_on=d(5))])
    result = run_forecast(s, T, 14)
    bal = {p["day"]: p["balance_paisa"] for p in result["points"]}
    assert bal[0] == rupees(100_000)
    assert bal[2] == rupees(100_000)
    assert bal[3] == rupees(70_000)
    assert bal[5] == rupees(70_000 + 19_000)   # not yet due -> 95% weight
    assert result["summary"]["min_balance_paisa"] == rupees(70_000)
    assert result["summary"]["shortage_date"] is None
    assert any("Not enough history" in w for w in result["warnings"])


def test_cash_shortage_detection():
    s = snap(opening_cash=rupees(10_000), reserve=rupees(5_000),
             pays=[Pay("p1", "s1", "Supplier", "Rent", d(-1), d(4), rupees(25_000))])
    summary = run_forecast(s, T, 14)["summary"]
    assert summary["shortage_date"] == d(4).isoformat()
    assert summary["days_to_shortage"] == 4
    assert summary["min_balance_paisa"] == rupees(-15_000)
    assert summary["reserve_breach_date"] == d(4).isoformat()
    assert summary["shortage_risk"] == "high"


def test_overdue_receivable_weighting_and_doubtful_exclusion():
    s = snap(opening_cash=0, recs=[
        Rec("r1", "c1", "Late", d(-40), d(-10), rupees(40_000)),       # 10 days overdue -> 80%, ~14 days out
        Rec("r2", "c2", "Very late", d(-150), d(-120), rupees(9_000)),  # >90 days -> doubtful, excluded
    ])
    result = run_forecast(s, T, 30)
    bal = {p["day"]: p["balance_paisa"] for p in result["points"]}
    assert bal[13] == 0
    assert bal[14] == rupees(32_000)
    excluded = {e["id"]: e for e in result["excluded"] if e["type"] == "receivable"}
    assert excluded["r2"]["amount_paisa"] == rupees(9_000)


def _flat_history(days=42, daily_in=1_000, daily_out=0):
    txs = []
    for i in range(1, days + 1):
        txs.append(Tx(f"i{i}", d(-i), "income", rupees(daily_in), account="cash", category="Sales", description="Sales"))
        if daily_out:
            txs.append(Tx(f"o{i}", d(-i), "expense", rupees(daily_out), account="cash", category="Packaging",
                          description="Packing material"))
    return txs


def test_forecast_model_backtest_on_flat_history():
    s = snap(opening_cash=rupees(5_000), txs=_flat_history(42, 1_000, 400))
    result = run_forecast(s, T, 14)
    # constant history: both models predict exactly 600/day net and back-test error is zero
    bal = {p["day"]: p["balance_paisa"] for p in result["points"]}
    opening = account_balances(s, T)["total"]
    assert bal[10] == opening + rupees(600) * 10
    assert result["model"]["backtest"]["flat_28d_mean"]["mae_paisa"] == 0
    assert result["points"][10]["low_paisa"] == result["points"][10]["balance_paisa"]  # zero sigma -> no band


def test_insufficient_history_uses_simple_average_with_warning():
    s = snap(opening_cash=rupees(5_000), txs=_flat_history(10, 1_000))
    result = run_forecast(s, T, 14)
    assert result["model"]["name"] == "flat_28d_mean"
    assert "no back-test" in result["model"]["label"]
    assert any("Only 10 days of history" in w for w in result["warnings"])
    assert result["confidence"]["level"] == "low"


def test_missing_history_is_handled():
    result = run_forecast(snap(), T, 14)
    assert result["summary"]["min_balance_paisa"] == 0
    assert result["model"]["name"] == "none"


# ------------------------------------------------------------------ simulation

def test_delayed_payment_simulation_moves_cash():
    s = snap(opening_cash=rupees(10_000), recs=[Rec("r1", "c1", "Cust", d(-20), d(5), rupees(20_000), expected_on=d(5))])
    out = simulate(s, T, [{"type": "delayed_payment", "receivable_ids": ["r1"], "delay_days": 10}], 30)
    base = {p["day"]: p["balance_paisa"] for p in out["baseline"]["points"]}
    sc = {p["day"]: p["balance_paisa"] for p in out["scenario"]["points"]}
    assert base[5] == rupees(29_000)
    assert sc[5] == rupees(10_000)
    assert sc[15] == rupees(29_000)
    assert out["comparison"]["max_gap_paisa"] == rupees(-19_000)


def test_sales_decline_simulation_exact():
    s = snap(opening_cash=rupees(5_000), txs=_flat_history(42, 1_000))
    out = simulate(s, T, [{"type": "sales_decline", "percent": 50, "start_day": 1, "duration_days": 10}], 30)
    # 10 days x 1,000 x 50% = 5,000 less cash by the end
    assert out["comparison"]["end_balance_change_paisa"] == rupees(-5_000)
    assert out["comparison"]["additional_pressure_paisa"] == rupees(5_000)


def test_simulation_is_reproducible():
    s = snap(opening_cash=rupees(5_000), txs=_flat_history(42, 1_000, 300))
    adj = [{"type": "supplier_price_increase", "percent": 15}, {"type": "unexpected_expense", "amount_paisa": 100_000, "day": 3}]
    assert simulate(s, T, adj) == simulate(s, T, adj)


def test_invalid_adjustment_rejected():
    with pytest.raises(AdjustmentError):
        simulate(snap(), T, [{"type": "teleport_money"}])
    with pytest.raises(AdjustmentError):
        simulate(snap(), T, [{"type": "sales_decline", "percent": 150}])


# ------------------------------------------------------------------ recovery

def _shortage_case():
    return snap(opening_cash=rupees(10_000),
                recs=[Rec("r1", "c1", "Late Customer", d(-40), d(-10), rupees(40_000))],
                pays=[Pay("p1", "s1", "Supplier", "Inventory Purchase", d(-6), d(8), rupees(30_000))])


def test_recovery_collect_overdue_exact_effect():
    s = _shortage_case()
    rec = recommend(s, T, [], 30)
    assert rec["scenario"]["summary"]["min_balance_paisa"] == rupees(-20_000)
    collect = next(c for c in rec["strategies"] if c["id"] == "collect_overdue")
    # 60% of 40,000 collected on day 7 instead of the expected 80% on day 14
    assert collect["result"]["min_balance_paisa"] == rupees(4_000)
    assert collect["comparison"]["min_balance_change_paisa"] == rupees(24_000)
    assert collect["comparison"]["removes_shortage"] is True
    scores = [c["score"] for c in rec["strategies"]]
    assert scores == sorted(scores, reverse=True)
    assert rec["combined_plan"]["result"]["shortage_date"] is None


def test_recovery_compare_two_strategies():
    s = _shortage_case()
    out = compare_strategies(s, T, [], [
        {"id": "collect", "adjustments": [{"type": "collect_receivables", "receivable_ids": ["r1"], "collect_percent": 60, "day": 7}]},
        {"id": "defer", "adjustments": [{"type": "defer_payables", "payable_ids": ["p1"], "defer_days": 14}]},
    ], 30)
    rows = {r["id"]: r for r in out["strategies"]}
    assert rows["collect"]["summary"]["min_balance_paisa"] == rupees(4_000)
    # deferring 30,000 from day 8 to day 22: balance never drops below 10,000 before day 22
    assert rows["defer"]["summary"]["shortage_date"] is None
    assert out["best_by_min_balance"] == "defer"


# ------------------------------------------------------------------ ingestion

def test_iso_dates_are_never_swapped():
    assert parse_date("2026-03-04") == date(2026, 3, 4)
    assert parse_date("2026-03-04", day_first=False) == date(2026, 3, 4)
    assert parse_date("04/03/2026", day_first=True) == date(2026, 3, 4)
    assert parse_date("03/04/2026", day_first=False) == date(2026, 3, 4)
    assert parse_date("31/09/2026") is None
    assert infer_day_first(["05/06/2026", "25/06/2026"]) is True
    assert infer_day_first(["06/05/2026", "06/25/2026"]) is False


def test_messy_csv_validation():
    headers, rows = read_csv(TEMPLATES["messy-sample.csv"].encode())
    out = build_preview(headers, rows, T, set(), [])
    by_row = {r["row_number"]: r for r in out["rows"]}
    assert by_row[2]["status"] == "accepted" and by_row[2]["amount_paisa"] == rupees(38_500)
    assert by_row[3]["status"] == "duplicate"
    assert by_row[4]["kind"] == "expense" and by_row[4]["amount_paisa"] == rupees(42_000)
    assert by_row[4]["category"] == "Inventory Purchase"  # 'mandi maal' keyword
    assert by_row[5]["status"] == "rejected"               # 31/09 does not exist
    assert by_row[6]["status"] == "rejected"               # missing amount
    assert by_row[7]["account"] == "wallet" and by_row[7]["amount_paisa"] == 1275050
    s = out["summary"]
    assert (s["accepted"], s["rejected"], s["duplicates"]) == (4, 2, 1)


def test_bank_statement_adapter():
    headers, rows = read_csv(TEMPLATES["bank-statement-sample.csv"].encode())
    out = build_preview(headers, rows, T, set(), [])
    assert out["adapter"] == "bank_statement"
    first = out["rows"][0]
    assert first["kind"] == "income" and first["account"] == "bank" and first["date"] == "2026-10-01"
    assert out["rows"][1]["category"] == "Utilities"


def test_csv_rejects_binary_and_oversized_columns():
    from app.services.ingestion import IngestionError

    with pytest.raises(IngestionError):
        read_csv(b"\x00\x01\x02binary")
    with pytest.raises(IngestionError):
        read_csv((",".join(f"c{i}" for i in range(60)) + "\n").encode())


# ------------------------------------------------------------------ llm guard

def test_llm_number_guard_and_masking():
    evidence = "Balance Rs. 118,000 on 2026-10-19"
    assert numbers_grounded("You have Rs. 118,000.", evidence)
    assert not numbers_grounded("You have Rs. 120,000.", evidence)
    masked, mapping = mask_names("Pay Al-Madina Caterers Rs. 5", ["Al-Madina Caterers"])
    assert "Al-Madina" not in masked and mapping["[P1]"] == "Al-Madina Caterers"
