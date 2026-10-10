"""API tests: auth, onboarding/module separation, ledger rules, import, scenarios, isolation."""
from conftest import TODAY, onboard, token


def test_health_is_public(client):
    assert client.get("/api/v1/health").json()["status"] == "ok"


def test_requires_auth(client):
    r = client.get("/api/v1/dashboard")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"
    bad = {"Authorization": "Bearer not-a-jwt"}
    assert client.get("/api/v1/dashboard", headers=bad).status_code == 401


def test_onboarding_flow_and_single_workspace(client):
    h = token("u1", {"account_type": "household"})
    me = client.get("/api/v1/me", headers=h).json()
    assert me["needs_onboarding"] and me["suggested_kind"] == "household"
    assert client.get("/api/v1/dashboard", headers=h).json()["error"]["code"] == "onboarding_required"
    r = client.post("/api/v1/onboarding", headers=h, json={"kind": "household", "business_name": "Khan Family"})
    assert r.status_code == 201
    assert "inventory" not in r.json()["business"]["features"]
    again = client.post("/api/v1/onboarding", headers=h, json={"kind": "sme", "business_name": "x"})
    assert again.status_code == 409


def test_module_separation_by_account_type(client):
    h = onboard(client, "student-1", "student", demo=True)
    assert client.get("/api/v1/inventory", headers=h).status_code == 403
    assert client.get("/api/v1/receivables", headers=h).json()["error"]["code"] == "feature_unavailable"
    assert client.get("/api/v1/payables", headers=h).status_code == 200
    assert client.get("/api/v1/dashboard", headers=h).status_code == 200


def test_transaction_validation(client):
    h = onboard(client, "u2")
    ok = client.post("/api/v1/transactions", headers=h, json={
        "occurred_on": "2026-10-09", "kind": "income", "amount_paisa": 500_000, "description": "Counter cash sales"})
    assert ok.status_code == 201 and ok.json()["category"] == "Sales" and ok.json()["account"] == "cash"
    zero = client.post("/api/v1/transactions", headers=h, json={"occurred_on": "2026-10-09", "kind": "income", "amount_paisa": 0})
    assert zero.status_code == 422 and zero.json()["error"]["code"] == "validation_error"
    future = client.post("/api/v1/transactions", headers=h, json={"occurred_on": "2026-12-01", "kind": "expense", "amount_paisa": 100})
    assert future.status_code == 422
    transfer = client.post("/api/v1/transactions", headers=h, json={
        "occurred_on": "2026-10-09", "kind": "transfer", "amount_paisa": 100, "account": "cash", "to_account": "cash"})
    assert transfer.status_code == 422
    extra = client.post("/api/v1/transactions", headers=h, json={
        "occurred_on": "2026-10-09", "kind": "income", "amount_paisa": 100, "hack": True})
    assert extra.status_code == 422


def test_credit_sale_receivable_and_partial_payments(client):
    h = onboard(client, "u3")
    sale = client.post("/api/v1/transactions", headers=h, json={
        "occurred_on": "2026-10-01", "kind": "credit_sale", "amount_paisa": 5_000_000, "customer_name": "Butt Sweets",
        "due_on": "2026-10-08", "description": "Milk supply"}).json()
    rid = sale["receivable_id"]
    dash = client.get("/api/v1/dashboard?from=2026-09-11&to=2026-10-10", headers=h).json()
    assert dash["kpis"]["revenue"]["value_paisa"] == 5_000_000      # revenue recognised
    assert dash["kpis"]["cash_balance"]["value_paisa"] == 0          # but no cash received
    assert dash["kpis"]["receivables"]["overdue_paisa"] == 5_000_000
    p1 = client.post(f"/api/v1/receivables/{rid}/payments", headers=h, json={"amount_paisa": 2_000_000, "account": "wallet"})
    assert p1.status_code == 201
    assert p1.json()["receivable"]["outstanding_paisa"] == 3_000_000
    assert p1.json()["balance"]["wallet"] == 2_000_000
    over = client.post(f"/api/v1/receivables/{rid}/payments", headers=h, json={"amount_paisa": 3_000_001})
    assert over.status_code == 422 and over.json()["error"]["code"] == "overpayment"
    client.post(f"/api/v1/receivables/{rid}/payments", headers=h, json={"amount_paisa": 3_000_000})
    rec = client.get("/api/v1/receivables", headers=h).json()["items"][0]
    assert rec["status"] == "settled" and rec["outstanding_paisa"] == 0
    dash = client.get("/api/v1/dashboard?from=2026-09-11&to=2026-10-10", headers=h).json()
    assert dash["kpis"]["revenue"]["value_paisa"] == 5_000_000      # payments are not extra revenue
    assert dash["kpis"]["cash_balance"]["value_paisa"] == 5_000_000
    # deleting a credit sale with payments is refused
    assert client.delete(f"/api/v1/transactions/{sale['id']}", headers=h).status_code == 409


def test_payable_flow_and_reminder(client):
    h = onboard(client, "u4")
    bill = client.post("/api/v1/payables", headers=h, json={
        "supplier_name": "LESCO", "category": "Utilities", "amount_paisa": 2_870_000,
        "issued_on": "2026-10-05", "due_on": "2026-10-20"}).json()
    assert bill["status"] == "open" and bill["days_to_due"] == 10
    paid = client.post(f"/api/v1/payables/{bill['id']}/payments", headers=h, json={"amount_paisa": 870_000, "account": "bank"})
    assert paid.json()["payable"]["outstanding_paisa"] == 2_000_000
    sale = client.post("/api/v1/receivables", headers=h, json={
        "customer_name": "Model School Canteen", "amount_paisa": 3_800_000, "issued_on": "2026-09-10", "due_on": "2026-10-01"}).json()
    rem = client.get(f"/api/v1/receivables/{sale['id']}/reminder", headers=h).json()
    assert "Rs. 38,000" in rem["message"] and rem["whatsapp_url"].startswith("https://wa.me/?text=")
    ur = client.get(f"/api/v1/receivables/{sale['id']}/reminder?lang=ur", headers=h).json()
    assert "Rs. 38,000" in ur["message"] and "السلام" in ur["message"]


def test_ownership_isolation(client):
    a = onboard(client, "owner-a", demo=True)
    b = onboard(client, "owner-b")
    tx_id = client.get("/api/v1/transactions?page_size=1", headers=a).json()["items"][0]["id"]
    assert client.get(f"/api/v1/transactions/{tx_id}", headers=b).status_code == 404
    assert client.delete(f"/api/v1/transactions/{tx_id}", headers=b).status_code == 404
    rid = client.get("/api/v1/receivables", headers=a).json()["items"][0]["id"]
    assert client.post(f"/api/v1/receivables/{rid}/payments", headers=b, json={"amount_paisa": 100}).status_code == 404
    assert client.get("/api/v1/transactions", headers=b).json()["total"] == 0


def test_csv_import_preview_confirm_and_duplicates(client):
    h = onboard(client, "u5")
    tpl = client.get("/api/v1/import/templates/messy-sample.csv")
    assert tpl.status_code == 200
    files = {"file": ("messy.csv", tpl.content, "text/csv")}
    prev = client.post("/api/v1/import/preview", headers=h, files=files).json()
    assert prev["summary"]["accepted"] == 4 and prev["summary"]["rejected"] == 2 and prev["summary"]["duplicates"] == 1
    done = client.post("/api/v1/import/confirm", headers=h, json={"batch_id": prev["batch_id"]}).json()
    assert done["imported"] == 4
    assert client.post("/api/v1/import/confirm", headers=h, json={"batch_id": prev["batch_id"]}).status_code == 409
    again = client.post("/api/v1/import/preview", headers=h, files={"file": ("messy.csv", tpl.content, "text/csv")}).json()
    assert again["summary"]["accepted"] == 0 and again["summary"]["duplicates"] == 5
    assert client.get("/api/v1/transactions", headers=h).json()["total"] == 4


def test_csv_upload_restrictions(client):
    h = onboard(client, "u6")
    r = client.post("/api/v1/import/preview", headers=h, files={"file": ("data.xlsx", b"x", "application/octet-stream")})
    assert r.status_code == 415
    big = b"date,amount\n" + b"2026-10-01,100\n" * 200_000
    assert client.post("/api/v1/import/preview", headers=h, files={"file": ("big.csv", big, "text/csv")}).status_code == 413
    bad_map = client.post("/api/v1/import/preview", headers=h, data={"mapping": "[1,2]"},
                          files={"file": ("a.csv", b"date,amount\n2026-10-01,5\n", "text/csv")})
    assert bad_map.status_code == 422


def test_demo_story_dashboard_forecast_alerts(client):
    h = onboard(client, "demo-sme", "sme", demo=True)
    dash = client.get("/api/v1/dashboard", headers=h).json()
    k = dash["kpis"]
    assert k["cash_balance"]["value_paisa"] == 11_800_000
    assert k["shortage_risk"]["level"] == "high"
    assert {"actual", "estimated", "forecast", "index"} <= {v["type"] for v in k.values()}
    assert dash["recommended_actions"]
    alerts = client.get("/api/v1/alerts", headers=h).json()["items"]
    shortage = next(a for a in alerts if a["rule"] == "projected_shortage")
    for key in ("level", "score", "evidence", "amounts", "dates", "next_step", "limitations"):
        assert shortage[key]
    ack = client.post(f"/api/v1/alerts/{shortage['id']}/acknowledge", headers=h).json()
    assert ack["status"] == "acknowledged"


def test_scenarios_save_simulate_compare(client):
    h = onboard(client, "u7", "sme", demo=True)
    saved = client.get("/api/v1/scenarios", headers=h).json()["items"]
    assert len(saved) == 2
    a = client.post("/api/v1/scenarios", headers=h, json={
        "name": "Sales -20%", "adjustments": [{"type": "sales_decline", "percent": 20, "duration_days": 21}]}).json()
    b = client.post("/api/v1/scenarios", headers=h, json={
        "name": "Sales -20% + collect", "adjustments": [{"type": "sales_decline", "percent": 20, "duration_days": 21}],
        "actions": [{"type": "collect_receivables", "receivable_ids": [r["id"] for r in
                     client.get("/api/v1/receivables?status=overdue", headers=h).json()["items"]], "collect_percent": 50, "day": 5}]}).json()
    cmp = client.post("/api/v1/scenarios/compare", headers=h, json={"scenario_ids": [a["id"], b["id"]]}).json()
    mins = {s["name"]: s["summary"]["min_balance_paisa"] for s in cmp["scenarios"]}
    assert mins["Sales -20% + collect"] > mins["Sales -20%"]
    bad = client.post("/api/v1/scenarios/simulate", headers=h, json={"adjustments": [{"type": "nope"}]})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "invalid_adjustment"
    rec = client.post("/api/v1/recovery/recommendations", headers=h, json={"scenario_id": a["id"]}).json()
    assert rec["strategies"] and all("numerical_reasoning" in s for s in rec["strategies"])


def test_copilot_grounded_answers(client):
    h = onboard(client, "u8", "sme", demo=True)
    r = client.post("/api/v1/copilot/query", headers=h, json={"question": "Can I afford Rs 50,000 next week?"}).json()
    assert r["intent"] == "affordability" and r["data"]["affordable"] is False and r["evidence"]
    ur = client.post("/api/v1/copilot/query", headers=h, json={"question": "Explain my dashboard in simple Urdu"}).json()
    assert ur["language"] == "ur" and "Rs. 118,000" in ur["answer"]
    oos = client.post("/api/v1/copilot/query", headers=h, json={"question": "What is the gold price today?"}).json()
    assert oos["intent"] == "out_of_scope"


def test_reports_and_exports(client):
    h = onboard(client, "u9", "sme", demo=True)
    rep = client.get("/api/v1/reports/financial", headers=h).json()
    for key in ("executive_summary", "kpis", "risk_indicators", "forecast", "insights", "recommendations",
                "scenario_comparison", "data_quality", "limitations"):
        assert rep[key], key
    csv_text = client.get("/api/v1/reports/financial.csv", headers=h).text
    assert csv_text.startswith("section,metric")
    ledger = client.get("/api/v1/transactions/export.csv", headers=h)
    assert ledger.headers["content-type"].startswith("text/csv") and ledger.text.count("\n") > 100


def test_reset_and_clear(client):
    h = onboard(client, "u10", "sme", demo=True)
    first = client.get("/api/v1/forecast", headers=h).json()["summary"]
    client.post("/api/v1/business/clear", headers=h)
    assert client.get("/api/v1/transactions", headers=h).json()["total"] == 0
    client.post("/api/v1/business/reset-demo", headers=h)
    assert client.get("/api/v1/forecast", headers=h).json()["summary"] == first  # reproducible demo


def test_inventory_movement_does_not_touch_ledger_unless_asked(client):
    h = onboard(client, "u11")
    p = client.post("/api/v1/inventory/products", headers=h, json={
        "sku": "OIL", "name": "Oil 5L", "unit_cost_paisa": 265_000, "sale_price_paisa": 285_000, "opening_quantity": 10}).json()
    client.post("/api/v1/inventory/movements", headers=h, json={"product_id": p["id"], "movement_type": "sale", "quantity": 3})
    assert client.get("/api/v1/transactions", headers=h).json()["total"] == 0
    r = client.post("/api/v1/inventory/movements", headers=h, json={
        "product_id": p["id"], "movement_type": "sale", "quantity": 2, "record_in_ledger": True})
    assert r.json()["quantity_on_hand"] == 5
    assert client.get("/api/v1/transactions", headers=h).json()["items"][0]["amount_paisa"] == 570_000
    too_many = client.post("/api/v1/inventory/movements", headers=h, json={"product_id": p["id"], "movement_type": "sale", "quantity": 99})
    assert too_many.status_code == 422
    inv = client.get("/api/v1/inventory", headers=h).json()
    assert inv["total_value_paisa"] == 5 * 265_000


def test_impact_separates_measured_and_hypothetical(client):
    # SDG impact moved from every workspace to the public landing page (no login, no user data).
    h = onboard(client, "u12", "sme", demo=True)
    assert client.get("/api/v1/impact", headers=h).status_code == 403
    imp = client.get("/api/v1/public/benchmark").json()
    assert imp["businesses_evaluated"] == 120 and "synthetic" in imp["note"].lower()
    assert "not a measured outcome" in imp["hypothetical"]["caveat"]
    assert {t["target"] for t in imp["sdg_targets"]} == {"1.4", "1.5", "8.3", "9.3", "10.2"}


def test_demo_dates_rebase(client, db, monkeypatch):
    h = onboard(client, "u13", "sme", demo=True)
    before = client.get("/api/v1/forecast", headers=h).json()["summary"]
    from app import config

    monkeypatch.setattr(config, "today", lambda: TODAY.replace(day=TODAY.day + 3))
    import app.auth as auth_mod  # noqa: F401
    import app.routers.common as common
    import app.services.seed as seed

    monkeypatch.setattr(common, "get_today", lambda: TODAY.replace(day=TODAY.day + 3))
    monkeypatch.setattr(seed, "get_today", lambda: TODAY.replace(day=TODAY.day + 3))
    after = client.get("/api/v1/forecast", headers=h).json()["summary"]
    assert after["min_balance_paisa"] == before["min_balance_paisa"]
    assert after["days_to_shortage"] == before["days_to_shortage"]


def test_warmup_is_public_and_returns_no_data(client):
    r = client.get("/api/v1/warmup")
    assert r.status_code == 204 and r.content == b""
