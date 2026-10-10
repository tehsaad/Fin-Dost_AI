"""Ledger correctness: hand-calculated reconciliation, linked-record sync, audit history, isolation."""
from conftest import onboard

API = "/api/v1"


def _tx(client, h, **body):
    r = client.post(f"{API}/transactions", headers=h, json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _hand_ledger(client):
    """Opening cash Rs. 10,000 on 2026-09-30, then one of every money movement.

    Hand calculation (rupees):
      cash   = 10,000 + 5,000 sale - 2,000 expense - 1,000 supplier - 500 drawings + 4,000 loan - 1,000 transfer = 14,500
      bank   = 3,000 customer payment + 1,000 transfer = 4,000          -> total cash 18,500
      revenue  = 5,000 cash sale + 8,000 credit sale = 13,000 (loan and customer payment are not revenue)
      expenses = 2,000 expense + 6,000 credit purchase = 8,000 (supplier payment, drawings, loan are not expenses)
      profit = 5,000 · receivables = 8,000 - 3,000 = 5,000 · payables = 6,000 - 1,000 = 5,000
    """
    h = onboard(client, "ledger-owner")
    assert client.put(f"{API}/business", headers=h,
                      json={"opening_cash_paisa": 1_000_000, "opening_date": "2026-09-30"}).status_code == 200
    _tx(client, h, occurred_on="2026-10-01", kind="income", amount_paisa=500_000, description="Cash sale")
    _tx(client, h, occurred_on="2026-10-02", kind="expense", amount_paisa=200_000, category="Rent", description="Rent")
    sale = _tx(client, h, occurred_on="2026-10-03", kind="credit_sale", amount_paisa=800_000, customer_name="Ali",
               due_on="2026-10-20")
    _tx(client, h, occurred_on="2026-10-05", kind="customer_payment", amount_paisa=300_000, account="bank",
        receivable_id=sale["receivable_id"])
    buy = _tx(client, h, occurred_on="2026-10-04", kind="credit_purchase", amount_paisa=600_000,
              supplier_name="Metro", category="Inventory Purchase", due_on="2026-10-25")
    _tx(client, h, occurred_on="2026-10-06", kind="supplier_payment", amount_paisa=100_000, payable_id=buy["payable_id"])
    _tx(client, h, occurred_on="2026-10-07", kind="owner_withdrawal", amount_paisa=50_000)
    _tx(client, h, occurred_on="2026-10-08", kind="loan_received", amount_paisa=400_000)
    _tx(client, h, occurred_on="2026-10-09", kind="transfer", amount_paisa=100_000, account="cash", to_account="bank")
    return h, sale, buy


def test_hand_calculated_reconciliation_across_dashboard_report_and_exports(client):
    h, _, _ = _hand_ledger(client)
    k = client.get(f"{API}/dashboard", headers=h).json()["kpis"]
    assert k["cash_balance"]["value_paisa"] == 1_850_000
    assert k["cash_balance"]["accounts"] == {"cash": 1_450_000, "bank": 400_000, "wallet": 0}
    assert k["revenue"]["value_paisa"] == 1_300_000
    assert (k["revenue"]["cash_paisa"], k["revenue"]["credit_paisa"]) == (500_000, 800_000)
    assert k["expenses"]["value_paisa"] == 800_000
    assert k["net_profit"]["value_paisa"] == 500_000
    assert k["receivables"]["value_paisa"] == 500_000

    rep = client.get(f"{API}/reports/financial", headers=h).json()
    assert rep["kpis"]["cash_balance"]["value_paisa"] == 1_850_000
    assert rep["kpis"]["revenue"]["value_paisa"] == 1_300_000
    assert rep["forecast"]["summary"]["opening_balance_paisa"] == 1_850_000
    period = rep["period"]
    assert period["closing_cash_paisa"] == 1_850_000
    # closing - opening equals the sum of cash movements inside the period
    assert period["closing_cash_paisa"] - period["opening_cash_paisa"] == period["cash_in_paisa"] - period["cash_out_paisa"]

    pays = client.get(f"{API}/payables", headers=h).json()["items"]
    assert sum(p["outstanding_paisa"] for p in pays) == 500_000

    csv_text = client.get(f"{API}/reports/financial.csv", headers=h).text
    assert "Cash balance,18500.0" in csv_text and "Revenue (30d),13000.0" in csv_text

    ledger_csv = client.get(f"{API}/transactions/export.csv", headers=h).text.strip().splitlines()
    assert len(ledger_csv) == 1 + 9


def test_money_is_exact_in_paisa(client):
    h = onboard(client, "precise")
    for _ in range(10):
        _tx(client, h, occurred_on="2026-10-09", kind="income", amount_paisa=10, description="ten paisa")
    _tx(client, h, occurred_on="2026-10-09", kind="income", amount_paisa=20, description="twenty paisa")
    k = client.get(f"{API}/dashboard", headers=h).json()["kpis"]
    assert k["cash_balance"]["value_paisa"] == 120  # 0.10 x 10 + 0.20, no float drift
    assert client.post(f"{API}/transactions", headers=h, json={"occurred_on": "2026-10-09", "kind": "income",
                                                                "amount_paisa": 1.5}).status_code == 422


def test_editing_credit_sale_date_moves_the_invoice_and_is_audited(client):
    h, sale, buy = _hand_ledger(client)
    r = client.put(f"{API}/transactions/{sale['id']}", headers=h, json={"occurred_on": "2026-10-04", "amount_paisa": 900_000})
    assert r.status_code == 200, r.text
    rec = next(x for x in client.get(f"{API}/receivables", headers=h).json()["items"] if x["id"] == sale["receivable_id"])
    assert rec["issued_on"] == "2026-10-04" and rec["amount_paisa"] == 900_000 and rec["outstanding_paisa"] == 600_000
    # a new date after the due date is refused instead of producing an invoice due before it was issued
    bad = client.put(f"{API}/transactions/{buy['id']}", headers=h, json={"occurred_on": "2026-10-26"})
    assert bad.status_code == 422
    history = client.get(f"{API}/audit?entity_id={sale['id']}", headers=h).json()["items"]
    assert [e["action"] for e in history] == ["update", "create"]
    assert history[0]["changes"]["fields"]["occurred_on"] == {"from": "2026-10-03", "to": "2026-10-04"}
    rec_hist = client.get(f"{API}/audit?entity_id={sale['receivable_id']}", headers=h).json()["items"]
    assert rec_hist[0]["changes"]["fields"]["issued_on"]["to"] == "2026-10-04"


def test_delete_is_audited_and_overpayment_refused(client):
    h, sale, _ = _hand_ledger(client)
    over = client.post(f"{API}/receivables/{sale['receivable_id']}/payments", headers=h, json={"amount_paisa": 500_001})
    assert over.status_code == 422 and over.json()["error"]["code"] == "overpayment"
    tx = _tx(client, h, occurred_on="2026-10-09", kind="expense", amount_paisa=12_300, description="Tea")
    assert client.delete(f"{API}/transactions/{tx['id']}", headers=h).status_code == 204
    events = client.get(f"{API}/audit?entity_id={tx['id']}", headers=h).json()["items"]
    assert events[0]["action"] == "delete" and events[0]["changes"]["before"]["amount_paisa"] == 12_300
    # a credit sale with payments cannot be deleted (would orphan cash that was actually received)
    assert client.delete(f"{API}/transactions/{sale['id']}", headers=h).status_code == 409


def test_cross_user_isolation_on_every_record_type(client):
    a, sale, buy = _hand_ledger(client)
    b = onboard(client, "intruder")
    sc = client.post(f"{API}/scenarios", headers=a, json={"name": "A's plan",
                                                          "adjustments": [{"type": "sales_decline", "percent": 10}]}).json()
    alert_id = client.get(f"{API}/alerts", headers=a).json()["items"][0]["id"]
    batch = client.post(f"{API}/import/preview", headers=a,
                        files={"file": ("a.csv", b"date,amount,description\n2026-10-08,500,Sale\n", "text/csv")}).json()
    probes = [
        ("get", f"/transactions/{sale['id']}", None),
        ("put", f"/transactions/{sale['id']}", {"description": "hacked"}),
        ("delete", f"/transactions/{sale['id']}", None),
        ("put", f"/receivables/{sale['receivable_id']}", {"description": "x"}),
        ("post", f"/receivables/{sale['receivable_id']}/payments", {"amount_paisa": 100}),
        ("get", f"/receivables/{sale['receivable_id']}/reminder", None),
        ("put", f"/payables/{buy['payable_id']}", {"description": "x"}),
        ("post", f"/payables/{buy['payable_id']}/payments", {"amount_paisa": 100}),
        ("delete", f"/payables/{buy['payable_id']}", None),
        ("get", f"/scenarios/{sc['id']}", None),
        ("delete", f"/scenarios/{sc['id']}", None),
        ("post", f"/alerts/{alert_id}/acknowledge", None),
        ("post", "/import/confirm", {"batch_id": batch["batch_id"]}),
        ("post", "/transactions", {"occurred_on": "2026-10-09", "kind": "customer_payment", "amount_paisa": 100,
                                   "receivable_id": sale["receivable_id"]}),
    ]
    for method, path, body in probes:
        kwargs = {"json": body} if body is not None else {}
        r = getattr(client, method)(f"{API}{path}", headers=b, **kwargs)
        assert r.status_code == 404, (method, path, r.status_code)
    assert client.get(f"{API}/audit", headers=b).json()["items"] == []
    assert client.get(f"{API}/transactions/export.csv", headers=b).text.strip().count("\n") == 0
    assert client.get(f"{API}/import/batches", headers=b).json()["items"] == []
    # A's records are untouched
    assert client.get(f"{API}/transactions/{sale['id']}", headers=a).json()["description"] != "hacked"


def test_unhandled_errors_return_json_with_request_id(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    from app.routers import analytics

    def boom():
        raise RuntimeError("secret detail Rs. 123")

    monkeypatch.setattr(analytics, "run_benchmark", boom)
    r = TestClient(app, raise_server_exceptions=False).get(f"{API}/public/benchmark")
    assert r.status_code == 500
    body = r.json()
    assert body["error"]["code"] == "internal_error" and "secret" not in r.text
    assert body["error"]["details"]["request_id"] == r.headers["x-request-id"]
