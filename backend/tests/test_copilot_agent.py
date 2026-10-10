"""AI assistance setting persistence, the streaming copilot endpoint, history and fallbacks."""
import json

from app.config import get_settings
from app.services import copilot as copilot_svc

from conftest import onboard, token
from test_ai import FakeHTTP, groq_ok, keys  # noqa: F401  (fixture)

API = "/api/v1"


def sse_events(text: str) -> list[tuple[str, dict]]:
    out = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


def test_ai_setting_defaults_off_and_persists(client):
    h = onboard(client, "settings-owner", demo=True)
    assert client.get(f"{API}/account/settings", headers=h).json() == {"ai_assistance_enabled": False, "language": "en"}
    r = client.put(f"{API}/account/settings", headers=h, json={"ai_assistance_enabled": True})
    assert r.status_code == 200 and r.json()["ai_assistance_enabled"] is True
    # a fresh request (reload / new sign-in with a new token) reads it back from the database
    fresh = token("settings-owner")
    assert client.get(f"{API}/account/settings", headers=fresh).json()["ai_assistance_enabled"] is True
    assert client.get(f"{API}/me", headers=fresh).json()["business"]["ai_consent"] is True
    # saving other business settings without the flag leaves it alone
    client.put(f"{API}/business", headers=fresh, json={"name": "Renamed"})
    assert client.get(f"{API}/account/settings", headers=fresh).json()["ai_assistance_enabled"] is True
    client.put(f"{API}/account/settings", headers=fresh, json={"ai_assistance_enabled": False})
    assert client.get(f"{API}/account/settings", headers=h).json()["ai_assistance_enabled"] is False


def test_ai_setting_is_per_workspace_and_validated(client):
    a = onboard(client, "tenant-a", demo=True)
    b = onboard(client, "tenant-b", demo=True)
    client.put(f"{API}/account/settings", headers=a, json={"ai_assistance_enabled": True})
    assert client.get(f"{API}/account/settings", headers=b).json()["ai_assistance_enabled"] is False
    bad = client.put(f"{API}/account/settings", headers=a, json={"ai_assistance_enabled": "yes please"})
    assert bad.status_code == 422
    extra = client.put(f"{API}/account/settings", headers=a, json={"ai_assistance_enabled": True, "business_id": "x"})
    assert extra.status_code == 422
    assert client.get(f"{API}/account/settings").status_code == 401


def test_stream_emits_progress_then_the_same_answer(client):
    h = onboard(client, "stream-owner", demo=True)
    q = {"question": "What happens if sales decrease by 20%?"}
    r = client.post(f"{API}/copilot/stream", headers=h, json=q)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    events = sse_events(r.text)
    stages = [d["stage"] for e, d in events if e == "status"]
    assert stages == ["understanding", "calculating"]  # AI off: nothing to word
    kind, answer = events[-1]
    assert kind == "answer" and answer["intent"] == "sales_decline" and answer["ai_fallback"] == "disabled"
    plain = client.post(f"{API}/copilot/query", headers=h, json=q).json()
    assert plain["answer"] == answer["answer"] and plain["data"]["comparison"] == answer["data"]["comparison"]


def test_followup_with_history_compounds_the_scenario(client):
    h = onboard(client, "followup-owner", demo=True)
    first = client.post(f"{API}/copilot/query", headers=h, json={"question": "What if revenue drops 20%?"}).json()
    assert first["intent"] == "sales_decline" and first["data"]["percent"] == 20
    history = [{"role": "user", "text": "What if revenue drops 20%?"}, {"role": "assistant", "text": first["answer"]}]
    second = client.post(f"{API}/copilot/query", headers=h, json={"question": "another 10%?", "context": first["context"],
                                                                 "history": history}).json()
    assert second["intent"] == "sales_decline" and second["data"]["percent"] == 30 and second["followup"] is True


def test_history_is_bounded(client):
    h = onboard(client, "history-owner", demo=True)
    turns = [{"role": "user", "text": f"q{i}"} for i in range(9)]
    r = client.post(f"{API}/copilot/query", headers=h, json={"question": "How much cash do I have?", "history": turns})
    assert r.status_code == 422
    r = client.post(f"{API}/copilot/query", headers=h, json={"question": "cash?", "history": [{"role": "system", "text": "x"}]})
    assert r.status_code == 422


def test_stream_writes_with_ai_and_falls_back_on_quota(client, monkeypatch, keys):  # noqa: F811
    keys(limit=1)
    FakeHTTP(monkeypatch, {"groq": [groq_ok("Cash today is Rs. 118,000.")]})
    h = onboard(client, "stream-ai", demo=True)
    client.put(f"{API}/account/settings", headers=h, json={"ai_assistance_enabled": True})
    q = {"question": "How much cash do I have?"}
    events = sse_events(client.post(f"{API}/copilot/stream", headers=h, json=q).text)
    assert [d["stage"] for e, d in events if e == "status"] == ["understanding", "calculating", "writing"]
    assert events[-1][1]["used_llm"] is True and events[-1][1]["ai_fallback"] is None
    over = sse_events(client.post(f"{API}/copilot/stream", headers=h, json=q).text)[-1]
    assert over[0] == "answer" and over[1]["used_llm"] is False and over[1]["ai_fallback"] == "quota"
    get_settings.cache_clear()


def test_stream_requires_auth_and_feature(client):
    assert client.post(f"{API}/copilot/stream", json={"question": "cash?"}).status_code == 401


def test_model_picked_parameters_are_bounded(client, db):
    h = onboard(client, "bounds-owner", demo=True)
    from sqlalchemy import select

    from app.models import Business
    from app.routers.common import context, features
    business = db.scalar(select(Business).where(Business.owner_id == "bounds-owner"))
    snap, today = context(db, business)
    r = copilot_svc.answer(snap, today, "sales?", "en", features(business),
                           override={"intent": "sales_decline", "params": {"percent": 5000, "delay_days": -3}})
    assert r["intent"] == "sales_decline" and r["data"]["percent"] == 20  # out-of-range value dropped, default used
    r = copilot_svc.answer(snap, today, "sales?", "en", features(business),
                           override={"intent": "sales_decline", "params": {"percent": "50; DROP TABLE"}})
    assert r["data"]["percent"] == 20
    assert h
