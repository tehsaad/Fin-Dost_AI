"""The 12-step integration path: workspace -> ledger -> forecast -> warning -> shock -> report -> isolation."""
import csv
import io

from conftest import onboard

API = "/api/v1"


def test_full_workflow_reconciles_end_to_end(client):
    # 1. isolated workspace (opening cash Rs. 20,000)
    h = onboard(client, "flow-owner")
    client.put(f"{API}/business", headers=h, json={"opening_cash_paisa": 2_000_000, "opening_date": "2026-10-01",
                                                   "cash_reserve_paisa": 500_000})
    post = lambda body: client.post(f"{API}/transactions", headers=h, json=body)  # noqa: E731
    # 2. income and expense
    assert post({"occurred_on": "2026-10-02", "kind": "income", "amount_paisa": 1_000_000, "description": "Sales"}).status_code == 201
    assert post({"occurred_on": "2026-10-03", "kind": "expense", "amount_paisa": 400_000, "category": "Rent",
                 "description": "Rent"}).status_code == 201
    # 3. credit sale Rs. 15,000
    sale = post({"occurred_on": "2026-10-04", "kind": "credit_sale", "amount_paisa": 1_500_000, "customer_name": "Kamran",
                 "due_on": "2026-10-25"}).json()
    # 4. partial payment Rs. 5,000
    pay = client.post(f"{API}/receivables/{sale['receivable_id']}/payments", headers=h,
                      json={"amount_paisa": 500_000, "occurred_on": "2026-10-06"})
    assert pay.status_code == 201
    # 5. cash = 20,000 + 10,000 - 4,000 + 5,000 = 31,000 ; receivable 10,000 ; revenue 25,000 (payment is not revenue)
    k = client.get(f"{API}/dashboard", headers=h).json()["kpis"]
    assert k["cash_balance"]["value_paisa"] == 3_100_000
    assert k["receivables"]["value_paisa"] == 1_000_000
    assert k["revenue"]["value_paisa"] == 2_500_000
    # 6. forecast with a big bill due in 5 days -> shortage
    client.post(f"{API}/payables", headers=h, json={"supplier_name": "Metro", "category": "Inventory Purchase",
                                                     "amount_paisa": 4_000_000, "issued_on": "2026-10-05", "due_on": "2026-10-15"})
    fc = client.get(f"{API}/forecast", headers=h).json()
    assert fc["summary"]["opening_balance_paisa"] == 3_100_000
    assert fc["summary"]["shortage_date"] == "2026-10-15"
    # 7. early warning traceable to the bill
    alerts = client.get(f"{API}/alerts", headers=h).json()["items"]
    shortage = next(a for a in alerts if a["rule"] == "projected_shortage")
    assert any(r["type"] == "payable" for r in shortage["records"])
    # 8-9. shock: unexpected Rs. 2,000 expense on day 2 lowers the minimum by exactly Rs. 2,000
    sim = client.post(f"{API}/scenarios/simulate", headers=h, json={"adjustments": [
        {"type": "unexpected_expense", "amount_paisa": 200_000, "day": 2}]}).json()
    assert sim["comparison"]["min_balance_change_paisa"] == -200_000
    assert client.get(f"{API}/dashboard", headers=h).json()["kpis"]["cash_balance"]["value_paisa"] == 3_100_000
    # 10-11. report export reconciles with the ledger
    rows = list(csv.reader(io.StringIO(client.get(f"{API}/reports/financial.csv", headers=h).text)))
    vals = {r[1]: r[2] for r in rows if r[0] in ("period", "kpi")}
    assert float(vals["Closing cash"]) == 31_000.0 and float(vals["Receivables outstanding"]) == 10_000.0
    assert float(vals["Revenue"]) == 25_000.0
    ledger = list(csv.DictReader(io.StringIO(client.get(f"{API}/transactions/export.csv", headers=h).text)))
    assert len(ledger) == 4 and {r["type"] for r in ledger} == {"income", "expense", "credit_sale", "customer_payment"}
    # 12. a second user sees none of it
    other = onboard(client, "flow-other")
    assert client.get(f"{API}/transactions", headers=other).json()["total"] == 0
    assert client.get(f"{API}/receivables", headers=other).json()["items"] == []
    assert client.get(f"{API}/forecast", headers=other).json()["summary"]["opening_balance_paisa"] == 0
    assert client.get(f"{API}/transactions/{sale['id']}", headers=other).status_code == 404


def test_empty_workspace_exports_gracefully(client):
    h = onboard(client, "empty-owner")
    rep = client.get(f"{API}/reports/financial.csv", headers=h)
    assert rep.status_code == 200 and "Closing cash" in rep.text
    led = client.get(f"{API}/transactions/export.csv", headers=h)
    assert led.status_code == 200 and led.text.strip().count("\n") == 0
    assert client.get(f"{API}/reports/financial", headers=h).json()["period"]["closing_cash_paisa"] == 0
