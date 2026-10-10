"""Alerts carry evidence that points at real records; recovery options are quantified, never 'applied'."""
from datetime import date, timedelta
from conftest import onboard
from test_engine import T, d, snap
from test_forecast_scenarios import _history

from app.money import rupees
from app.services.forecast import run_forecast
from app.services.recovery import compare_strategies
from app.services.risk import compute_alerts
from app.services.snapshot import Pay, Rec


def test_every_alert_has_impact_and_records_that_exist(client):
    h = onboard(client, "alerts-owner", demo=True)
    alerts = client.get("/api/v1/alerts", headers=h).json()["items"]
    assert alerts
    rec_ids = {r["id"] for r in client.get("/api/v1/receivables", headers=h).json()["items"]}
    pay_ids = {p["id"] for p in client.get("/api/v1/payables", headers=h).json()["items"]}
    for a in alerts:
        for key in ("level", "score", "explanation", "next_step", "limitations", "records", "impact_paisa"):
            assert key in a, (a["rule"], key)
        for ref in a["records"]:
            if ref["type"] == "transaction":
                assert client.get(f"/api/v1/transactions/{ref['id']}", headers=h).status_code == 200
            elif ref["type"] == "receivable":
                assert ref["id"] in rec_ids
            elif ref["type"] == "payable":
                assert ref["id"] in pay_ids
    shortage = next(a for a in alerts if a["rule"] == "projected_shortage")
    assert shortage["impact_paisa"] > 0 and shortage["records"]
    overdue = next(a for a in alerts if a["rule"] == "overdue_receivables")
    assert overdue["impact_paisa"] == overdue["amounts"]["total_overdue"]


def test_reserve_breach_names_the_bill_that_causes_it():
    s = snap(opening_cash=rupees(40_000), reserve=rupees(20_000),
             pays=[Pay("p-rent", None, "Landlord", "Rent", d(-20), d(6), rupees(25_000))])
    fc = run_forecast(s, T, 30)
    alert = next(a for a in compute_alerts(s, T, fc) if a["rule"] == "reserve_breach")
    assert "Landlord" in alert["explanation"] or "Rent" in alert["explanation"]
    assert {"type": "payable", "id": "p-rent"} in alert["records"]
    assert alert["impact_paisa"] == rupees(20_000 - 15_000)


def test_duplicate_payment_alert_points_at_both_entries():
    from app.services.snapshot import Tx
    s = snap(opening_cash=rupees(50_000), txs=[
        Tx("t1", d(-2), "expense", rupees(4_500), account="cash", category="Utilities", description="K-Electric bill"),
        Tx("t2", d(-1), "expense", rupees(4_500), account="cash", category="Utilities", description="K-Electric bill"),
    ])
    alert = next(a for a in compute_alerts(s, T, run_forecast(s, T, 30)) if a["rule"] == "unusual_transaction")
    assert {r["id"] for r in alert["records"]} == {"t1", "t2"}
    assert "duplicate" in alert["title"].lower()


def test_collect_invoice_vs_delay_purchase_are_quantified_side_by_side():
    s = snap(opening_cash=rupees(5_000), txs=_history(42, 1_000, 900),
             recs=[Rec("r1", "c1", "Late Customer", d(-40), d(-10), rupees(30_000))],
             pays=[Pay("p1", "s1", "Supplier", "Inventory Purchase", d(-6), d(4), rupees(60_000))])
    out = compare_strategies(s, T, [], [
        {"id": "collect", "adjustments": [{"type": "collect_receivables", "receivable_ids": ["r1"], "collect_percent": 100, "day": 2}]},
        {"id": "delay", "adjustments": [{"type": "delay_purchases", "percent": 50, "start_day": 1, "duration_days": 14}]},
    ], 30)
    rows = {r["id"]: r for r in out["strategies"]}
    base_min = out["scenario"]["summary"]["min_balance_paisa"]
    # collecting moves Rs. 30,000 forward (vs 80% expected ~day 14) -> lowest point improves by a known amount
    assert rows["collect"]["comparison"]["min_balance_change_paisa"] > 0
    # delaying half of 900/day stock buying for 14 days saves 450/day: Rs. 1,800 by day 4 (the bill day)
    delay_d4 = next(p for p in rows["delay"]["points"] if p["date"] == d(4).isoformat())["balance_paisa"]
    base_d4 = next(p for p in out["scenario"]["points"] if p["date"] == d(4).isoformat())["balance_paisa"]
    assert delay_d4 - base_d4 == rupees(1_800)
    assert rows["collect"]["summary"]["min_balance_paisa"] > base_min


def test_recovery_endpoint_does_not_change_records(client):
    h = onboard(client, "rec-owner", demo=True)
    before = client.get("/api/v1/receivables", headers=h).json()["items"]
    r = client.post("/api/v1/recovery/recommendations", headers=h, json={})
    assert r.status_code == 200 and r.json()["strategies"]
    assert client.get("/api/v1/receivables", headers=h).json()["items"] == before


def test_entry_that_is_both_unusual_and_a_duplicate_does_not_break_the_dashboard(client):
    """Production bug: one expense flagged as an unusual amount and as a duplicate (of two earlier identical entries)
    produced the same alert key several times; saving them crashed /dashboard, /forecast, /alerts and reports."""
    h = onboard(client, "dup-outlier", "enterprise")
    base = date(2026, 10, 10)

    def spend(days_ago: int, rupees_: int):
        r = client.post("/api/v1/transactions", headers=h, json={
            "occurred_on": (base - timedelta(days=days_ago)).isoformat(), "kind": "expense", "amount_paisa": rupees_ * 100,
            "account": "cash", "category": "Utilities", "description": "Generator diesel"})
        assert r.status_code == 201, r.text

    client.post("/api/v1/transactions", headers=h, json={"occurred_on": "2026-06-01", "kind": "income",
                "amount_paisa": 5_000_000_00, "account": "bank", "category": "Sales", "description": "Opening sales"})
    for i, amount in enumerate([9_000, 10_000, 11_000, 9_500, 10_500, 10_000, 9_800, 10_200, 9_900, 10_100]):
        spend(90 - i * 8, amount)
    for days_ago in (3, 2, 2):  # the same large bill entered three times
        spend(days_ago, 60_000)

    for path in ("/dashboard", "/forecast", "/alerts", "/reports/financial"):
        assert client.get(f"/api/v1{path}", headers=h).status_code == 200, path
    alerts = client.get("/api/v1/alerts", headers=h).json()
    alerts = alerts if isinstance(alerts, list) else alerts.get("alerts", alerts.get("items", []))
    unusual = [a for a in alerts if a["rule"] == "unusual_transaction"]
    assert unusual and len({a["entity_key"] for a in unusual}) == len(unusual)
    assert any("possible duplicate" in a["explanation"] for a in unusual)
    # the data-checks page still lists the duplicates separately
    checks = {c["id"]: c for c in client.get("/api/v1/controls", headers=h).json()["checks"]}
    assert checks["possible_duplicates"]["count"] >= 2


def test_alert_saved_by_a_parallel_request_is_reused_not_a_crash(client, db):
    """Dashboard and alerts pages load together; both may store the same new alert. The second must reuse it."""
    from app.db import get_sessionmaker
    from app.models import Business, RiskAlert
    from app.routers.analytics import _alerts_with_state

    onboard(client, "race-owner", "sme")
    business = db.query(Business).filter_by(owner_id="race-owner").one()
    other = get_sessionmaker()()
    other.add(RiskAlert(business_id=business.id, rule="overdue_receivables", entity_key="all", first_detected_on=T,
                        last_detected_on=T, status="open", level="medium", score=60, title="from the other request",
                        payload={}))
    other.commit()
    other.close()

    real_scalars, calls = db.scalars, []

    def stale_first_read(stmt, *a, **kw):  # this request read the table before the other one inserted
        calls.append(1)
        return [] if len(calls) == 1 else real_scalars(stmt, *a, **kw)

    db.scalars = stale_first_read
    alert = {"rule": "overdue_receivables", "entity_key": "all", "level": "high", "score": 70, "title": "Rs. 1 overdue",
             "explanation": "x", "amounts": {}, "dates": {}}
    out = _alerts_with_state(db, business, [alert], T)
    db.scalars = real_scalars
    assert len(out) == 1 and out[0]["status"] == "open"
    rows = db.query(RiskAlert).filter_by(business_id=business.id, rule="overdue_receivables").all()
    assert len(rows) == 1 and rows[0].score == 70
