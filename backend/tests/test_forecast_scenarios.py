"""Forecast edge cases and shock arithmetic, each checked against a hand calculation."""
import copy
from datetime import date, timedelta

from conftest import onboard
from test_engine import T, d, snap

from app.money import rupees
from app.services.forecast import _next_monthly_dates, run_forecast
from app.services.simulation import simulate
from app.services.snapshot import Pay, Rec, Tx


def _history(days=42, daily_in=1_000, daily_out=0, out_category="Inventory Purchase"):
    txs = []
    for i in range(1, days + 1):
        txs.append(Tx(f"i{i}", d(-i), "income", rupees(daily_in), account="cash", category="Sales", description="Sales"))
        if daily_out:
            txs.append(Tx(f"o{i}", d(-i), "expense", rupees(daily_out), account="cash", category=out_category,
                          description="Stock"))
    return txs


def _bal(result):
    return {p["day"]: p["balance_paisa"] for p in result["points"]}


def test_no_future_transactions_is_a_flat_line_without_a_band():
    r = run_forecast(snap(opening_cash=rupees(12_345)), T, 30)
    assert set(_bal(r).values()) == {rupees(12_345)}
    s = r["summary"]
    assert s["shortage_date"] is None and s["runway_days"] is None and s["runway_extrapolated_days"] is None
    assert s["band_available"] is False and r["model"]["band"]["method"] == "none"


def test_zero_balance_is_not_a_shortage_but_negative_opening_is():
    assert run_forecast(snap(), T, 14)["summary"]["shortage_date"] is None
    s = run_forecast(snap(opening_cash=rupees(-5_000)), T, 14)["summary"]
    assert s["days_to_shortage"] == 1 and s["min_balance_paisa"] == rupees(-5_000)


def test_hand_calculated_path_with_history_bill_and_invoice():
    # +1,000/day everyday sales; Rs. 25,000 bill on day 5; Rs. 20,000 invoice expected day 8 (not yet due -> 95%)
    s = snap(opening_cash=rupees(10_000), txs=_history(42, 1_000),
             pays=[Pay("p1", "s1", "Supplier", "Inventory Purchase", d(-5), d(5), rupees(25_000))],
             recs=[Rec("r1", "c1", "Cust", d(-10), d(8), rupees(20_000), expected_on=d(8))])
    opening = rupees(10_000 + 42 * 1_000)
    r = run_forecast(s, T, 14)
    b = _bal(r)
    assert b[4] == opening + rupees(4_000)
    assert b[5] == opening + rupees(5_000 - 25_000)
    assert b[8] == opening + rupees(8_000 - 25_000 + 19_000)
    assert r["summary"]["min_balance_paisa"] == b[5]
    assert r["model"]["band"]["method"] == "backtest_rmse"


def test_large_future_expense_creates_a_shortage_on_its_due_date():
    s = snap(opening_cash=rupees(30_000), pays=[Pay("p1", None, "Generator", "Repairs", d(-1), d(10), rupees(50_000))])
    summary = run_forecast(s, T, 30)["summary"]
    assert summary["shortage_date"] == d(10).isoformat()
    assert summary["runway_days"] == 10 and summary["min_balance_paisa"] == rupees(-20_000)


def test_runway_extrapolation_when_cash_falls_but_stays_positive():
    s = snap(opening_cash=rupees(20_000) - rupees(42 * 1_000 - 42 * 1_500), txs=_history(42, 1_000, 1_500, "Rent"))
    r = run_forecast(s, T, 30)
    assert r["summary"]["opening_balance_paisa"] == rupees(20_000)
    assert r["summary"]["avg_daily_net_paisa"] == rupees(-500)
    assert _bal(r)[30] == rupees(5_000)
    assert r["summary"]["runway_extrapolated_days"] == 40  # 30 + 5,000 / 500


def test_month_end_and_leap_day_boundaries():
    # monthly item on the 31st lands on the last day of shorter months, including 29 Feb in a leap year
    dates = _next_monthly_dates(31, date(2028, 1, 31), date(2028, 2, 1), date(2028, 4, 30))
    assert dates == [date(2028, 2, 29), date(2028, 3, 31), date(2028, 4, 30)]
    leap_today = date(2028, 2, 26)
    s = snap(opening_cash=rupees(1_000), pays=[Pay("p1", None, "Rent", "Rent", date(2028, 2, 1), date(2028, 2, 29), rupees(2_000))])
    s.opening_date = date(2027, 12, 1)
    summary = run_forecast(s, leap_today, 14)["summary"]
    assert summary["shortage_date"] == "2028-02-29" and summary["days_to_shortage"] == 3


def test_shock_arithmetic_is_exact():
    base = snap(opening_cash=rupees(100_000), txs=_history(42, 1_000, 400),
                pays=[Pay("rent", None, "Landlord", "Rent", d(-25), d(5), rupees(30_000)),
                      Pay("elec", None, "LESCO", "Electricity", d(-20), d(3), rupees(10_000))])

    def gap(adjustments, day):
        out = simulate(base, T, adjustments, 30)
        return _bal(out["scenario"])[day] - _bal(out["baseline"])[day], out

    assert gap([{"type": "rent_increase", "percent": 10}], 5)[0] == rupees(-3_000)
    assert gap([{"type": "utility_increase", "percent": 40}], 3)[0] == rupees(-4_000)
    assert gap([{"type": "unexpected_expense", "amount_paisa": rupees(50_000), "day": 7}], 7)[0] == rupees(-50_000)
    assert gap([{"type": "unexpected_expense", "amount_paisa": rupees(50_000), "day": 7}], 6)[0] == 0
    # stock purchases 400/day x 15% = 60/day more, from day 1 -> 600 by day 10
    assert gap([{"type": "supplier_price_increase", "percent": 15}], 10)[0] == rupees(-600)
    # sales 1,000/day x 20% for 5 days -> 1,000 less from day 5 onwards
    assert gap([{"type": "sales_decline", "percent": 20, "duration_days": 5}], 20)[0] == rupees(-1_000)
    _, out = gap([{"type": "rent_increase", "percent": 10}], 5)
    assert out["comparison"]["min_balance_change_paisa"] <= 0 and any("Rent x1.10" in n for n in out["notes"])


def test_rent_shock_without_rent_says_so():
    out = simulate(snap(opening_cash=rupees(1_000)), T, [{"type": "rent_increase", "percent": 25}], 30)
    assert out["comparison"]["end_balance_change_paisa"] == 0
    assert any("No rent payment" in n for n in out["notes"])


def test_simulation_never_mutates_the_ledger_snapshot():
    s = snap(opening_cash=rupees(5_000), txs=_history(30, 1_000, 300),
             recs=[Rec("r1", "c1", "Cust", d(-20), d(5), rupees(20_000))])
    before = copy.deepcopy(s)
    simulate(s, T, [{"type": "delayed_payment", "receivable_ids": ["r1"], "delay_days": 20},
                    {"type": "collect_receivables", "receivable_ids": ["r1"], "day": 1}], 30)
    assert s == before


def test_api_scenarios_leave_records_and_dashboard_unchanged(client):
    h = onboard(client, "sim-owner", demo=True)
    dash = client.get("/api/v1/dashboard", headers=h).json()["kpis"]
    total = client.get("/api/v1/transactions", headers=h).json()["total"]
    r = client.post("/api/v1/scenarios/simulate", headers=h,
                    json={"adjustments": [{"type": "rent_increase", "percent": 20}, {"type": "sales_decline", "percent": 30}]})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["comparison"]["min_balance_change_paisa"] < 0
    assert res["baseline"]["summary"]["opening_balance_paisa"] == dash["cash_balance"]["value_paisa"]
    assert client.get("/api/v1/transactions", headers=h).json()["total"] == total
    assert client.get("/api/v1/dashboard", headers=h).json()["kpis"]["cash_balance"] == dash["cash_balance"]
    presets = client.get("/api/v1/scenarios/presets", headers=h).json()
    assert any(p["id"] == "rent_hike" for p in presets.get("presets", presets))
