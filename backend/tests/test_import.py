"""CSV import: settlement tracking, user-confirmed duplicates, row corrections, atomicity, provenance."""
from conftest import onboard

API = "/api/v1"


def _preview(client, h, text: str):
    r = client.post(f"{API}/import/preview", headers=h, files={"file": ("f.csv", text.encode(), "text/csv")})
    assert r.status_code == 200, r.text
    return r.json()


def _invoice(client, h, amount=100_000, customer="Ali"):
    r = client.post(f"{API}/transactions", headers=h, json={"occurred_on": "2026-10-01", "kind": "credit_sale",
                                                             "amount_paisa": amount, "customer_name": customer,
                                                             "due_on": "2026-10-20"})
    return r.json()["receivable_id"]


def test_two_payments_in_one_file_cannot_oversettle_an_invoice(client):
    h = onboard(client, "imp1")
    rid = _invoice(client, h)  # Rs. 1,000
    p = _preview(client, h, "date,type,amount,party,description\n2026-10-08,customer_payment,800,Ali,part 1\n"
                            "2026-10-09,customer_payment,800,Ali,part 2\n")
    assert p["rows"][0]["settles"]["id"] == rid
    assert p["rows"][1]["settles"]["type"] is None and "income" in p["rows"][1]["settles"]["note"]
    done = client.post(f"{API}/import/confirm", headers=h, json={"batch_id": p["batch_id"]}).json()
    assert done["imported"] == 2 and done["unmatched_payments"] == 1
    rec = next(r for r in client.get(f"{API}/receivables", headers=h).json()["items"] if r["id"] == rid)
    assert rec["outstanding_paisa"] == 20_000  # 1,000 - 800, never negative
    kinds = sorted(t["kind"] for t in client.get(f"{API}/transactions?kind=income,customer_payment", headers=h).json()["items"])
    assert kinds == ["customer_payment", "income"]


def test_payment_can_settle_a_credit_sale_from_earlier_in_the_same_file(client):
    h = onboard(client, "imp2")
    p = _preview(client, h, "date,type,amount,party,due_date\n2026-10-01,credit sale,5000,Bilal,2026-10-30\n"
                            "2026-10-05,customer_payment,2000,Bilal,\n")
    assert p["rows"][1]["settles"]["type"] == "receivable"
    done = client.post(f"{API}/import/confirm", headers=h, json={"batch_id": p["batch_id"]}).json()
    assert done["unmatched_payments"] == 0
    rec = client.get(f"{API}/receivables", headers=h).json()["items"][0]
    assert rec["outstanding_paisa"] == 300_000


def test_identical_rows_can_both_be_imported_when_the_user_confirms(client):
    h = onboard(client, "imp3")
    text = "date,type,amount,description\n2026-10-08,income,500,Cash sale\n2026-10-08,income,500,Cash sale\n"
    p = _preview(client, h, text)
    assert [r["status"] for r in p["rows"]] == ["accepted", "duplicate"]
    done = client.post(f"{API}/import/confirm", headers=h, json={"batch_id": p["batch_id"], "include_duplicates": [3]}).json()
    assert done["imported"] == 2 and done["duplicates_included"] == 1
    # without confirmation the duplicate is skipped and reported, never silently merged
    p2 = _preview(client, h, text.replace("Cash sale", "Counter sale"))
    done2 = client.post(f"{API}/import/confirm", headers=h, json={"batch_id": p2["batch_id"]}).json()
    assert done2["imported"] == 1 and done2["skipped_duplicates"] == 1
    assert client.get(f"{API}/transactions", headers=h).json()["total"] == 3


def test_rejected_row_can_be_corrected_then_imported_with_provenance(client):
    h = onboard(client, "imp4")
    p = _preview(client, h, "date,amount,description\n31/02/2026,1500,Bad date\n2026-10-02,abc,Bad amount\n")
    assert [r["status"] for r in p["rows"]] == ["rejected", "rejected"]
    fix = client.put(f"{API}/import/batches/{p['batch_id']}/rows/2", headers=h,
                     json={"date": "2026-10-02", "kind": "expense", "amount_paisa": 150_000, "category": "Repairs"})
    assert fix.status_code == 200, fix.text
    row = fix.json()["row"]
    assert row["status"] == "accepted" and row["corrected"] and row["original"]["date"] is None
    assert fix.json()["summary"]["accepted"] == 1 and fix.json()["summary"]["corrected"] == 1
    bad = client.put(f"{API}/import/batches/{p['batch_id']}/rows/3", headers=h,
                     json={"date": "2030-01-01", "kind": "income", "amount_paisa": 100})
    assert bad.json()["row"]["status"] == "rejected" and "future" in bad.json()["row"]["reasons"][0]
    assert client.put(f"{API}/import/batches/{p['batch_id']}/rows/3", headers=h, json={"amount_paisa": -5}).status_code == 422
    done = client.post(f"{API}/import/confirm", headers=h, json={"batch_id": p["batch_id"]}).json()
    assert done["imported"] == 1 and done["rejected"] == 1
    tx = client.get(f"{API}/transactions", headers=h).json()["items"][0]
    assert tx["source"] == "import" and tx["amount_paisa"] == 150_000 and tx["category"] == "Repairs"
    hist = client.get(f"{API}/audit?entity_type=import_batch", headers=h).json()["items"][0]
    assert hist["changes"]["transaction_ids"] == [tx["id"]]
    other = onboard(client, "imp4-other")
    assert client.put(f"{API}/import/batches/{p['batch_id']}/rows/2", headers=other, json={"amount_paisa": 1}).status_code == 404


def test_import_is_atomic_when_something_fails_midway(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    from app.routers import imports
    from conftest import onboard as ob

    client = TestClient(app, raise_server_exceptions=False)
    h = ob(client, "imp5")
    p = _preview(client, h, "date,type,amount,party,description\n2026-10-01,income,100,,ok\n"
                            "2026-10-02,credit sale,200,Zed,boom\n")
    monkeypatch.setattr(imports, "get_or_create_customer", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("db down")))
    assert client.post(f"{API}/import/confirm", headers=h, json={"batch_id": p["batch_id"]}).status_code == 500
    assert client.get(f"{API}/transactions", headers=h).json()["total"] == 0  # the first row was rolled back too
    monkeypatch.undo()
    assert client.post(f"{API}/import/confirm", headers=h, json={"batch_id": p["batch_id"]}).json()["imported"] == 2
