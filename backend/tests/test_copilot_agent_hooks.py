"""The agent step inside the /copilot pipeline: greetings without AI, multi-tool/inventory answers when the
single-tool interpreter can't place a question, and the figure guard."""
import json

from conftest import onboard
from test_ai import FakeHTTP, keys  # noqa: F401  (fixture)
from test_copilot_agent import sse_events

API = "/api/v1"
NULLS = {"percent": None, "delay_days": None, "amount_rupees": None, "day": None, "party": None, "term": None}


def groq_json(obj):
    return (200, {"choices": [{"message": {"content": json.dumps(obj)}}]})


UNSUPPORTED = groq_json({"intent": "unsupported", "percent": None, "delay_days": None, "amount_rupees": None,
                         "days_from_now": None})


def test_greetings_get_a_friendly_reply_without_ai(client):
    h = onboard(client, "hooks-greet", demo=True)
    for q, phrase in (("hi", "Hello"), ("salam, kaise ho?", "Wa alaikum assalam"), ("thank you!", "welcome")):
        r = client.post(f"{API}/copilot/query", headers=h, json={"question": q}).json()
        assert r["intent"] == "greeting" and phrase in r["answer"], (q, r["answer"])
        assert r["used_llm"] is False and r["suggestions"]


def test_agent_answers_inventory_questions_the_rules_cannot_place(client, monkeypatch, keys):  # noqa: F811
    keys(gemini=False)
    plan = {"language": "roman_ur", "action": "tools", "reply": None, "tools": [{"tool": "inventory", **NULLS}]}
    http = FakeHTTP(monkeypatch, {"groq": [UNSUPPORTED, groq_json(plan),
                                           groq_json({"answer": "Aap ke stock ki value records ke mutabiq hai.",
                                                      "suggestions": ["Kaun sa maal kam hai?"]})]})
    h = onboard(client, "hooks-inv", demo=True)
    client.put(f"{API}/account/settings", headers=h, json={"ai_assistance_enabled": True})
    r = client.post(f"{API}/copilot/stream", headers=h, json={"question": "kitna maal stock mein para hai?"})
    evs = sse_events(r.text)
    assert [e for e, _ in evs[:2]] == ["status", "status"]
    ans = evs[-1][1]
    assert ans["used_llm"] is True and ans["ai_provider"] == "groq" and ans["tools"] == ["inventory"]
    assert ans["ai_fallback"] is None and ans["suggestions"] == ["Kaun sa maal kam hai?"]
    assert len([c for c in http.calls if c[0] == "groq"]) == 3  # interpret, plan, compose: no extra rewording


def test_agent_conversational_reply_cannot_contain_figures(client, monkeypatch, keys):  # noqa: F811
    keys(gemini=False)
    chat = {"language": "en", "action": "reply", "tools": [], "reply": "I can help with your cash, bills and udhaar."}
    FakeHTTP(monkeypatch, {"groq": [UNSUPPORTED, groq_json(chat)]})
    h = onboard(client, "hooks-chat", demo=True)
    client.put(f"{API}/account/settings", headers=h, json={"ai_assistance_enabled": True})
    r = client.post(f"{API}/copilot/query", headers=h, json={"question": "what can you do for me exactly?"}).json()
    assert r["intent"] == "conversation" and r["used_llm"] is True and "udhaar" in r["answer"]
    bad = {"language": "en", "action": "reply", "tools": [], "reply": "Your profit is Rs. 5,000,000."}
    FakeHTTP(monkeypatch, {"groq": [UNSUPPORTED, groq_json(bad)]})
    r = client.post(f"{API}/copilot/query", headers=h, json={"question": "what can you do for me exactly?"}).json()
    assert "5,000,000" not in r["answer"] and r["used_llm"] is False


def test_agent_invented_figure_is_replaced_by_engine_text(client, monkeypatch, keys):  # noqa: F811
    keys(gemini=False)
    plan = {"language": "en", "action": "tools", "reply": None,
            "tools": [{"tool": "balance", **NULLS}, {"tool": "overdue", **NULLS}]}
    FakeHTTP(monkeypatch, {"groq": [UNSUPPORTED, groq_json(plan), groq_json({"answer": "You have Rs. 9,999,999.",
                                                                              "suggestions": []})]})
    h = onboard(client, "hooks-guard", demo=True)
    client.put(f"{API}/account/settings", headers=h, json={"ai_assistance_enabled": True})
    r = client.post(f"{API}/copilot/query", headers=h, json={"question": "give me the full picture please"}).json()
    assert "9,999,999" not in r["answer"] and "Rs. 118,000" in r["answer"] and "overdue" in r["answer"]
    assert r["used_llm"] is False and r["tools"] == ["balance", "overdue"]
