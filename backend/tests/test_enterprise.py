"""Shared enterprise workspaces, roles, invitations, budgets, goals, data checks and the action workflow."""
import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from conftest import onboard

from app.models import WorkspaceInvitation

API = "/api/v1"
SECRET = "test-secret-findost-unit-tests-000001"


def user(uid: str, email: str | None = None, anonymous: bool = False) -> dict:
    claims = {"sub": uid, "aud": "authenticated", "role": "authenticated", "exp": int(time.time()) + 3600,
              "email": email or f"{uid}@example.com", "is_anonymous": anonymous}
    return {"Authorization": "Bearer " + jwt.encode(claims, SECRET, algorithm="HS256")}


def in_ws(headers: dict, workspace_id: str) -> dict:
    return {**headers, "X-Workspace-Id": workspace_id}


def setup_company(client):
    owner = user("cfo", "cfo@company.pk")
    r = client.post(f"{API}/onboarding", headers=owner, json={"kind": "enterprise", "business_name": "Indus", "load_demo": True})
    assert r.status_code == 201
    ws = r.json()["business"]["id"]
    return owner, ws


def invite_and_join(client, owner, ws, uid, role):
    email = f"{uid}@company.pk"
    r = client.post(f"{API}/team/invitations", headers=owner, json={"email": email, "role": role})
    assert r.status_code == 201, r.text
    token = r.json()["invite_link"].split("token=")[1]
    member = user(uid, email)
    acc = client.post(f"{API}/invitations/accept", headers=member, json={"token": token})
    assert acc.status_code == 200 and acc.json()["workspace_id"] == ws
    return in_ws(member, ws), token


# ---------------------------------------------------------------- invitations

def test_invitation_is_single_use_recipient_bound_and_honest_about_email(client):
    owner, ws = setup_company(client)
    r = client.post(f"{API}/team/invitations", headers=owner, json={"email": "Analyst@Company.pk", "role": "viewer"})
    body = r.json()
    assert body["email"] == "analyst@company.pk" and body["email_sent"] is False and "no email was sent" in body["message"]
    token = body["invite_link"].split("token=")[1]
    assert client.post(f"{API}/invitations/accept", headers=user("intruder", "x@evil.pk"), json={"token": token}).status_code == 403
    assert client.post(f"{API}/invitations/accept", headers=user("anon", "analyst@company.pk", anonymous=True),
                       json={"token": token}).status_code == 403
    assert client.post(f"{API}/invitations/accept", headers=user("guess"), json={"token": "x" * 43}).status_code == 404
    ok = client.post(f"{API}/invitations/accept", headers=user("analyst", "analyst@company.pk"), json={"token": token})
    assert ok.status_code == 200 and ok.json()["role"] == "viewer"
    replay = client.post(f"{API}/invitations/accept", headers=user("analyst2", "analyst@company.pk"), json={"token": token})
    assert replay.status_code == 404


def test_revoked_and_expired_invitations_cannot_be_redeemed(client, db):
    owner, ws = setup_company(client)
    r = client.post(f"{API}/team/invitations", headers=owner, json={"email": "a@company.pk", "role": "editor"}).json()
    token = r["invite_link"].split("token=")[1]
    assert client.delete(f"{API}/team/invitations/{r['id']}", headers=owner).status_code == 204
    assert client.post(f"{API}/invitations/accept", headers=user("a", "a@company.pk"), json={"token": token}).status_code == 404
    r2 = client.post(f"{API}/team/invitations", headers=owner, json={"email": "b@company.pk", "role": "editor"}).json()
    inv = db.get(WorkspaceInvitation, r2["id"])
    inv.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()
    tok2 = r2["invite_link"].split("token=")[1]
    assert client.post(f"{API}/invitations/accept", headers=user("b", "b@company.pk"), json={"token": tok2}).status_code == 410


# ---------------------------------------------------------------- roles and isolation

def test_viewer_reads_and_exports_but_cannot_change_anything(client):
    owner, ws = setup_company(client)
    viewer, _ = invite_and_join(client, owner, ws, "viewer1", "viewer")
    assert client.get(f"{API}/transactions", headers=viewer).json()["total"] > 0
    assert client.get(f"{API}/transactions/export.csv", headers=viewer).status_code == 200
    assert client.get(f"{API}/reports/financial.csv", headers=viewer).status_code == 200
    assert client.post(f"{API}/scenarios/simulate", headers=viewer,
                       json={"adjustments": [{"type": "sales_decline", "percent": 10}]}).status_code == 200
    tx = client.get(f"{API}/transactions?page_size=1", headers=viewer).json()["items"][0]
    denied = [
        client.post(f"{API}/transactions", headers=viewer, json={"occurred_on": "2026-10-09", "kind": "income", "amount_paisa": 100}),
        client.put(f"{API}/transactions/{tx['id']}", headers=viewer, json={"description": "x"}),
        client.delete(f"{API}/transactions/{tx['id']}", headers=viewer),
        client.put(f"{API}/budgets", headers=viewer, json={"category": "Rent", "monthly_amount_paisa": 100}),
        client.post(f"{API}/team/invitations", headers=viewer, json={"email": "z@company.pk", "role": "owner"}),
        client.put(f"{API}/account/settings", headers=viewer, json={"ai_assistance_enabled": True}),
        client.post(f"{API}/actions", headers=viewer, json={"title": "Do something"}),
    ]
    assert [r.status_code for r in denied] == [403] * len(denied)
    assert client.get(f"{API}/transactions/{tx['id']}", headers=owner).json()["description"] != "x"


def test_editor_works_records_but_cannot_administer_or_approve(client):
    owner, ws = setup_company(client)
    editor, _ = invite_and_join(client, owner, ws, "acct1", "editor")
    r = client.post(f"{API}/transactions", headers=editor, json={"occurred_on": "2026-10-09", "kind": "expense",
                                                                  "amount_paisa": 12_345, "category": "Stationery"})
    assert r.status_code == 201
    hist = client.get(f"{API}/audit?entity_id={r.json()['id']}", headers=owner).json()["items"]
    assert hist  # the owner sees the editor's change in the shared audit log
    a = client.post(f"{API}/actions", headers=editor, json={"title": "Follow up overdue invoices"}).json()
    assert client.post(f"{API}/actions/{a['id']}/submit", headers=editor).status_code == 200
    assert client.post(f"{API}/actions/{a['id']}/approve", headers=editor).status_code == 403
    assert client.post(f"{API}/team/invitations", headers=editor, json={"email": "q@company.pk", "role": "viewer"}).status_code == 403
    assert client.put(f"{API}/business", headers=editor, json={"name": "Hijacked"}).status_code == 403
    assert client.post(f"{API}/business/reset-demo", headers=editor).status_code == 403


def test_outsiders_cannot_reach_a_workspace_by_id_and_removed_members_lose_access(client):
    owner, ws = setup_company(client)
    viewer, _ = invite_and_join(client, owner, ws, "temp", "viewer")
    outsider = user("outsider")
    client.post(f"{API}/onboarding", headers=outsider, json={"kind": "sme", "business_name": "Mine", "load_demo": False})
    for path in ("/transactions", "/transactions/export.csv", "/reports/financial", "/forecast", "/team", "/audit"):
        assert client.get(f"{API}{path}", headers=in_ws(outsider, ws)).status_code == 404, path
    assert client.get(f"{API}/transactions", headers=outsider).json()["total"] == 0  # own workspace, untouched
    assert client.get(f"{API}/transactions", headers=viewer).status_code == 200
    assert client.delete(f"{API}/team/members/cfo", headers=owner).status_code == 409  # creator is protected
    assert client.delete(f"{API}/team/members/temp", headers=owner).status_code == 204
    assert client.get(f"{API}/transactions", headers=viewer).status_code == 404  # immediately
    me = client.get(f"{API}/me", headers=user("temp", "temp@company.pk")).json()
    assert me["needs_onboarding"] is True and me["workspaces"] == []


def test_me_lists_workspaces_and_single_user_accounts_still_work(client):
    owner, ws = setup_company(client)
    member, _ = invite_and_join(client, owner, ws, "dual", "editor")
    own = user("dual", "dual@company.pk")
    client.post(f"{API}/onboarding", headers=own, json={"kind": "household", "business_name": "Home", "load_demo": False})
    me = client.get(f"{API}/me", headers=own).json()
    assert [w["role"] for w in me["workspaces"]] == ["owner", "editor"] and me["business"]["kind"] == "household"
    assert client.get(f"{API}/me", headers=member).json()["business"]["id"] == ws
    assert client.get(f"{API}/me", headers=owner).json()["role"] == "owner"
    assert client.get(f"{API}/dashboard", headers=owner).status_code == 200


# ---------------------------------------------------------------- account types

@pytest.mark.parametrize("kind,allowed,denied", [
    ("student", ["/budgets", "/goals", "/forecast"], ["/inventory", "/receivables", "/controls", "/actions", "/team", "/impact"]),
    ("household", ["/budgets", "/goals"], ["/inventory", "/controls", "/team"]),
    ("sme", ["/inventory", "/controls", "/actions", "/budgets"], ["/team", "/goals", "/impact"]),
    ("enterprise", ["/inventory", "/controls", "/actions", "/team", "/budgets"], ["/goals", "/impact"]),
])
def test_modules_follow_the_account_type(client, kind, allowed, denied):
    h = onboard(client, f"kind-{kind}", kind, demo=True)
    for path in allowed:
        assert client.get(f"{API}{path}", headers=h).status_code == 200, (kind, path)
    for path in denied:
        assert client.get(f"{API}{path}", headers=h).status_code == 403, (kind, path)


def test_personal_scenarios_use_personal_presets_and_income_delay(client):
    h = onboard(client, "stud-sim", "student", demo=True)
    presets = client.get(f"{API}/scenarios/presets", headers=h).json()["presets"]
    labels = " ".join(p["label"] for p in presets)
    assert "allowance" in labels.lower() and "Shop" not in labels and "Supplier" not in labels
    sim = client.post(f"{API}/scenarios/simulate", headers=h, json={"adjustments": [{"type": "income_delay", "delay_days": 10}]}).json()
    assert any("late" in n for n in sim["notes"])
    rec = client.post(f"{API}/recovery/recommendations", headers=h, json={}).json()
    assert all("supplier" not in s["title"].lower() and "stock" not in s["title"].lower() for s in rec["strategies"])


# ---------------------------------------------------------------- budgets, goals, controls

def test_budget_vs_actual_and_overrun_alert(client):
    h = onboard(client, "budget-owner", "household")
    client.post(f"{API}/transactions", headers=h, json={"occurred_on": "2026-10-03", "kind": "expense", "amount_paisa": 600_000,
                                                         "category": "Groceries", "description": "Monthly ration"})
    client.post(f"{API}/transactions", headers=h, json={"occurred_on": "2026-10-05", "kind": "expense", "amount_paisa": 150_000,
                                                         "category": "Utilities", "description": "Electricity"})
    assert client.get(f"{API}/budgets", headers=h).json()["has_budgets"] is False
    client.put(f"{API}/budgets", headers=h, json={"category": "Groceries", "monthly_amount_paisa": 500_000})
    client.put(f"{API}/budgets", headers=h, json={"category": "Utilities", "monthly_amount_paisa": 300_000})
    rep = client.get(f"{API}/budgets", headers=h).json()
    lines = {l["category"]: l for l in rep["lines"]}
    assert lines["Groceries"]["actual_paisa"] == 600_000 and lines["Groceries"]["status"] == "over"
    assert lines["Groceries"]["variance_paisa"] == -100_000 and lines["Utilities"]["used_pct"] == 50.0
    assert rep["totals"] == {"budget_paisa": 800_000, "actual_paisa": 750_000, "variance_paisa": 50_000}
    alert = next(a for a in client.get(f"{API}/alerts", headers=h).json()["items"] if a["rule"] == "budget_overrun")
    assert alert["impact_paisa"] == 100_000 and "Groceries" in alert["title"]
    assert client.get(f"{API}/reports/financial", headers=h).json()["budget"]["totals"]["actual_paisa"] == 750_000


def test_savings_goal_monthly_need(client):
    h = onboard(client, "goal-owner", "student", demo=True)
    g = client.post(f"{API}/goals", headers=h, json={"name": "Laptop", "target_paisa": 12_000_000, "saved_paisa": 2_000_000,
                                                      "target_date": "2027-04-10"}).json()
    assert g["remaining_paisa"] == 10_000_000 and g["progress_pct"] == pytest.approx(16.7)
    assert g["monthly_needed_paisa"] == round(10_000_000 / (182 / 30.44))
    assert g["status"] in ("on_track", "at_risk") and g["note"]
    assert client.post(f"{API}/goals", headers=h, json={"name": "Past", "target_paisa": 1, "target_date": "2026-01-01"}).status_code == 422


def test_data_checks_flag_records_without_changing_them(client):
    h = onboard(client, "checks-owner", "enterprise")
    client.put(f"{API}/business", headers=h, json={"opening_cash_paisa": 10_000_000, "opening_date": "2026-09-01"})
    for d in ("2026-10-07", "2026-10-08"):
        client.post(f"{API}/transactions", headers=h, json={"occurred_on": d, "kind": "expense", "amount_paisa": 450_000,
                                                             "category": "Utilities", "description": "K-Electric bill"})
    client.post(f"{API}/transactions", headers=h, json={"occurred_on": "2026-10-08", "kind": "expense", "amount_paisa": 9_900,
                                                         "category": "Uncategorized", "description": "??"})
    before = client.get(f"{API}/transactions", headers=h).json()["total"]
    checks = {c["id"]: c for c in client.get(f"{API}/controls", headers=h).json()["checks"]}
    assert checks["possible_duplicates"]["count"] == 1 and checks["uncategorized"]["count"] == 1
    assert checks["cash_totals"]["status"] == "pass"
    assert client.get(f"{API}/transactions", headers=h).json()["total"] == before


# ---------------------------------------------------------------- the end-to-end enterprise workflow

def test_enterprise_workflow_import_to_approved_action(client):
    owner, ws = setup_company(client)
    editor, _ = invite_and_join(client, owner, ws, "fin-editor", "editor")
    # 1-2. editor imports a CSV; one row needs correction before it can be imported
    csv = ("date,type,amount,category,description,party,due_date\n"
           "2026-10-08,income,250000,Sales,Counter sales,,\n"
           "2026-10-09,credit sale,400000,Sales,Order 77,Karachi Mart,2026-10-30\n"
           "2026-10-09,out,abc,Utilities,Gas bill,,\n")
    prev = client.post(f"{API}/import/preview", headers=editor, files={"file": ("q4.csv", csv.encode(), "text/csv")}).json()
    assert [r["status"] for r in prev["rows"]] == ["accepted", "accepted", "rejected"]
    fixed = client.put(f"{API}/import/batches/{prev['batch_id']}/rows/4", headers=editor,
                       json={"amount_paisa": 3_200_000, "kind": "expense", "category": "Utilities"}).json()["row"]
    assert fixed["status"] == "accepted"
    before = client.get(f"{API}/dashboard", headers=owner).json()["kpis"]
    done = client.post(f"{API}/import/confirm", headers=editor, json={"batch_id": prev["batch_id"]}).json()
    assert done["imported"] == 3
    # 3-4. persisted with correct semantics: credit sale is revenue + receivable, not cash
    after = client.get(f"{API}/dashboard", headers=owner).json()["kpis"]
    assert after["cash_balance"]["value_paisa"] - before["cash_balance"]["value_paisa"] == 25_000_000 - 3_200_000
    assert after["receivables"]["value_paisa"] - before["receivables"]["value_paisa"] == 40_000_000
    # 5-7. forecast and a risk with its evidence
    fc = client.get(f"{API}/forecast", headers=editor).json()
    assert fc["summary"]["opening_balance_paisa"] == after["cash_balance"]["value_paisa"]
    alerts = client.get(f"{API}/alerts", headers=editor).json()["items"]
    risk = next(a for a in alerts if a["rule"] in ("projected_shortage", "overdue_receivables"))
    assert risk["records"]
    # 8. simulate a remedy without touching the ledger
    total = client.get(f"{API}/transactions", headers=owner).json()["total"]
    rec = client.post(f"{API}/recovery/recommendations", headers=editor, json={}).json()
    best = rec["strategies"][0]
    assert client.get(f"{API}/transactions", headers=owner).json()["total"] == total
    # 9-10. editor turns it into an action; the server prices it, editor submits for approval
    act = client.post(f"{API}/actions", headers=editor, json={
        "title": best["title"], "source_type": "recovery", "source_ref": best["id"],
        "adjustments": best["adjustments"], "requires_approval": True}).json()
    assert act["estimated_impact_paisa"] == best["comparison"]["min_balance_change_paisa"]
    assert client.post(f"{API}/actions/{act['id']}/complete", headers=editor).status_code == 409  # needs approval first
    client.post(f"{API}/actions/{act['id']}/submit", headers=editor)
    # 11. only an owner may decide
    assert client.post(f"{API}/actions/{act['id']}/approve", headers=editor).status_code == 403
    ok = client.post(f"{API}/actions/{act['id']}/approve", headers=owner, json={"note": "Go ahead"}).json()
    assert ok["status"] == "approved" and ok["decided_by"] == "cfo"
    done = client.post(f"{API}/actions/{act['id']}/complete", headers=editor, json={"note": "Called 3 customers"}).json()
    assert done["status"] == "completed" and done["completed_by"] == "fin-editor"
    # 12. report reflects the same state; the approval did not move money
    rep = client.get(f"{API}/reports/financial", headers=owner).json()
    assert rep["actions"]["counts"] == {"completed": 1}
    assert rep["kpis"]["cash_balance"]["value_paisa"] == after["cash_balance"]["value_paisa"]
    log = client.get(f"{API}/audit?entity_id={act['id']}", headers=owner).json()["items"]
    assert [e["action"] for e in log] == ["complete", "approve", "submit", "create"]
