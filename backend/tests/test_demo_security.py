"""Private (anonymous) demo workspaces, cleanup, developer-auth guard, copilot grounding for common questions."""
import time
from datetime import datetime, timedelta, timezone

import jwt
from conftest import onboard, token

from app.config import get_settings
from app.models import Business

API = "/api/v1"
SECRET = "test-secret-findost-unit-tests-000001"


def anon_token(uid: str) -> dict:
    claims = {"sub": uid, "aud": "authenticated", "role": "authenticated", "is_anonymous": True,
              "exp": int(time.time()) + 3600}
    return {"Authorization": "Bearer " + jwt.encode(claims, SECRET, algorithm="HS256")}


def test_each_visitor_gets_a_private_isolated_demo(client):
    a, b = anon_token("visitor-a"), anon_token("visitor-b")
    for h in (a, b):
        r = client.post(f"{API}/onboarding", headers=h, json={"kind": "sme", "business_name": "Demo", "load_demo": True})
        assert r.status_code == 201 and r.json()["business"]["is_anonymous"] is True
        assert r.json()["business"]["demo_expires_on"] == "2026-10-17" or r.json()["business"]["demo_expires_on"]
    # visitor A resets their demo; visitor B's data is untouched
    tx_b = client.get(f"{API}/transactions?page_size=1", headers=b).json()["items"][0]["id"]
    client.put(f"{API}/transactions/{tx_b}", headers=b, json={"description": "B's own edit"})
    assert client.post(f"{API}/business/reset-demo", headers=a).status_code == 200
    assert client.get(f"{API}/transactions/{tx_b}", headers=b).json()["description"] == "B's own edit"
    assert client.get(f"{API}/transactions/{tx_b}", headers=a).status_code == 404
    assert client.get(f"{API}/me", headers=a).json()["user"]["is_anonymous"] is True


def test_private_demo_limits(client, monkeypatch):
    h = anon_token("visitor-c")
    client.post(f"{API}/onboarding", headers=h, json={"kind": "sme", "business_name": "Demo", "load_demo": True})
    monkeypatch.setenv("ANON_MAX_TRANSACTIONS", "10")
    get_settings.cache_clear()
    try:
        r = client.post(f"{API}/transactions", headers=h, json={"occurred_on": "2026-10-09", "kind": "income", "amount_paisa": 100})
        assert r.status_code == 403 and r.json()["error"]["code"] == "demo_limit"
        client.put(f"{API}/business", headers=h, json={"ai_consent": True})
        r = client.post(f"{API}/import/receipt", headers=h, files={"file": ("r.jpg", b"\xff\xd8\xff" + b"0" * 10, "image/jpeg")})
        assert r.status_code == 403 and r.json()["error"]["code"] == "account_required"
    finally:
        monkeypatch.delenv("ANON_MAX_TRANSACTIONS")
        get_settings.cache_clear()


def test_upgrading_a_demo_keeps_it(client, db):
    uid = "visitor-d"
    client.post(f"{API}/onboarding", headers=anon_token(uid), json={"kind": "household", "business_name": "D", "load_demo": True})
    # same user id after adding email + password: Supabase issues a non-anonymous token
    assert client.get(f"{API}/business", headers=token(uid)).json()["is_anonymous"] is False


def test_cleanup_deletes_only_stale_anonymous_workspaces(client, db, monkeypatch):
    real = onboard(client, "real-owner", demo=True)
    client.post(f"{API}/onboarding", headers=anon_token("old-visitor"), json={"kind": "sme", "business_name": "Old", "load_demo": True})
    client.post(f"{API}/onboarding", headers=anon_token("new-visitor"), json={"kind": "sme", "business_name": "New", "load_demo": False})
    old = db.query(Business).filter_by(owner_id="old-visitor").one()
    old.created_at = datetime.now(timezone.utc) - timedelta(days=8)
    realb = db.query(Business).filter_by(owner_id="real-owner").one()
    realb.created_at = datetime.now(timezone.utc) - timedelta(days=400)
    db.commit()
    url = f"{API}/internal/cleanup-demos"
    assert client.get(url).status_code == 503  # no CRON_SECRET configured -> refuses to run
    monkeypatch.setenv("CRON_SECRET", "cron-test-secret")
    get_settings.cache_clear()
    try:
        assert client.get(url, headers={"Authorization": "Bearer wrong"}).status_code == 401
        r = client.get(url, headers={"Authorization": "Bearer cron-test-secret"})
        assert r.status_code == 200 and r.json()["deleted"] == 1
    finally:
        monkeypatch.delenv("CRON_SECRET")
        get_settings.cache_clear()
    db.expire_all()
    owners = {b.owner_id for b in db.query(Business).all()}
    assert owners == {"real-owner", "new-visitor"}
    assert client.get(f"{API}/transactions", headers=real).json()["total"] > 0


def test_developer_tokens_are_rejected_in_production(client, monkeypatch):
    h = onboard(client, "dev-user")
    monkeypatch.setenv("ENVIRONMENT", "production")
    get_settings.cache_clear()
    try:
        r = client.get(f"{API}/me", headers=h)
        assert r.status_code == 401
    finally:
        monkeypatch.setenv("ENVIRONMENT", "development")
        get_settings.cache_clear()
    assert client.get(f"{API}/me", headers=h).status_code == 200


def test_copilot_answers_common_questions_from_records(client):
    h = onboard(client, "copilot-q", demo=True)
    expect = {
        "How much cash will I have next week?": ("balance", "In 7 days"),
        "Which payments are overdue?": ("overdue", "overdue"),
        "What is my biggest upcoming expense?": ("upcoming_expense", "biggest upcoming payment"),
        "Agar sales 20% kam ho jayein to kya hoga?": ("sales_decline", "fall 20%"),
        "Mere paas aglay haftay kitna cash hoga?": ("balance", "In 7 days"),
        "Can I afford 1.5 lakh next week?": ("affordability", "Rs. 150,000"),
        "How much has Al-Madina Caterers paid so far?": ("party", "paid so far"),
        "What will the PSX index do tomorrow?": ("out_of_scope", "records"),
        "Tell me a joke": ("unknown", "couldn't match"),
    }
    for q, (intent, phrase) in expect.items():
        r = client.post(f"{API}/copilot/query", headers=h, json={"question": q}).json()
        assert r["intent"] == intent, (q, r["intent"])
        assert phrase in r["answer"], (q, r["answer"])
        assert r["grounded"] is True and r["used_llm"] is False
    urdu = client.post(f"{API}/copilot/query", headers=h, json={"question": "Which payments are overdue?", "language": "ur"}).json()
    assert "تاخیر" in urdu["answer"]
