"""One login, several workspaces: a user's own account (any type) plus workspaces they were invited to.
Identity (the Supabase user) and the active workspace are separate; the server decides access on every request."""
import pytest

from test_enterprise import API, in_ws, invite_and_join, setup_company, user


def own_workspace(client, uid: str, kind: str, demo: bool = False):
    h = user(uid, f"{uid}@company.pk")
    r = client.post(f"{API}/onboarding", headers=h, json={"kind": kind, "business_name": f"{uid} own", "load_demo": demo})
    assert r.status_code == 201, r.text
    return h, r.json()["business"]["id"]


def add_tx(client, headers, amount_rs: int, description: str):
    r = client.post(f"{API}/transactions", headers=headers, json={
        "occurred_on": "2026-10-09", "kind": "income", "amount_paisa": amount_rs * 100, "account": "cash",
        "category": "Sales", "description": description})
    return r


@pytest.mark.parametrize("kind", ["student", "household", "sme", "enterprise"])
def test_own_account_and_invited_enterprise_coexist(client, kind):
    owner, company = setup_company(client)
    me_h, mine = own_workspace(client, "amna", kind)
    invite_and_join(client, owner, company, "amna", "editor")

    me = client.get(f"{API}/me", headers=me_h).json()
    listed = {w["id"]: w for w in me["workspaces"]}
    assert set(listed) == {mine, company}
    assert listed[mine]["is_own"] is True and listed[mine]["kind"] == kind and listed[mine]["role"] == "owner"
    assert listed[company]["is_own"] is False and listed[company]["kind"] == "enterprise" and listed[company]["role"] == "editor"
    assert me["own_workspace_id"] == mine and me["workspace_denied"] is False and me["needs_onboarding"] is False

    # the invitation did not convert, merge or replace the user's own account
    own_view = client.get(f"{API}/me", headers=in_ws(me_h, mine)).json()
    assert own_view["business"]["id"] == mine and own_view["business"]["kind"] == kind and own_view["role"] == "owner"
    company_view = client.get(f"{API}/me", headers=in_ws(me_h, company)).json()
    assert company_view["business"]["id"] == company and company_view["role"] == "editor"
    assert "admin" not in company_view["permissions"] and "admin" in own_view["permissions"]
    # and the account type still cannot be changed by onboarding again
    assert client.post(f"{API}/onboarding", headers=me_h, json={"kind": "enterprise", "business_name": "x"}).status_code == 409


def test_records_never_cross_between_the_two_workspaces(client):
    owner, company = setup_company(client)
    me_h, mine = own_workspace(client, "bilal", "student")
    invite_and_join(client, owner, company, "bilal", "editor")

    assert add_tx(client, in_ws(me_h, mine), 1_234, "Tutoring fee (personal)").status_code == 201
    assert add_tx(client, in_ws(me_h, company), 98_765, "Export receipt (company)").status_code == 201

    def descriptions(ws):
        items = client.get(f"{API}/transactions?limit=500", headers=in_ws(me_h, ws)).json()["items"]
        return {t["description"] for t in items}

    assert "Tutoring fee (personal)" in descriptions(mine) and "Export receipt (company)" not in descriptions(mine)
    assert "Export receipt (company)" in descriptions(company) and "Tutoring fee (personal)" not in descriptions(company)
    # the company owner sees the member's company entry but nothing from the member's personal account
    assert "Tutoring fee (personal)" not in {t["description"] for t in
                                             client.get(f"{API}/transactions?limit=500", headers=owner).json()["items"]}

    # exports and reports follow the active workspace
    own_csv = client.get(f"{API}/transactions/export.csv", headers=in_ws(me_h, mine)).text
    company_csv = client.get(f"{API}/transactions/export.csv", headers=in_ws(me_h, company)).text
    assert "Tutoring fee (personal)" in own_csv and "Export receipt (company)" not in own_csv
    assert "Export receipt (company)" in company_csv and "Tutoring fee (personal)" not in company_csv
    own_report = client.get(f"{API}/reports/financial", headers=in_ws(me_h, mine)).json()
    company_report = client.get(f"{API}/reports/financial", headers=in_ws(me_h, company)).json()
    assert own_report["business"]["name"] == "bilal own" and own_report["business"]["kind"] == "student"
    assert company_report["business"]["name"] == "Indus" and company_report["business"]["kind"] == "enterprise"


def test_copilot_and_dashboard_use_the_active_workspace(client):
    owner, company = setup_company(client)  # enterprise demo data
    me_h, mine = own_workspace(client, "sana", "household", demo=True)
    invite_and_join(client, owner, company, "sana", "viewer")

    cash = {ws: client.get(f"{API}/dashboard", headers=in_ws(me_h, ws)).json()["kpis"]["cash_balance"]["value_paisa"]
            for ws in (mine, company)}
    assert cash[mine] != cash[company]
    for ws in (mine, company):
        r = client.post(f"{API}/copilot/query", headers=in_ws(me_h, ws), json={"question": "How much cash do I have?"})
        assert r.status_code == 200, r.text  # a viewer may ask: the copilot only reads
        rupees = f"Rs. {cash[ws] // 100:,}"
        assert rupees in r.json()["answer"], (ws, rupees, r.json()["answer"])


def test_role_is_per_workspace_for_the_same_identity(client):
    owner, company = setup_company(client)
    me_h, mine = own_workspace(client, "omar", "sme")
    invite_and_join(client, owner, company, "omar", "viewer")
    assert add_tx(client, in_ws(me_h, mine), 500, "own sale").status_code == 201          # owner at home
    assert add_tx(client, in_ws(me_h, company), 500, "company sale").status_code == 403   # viewer in the company
    assert client.put(f"{API}/budgets", headers=in_ws(me_h, company),
                      json={"category": "Rent", "monthly_amount_paisa": 100}).status_code == 403
    assert client.post(f"{API}/team/invitations", headers=in_ws(me_h, company),
                       json={"email": "x@company.pk", "role": "viewer"}).status_code == 403
    # an editor still cannot do owner-only work there
    editor_h, _ = invite_and_join(client, owner, company, "farah", "editor")
    assert client.put(f"{API}/business", headers=editor_h, json={"name": "Taken over"}).status_code == 403
    assert client.post(f"{API}/business/clear", headers=editor_h).status_code == 403


def test_forged_and_unrelated_workspace_ids_are_refused(client):
    owner, company = setup_company(client)
    me_h, mine = own_workspace(client, "zara", "student")
    other_h, other = own_workspace(client, "stranger", "household")

    # never listed, never opened
    assert other not in {w["id"] for w in client.get(f"{API}/me", headers=me_h).json()["workspaces"]}
    for ws in (other, company, "00000000-0000-0000-0000-000000000000", "' OR 1=1 --"):
        me = client.get(f"{API}/me", headers=in_ws(me_h, ws)).json()
        assert me["workspace_denied"] is True and me["business"] is None and me["permissions"] == []
        for path in ("/dashboard", "/transactions", "/transactions/export.csv", "/reports/financial", "/audit", "/team"):
            assert client.get(f"{API}{path}", headers=in_ws(me_h, ws)).status_code == 404, (ws, path)
        r = client.post(f"{API}/copilot/query", headers=in_ws(me_h, ws), json={"question": "cash?"})
        assert r.status_code == 404
        assert add_tx(client, in_ws(me_h, ws), 1, "forged").status_code == 404
    # nothing was written anywhere
    assert all(t["description"] != "forged"
               for h in (other_h, owner) for t in client.get(f"{API}/transactions?limit=500", headers=h).json()["items"])


def test_revoked_member_is_denied_even_with_a_previously_selected_id(client):
    owner, company = setup_company(client)
    me_h, mine = own_workspace(client, "hamza", "student")
    member, _ = invite_and_join(client, owner, company, "hamza", "editor")
    assert client.get(f"{API}/dashboard", headers=member).status_code == 200
    me_id = client.get(f"{API}/me", headers=me_h).json()["user"]["id"]
    assert client.delete(f"{API}/team/members/{me_id}", headers=owner).status_code == 204

    me = client.get(f"{API}/me", headers=member).json()  # the browser still sends the old workspace id
    assert me["workspace_denied"] is True and me["business"] is None
    assert [w["id"] for w in me["workspaces"]] == [mine]
    assert client.get(f"{API}/dashboard", headers=member).status_code == 404
    assert client.get(f"{API}/dashboard", headers=in_ws(me_h, mine)).status_code == 200  # own account unaffected


def test_member_without_own_account_can_still_create_one(client):
    owner, company = setup_company(client)
    member, _ = invite_and_join(client, owner, company, "nadia", "viewer")
    bare = {"Authorization": member["Authorization"]}
    me = client.get(f"{API}/me", headers=bare).json()
    assert me["needs_onboarding"] is False and me["own_workspace_id"] is None
    assert [w["id"] for w in me["workspaces"]] == [company]
    r = client.post(f"{API}/onboarding", headers=bare, json={"kind": "student", "business_name": "Nadia's budget"})
    assert r.status_code == 201
    me = client.get(f"{API}/me", headers=bare).json()
    assert me["own_workspace_id"] == r.json()["business"]["id"] and len(me["workspaces"]) == 2


def test_single_workspace_user_and_unauthenticated_requests(client):
    me_h, mine = own_workspace(client, "solo", "sme")
    me = client.get(f"{API}/me", headers=me_h).json()
    assert [w["id"] for w in me["workspaces"]] == [mine] and me["business"]["id"] == mine
    assert client.get(f"{API}/dashboard", headers=me_h).status_code == 200  # existing behaviour without a header
    for path in ("/me", "/dashboard", "/transactions"):
        assert client.get(f"{API}{path}").status_code == 401
        assert client.get(f"{API}{path}", headers={"X-Workspace-Id": mine}).status_code == 401
