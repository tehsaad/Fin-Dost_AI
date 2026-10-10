"""Copilot regression tests: varied wording reaches the right tool, follow-ups keep context, answers come
from the authenticated user's own records, and missing data / unsupported questions are handled honestly.

Root cause covered here: the router used to take the first regex that matched, so most paraphrases got the
same generic "I couldn't match that" reply (or the wrong tool)."""
import json
from datetime import date

import pytest
from conftest import onboard
from test_ai import FakeHTTP, keys  # noqa: F401  (fixture)

from app.services.copilot_nlu import parse_amount, parse_delay_days, parse_percent, understand

API = "/api/v1"
TODAY = date(2026, 10, 10)


def ask(client, h, question, context=None, **extra):
    r = client.post(f"{API}/copilot/query", headers=h, json={"question": question, "context": context, **extra})
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
def demo(client):
    return onboard(client, "copilot-demo", demo=True)


# --------------------------------------------------------------------------- the ten reported questions

REQUIRED = [
    ("Why is my cash flow getting worse?", "why_risk"),
    ("What could cause me to run out of money?", "why_risk"),
    ("What happens if revenue drops by 20%?", "sales_decline"),
    ("Suppose sales fall by a fifth and my customer pays two weeks late.", "scenario"),
    ("Which customers owe me money, and who should I contact first?", "follow_up"),
    ("Compare expenses over the last two months.", "expense_compare"),
    ("Can I afford this payment next week?", "clarify"),  # no amount given: ask for it, don't guess
    ("Meri sales 20% kam ho jayein to cash par kya asar hoga?", "sales_decline"),
    ("Pichlay mahine ke muqablay mein kharchay kyun barhay?", "expense_compare"),
]


@pytest.mark.parametrize("question,intent", REQUIRED)
def test_reported_questions_reach_the_right_tool(client, demo, question, intent):
    r = ask(client, demo, question)
    assert r["intent"] == intent, (question, r["intent"], r["answer"])
    assert "couldn't match" not in r["answer"]
    assert r["grounded"] is True


def test_reported_questions_get_distinct_answers(client, demo):
    answers = [ask(client, demo, q)["answer"] for q, _ in REQUIRED]
    fallback = ask(client, demo, "Tell me a joke")["answer"]
    assert fallback not in answers
    distinct_tools = {intent for _, intent in REQUIRED}
    assert len(set(answers)) >= len(distinct_tools)


def test_scenario_parameters_are_extracted_not_defaulted(client, demo):
    r = ask(client, demo, "Suppose sales fall by a fifth and my customer pays two weeks late.")
    assert r["data"]["percent"] == 20 and r["data"]["delay_days"] == 14
    kinds = {a["type"] for a in r["data"]["adjustments"]}
    assert kinds == {"sales_decline", "delayed_payment"}
    assert "fall 20%" in r["answer"] and "14 days late" in r["answer"]


def test_followup_drops_another_ten_percent(client, demo):
    first = ask(client, demo, "What happens if revenue drops by 20%?")
    assert first["context"] == {"intent": "sales_decline", "params": {"percent": 20}, "pending": False}
    second = ask(client, demo, "What if it drops another 10%?", context=first["context"])
    assert second["intent"] == "sales_decline" and second["followup"] is True
    assert second["data"]["percent"] == 30 and "fall 30%" in second["answer"]
    # deeper drop -> lower low point, computed by the engine
    assert second["data"]["scenario"]["min_balance_paisa"] < first["data"]["scenario"]["min_balance_paisa"]
    # the same follow-up without context is not guessed: it asks a specific question
    alone = ask(client, demo, "What if it drops another 10%?")
    assert alone["intent"] == "clarify" and alone["needs_clarification"] is True
    assert "sales" in alone["answer"].lower() and alone["suggestions"]
    yes = ask(client, demo, "yes", context=alone["context"])
    assert yes["intent"] == "sales_decline" and yes["data"]["percent"] == 10


def test_followup_adds_late_payments_to_a_sales_scenario(client, demo):
    first = ask(client, demo, "What if sales drop 20%?")
    combined = ask(client, demo, "and if customers also pay 2 weeks late?", context=first["context"])
    assert combined["intent"] == "scenario" and combined["data"]["percent"] == 20 and combined["data"]["delay_days"] == 14


def test_affordability_clarification_then_amount(client, demo):
    q = ask(client, demo, "Can I afford this payment next week?")
    assert q["needs_clarification"] and q["context"]["intent"] == "affordability" and q["context"]["pending"]
    a = ask(client, demo, "Rs 40,000", context=q["context"])
    assert a["intent"] == "affordability" and a["data"]["amount_paisa"] == 4_000_000 and a["data"]["day"] == 7
    assert "Rs. 40,000" in a["answer"]


def test_language_followup_repeats_previous_answer_in_urdu(client, demo):
    first = ask(client, demo, "How am I doing?")
    ur = ask(client, demo, "in urdu please", context=first["context"])
    assert first["intent"] == ur["intent"] == "explain_dashboard" and ur["language"] == "ur"


# --------------------------------------------------------------------------- equivalent wording, same tool

EQUIVALENT = {
    "why_risk": ["Why is my cash-flow risk high?", "Am I going to be short on cash?", "Paise kab khatam honge?",
                 "What could cause me to run out of money?", "میرا نقدی کا خطرہ کیوں زیادہ ہے؟"],
    "sales_decline": ["What happens if sales decrease by 20%?", "What if revenue drops 20 percent?",
                      "Agar sales 20% kam ho jayein to kya hoga?", "Meri sales 20% kam ho jayein to cash par kya asar hoga?",
                      "میری فروخت 20% کم ہو جائے تو کیا ہوگا؟", "Suppose my sales fall by a fifth"],
    "follow_up": ["Who owes me?", "Which customers owe me money?", "Which invoices should I follow up on first?",
                  "Kis gahak se pehle wasooli karun?"],
    "expense_compare": ["Compare my expenses with last month", "How have my expenses changed from last month?",
                        "Pichlay mahine ke muqablay mein kharchay kyun barhay?", "پچھلے مہینے کے مقابلے میں خرچ کیوں بڑھا؟"],
    "affordability": ["Can I afford Rs. 50,000 next week?", "Do I have enough money for a Rs 50,000 payment next week?",
                      "Kya main agle hafte 50 hazar ki khareedari kar sakta hoon?"],
    "after_suppliers": ["How much cash could remain after scheduled supplier payments?", "Should I pay my supplier now or later?",
                        "How much cash could remain after scheduled bills?"],
    "compare": ["Compare these two recovery strategies", "What should I do to improve my cash?"],
    "explain_dashboard": ["Explain my dashboard in simple Urdu", "How am I doing?", "Is my business healthy?"],
    "performance": ["What's my profit this month?", "mera munafa kitna hai", "How much revenue did I make last month?"],
    "balance": ["How much cash do I have?", "Kitna cash hai mere paas?", "How much cash will I have next week?"],
    "spending": ["Where am I spending the most?", "What are my biggest costs?"],
    "delayed_collection": ["What if my customers pay 2 weeks late?", "agar gahak 15 din der se paise dein to?"],
}


@pytest.mark.parametrize("intent,questions", EQUIVALENT.items())
def test_equivalent_wordings_reach_the_same_tool(client, demo, intent, questions):
    for q in questions:
        r = ask(client, demo, q)
        assert r["intent"] == intent, (q, r["intent"], r["answer"][:120])


def test_equivalent_scenarios_give_identical_numbers(client, demo):
    mins = {ask(client, demo, q)["data"]["scenario"]["min_balance_paisa"] for q in EQUIVALENT["sales_decline"]}
    assert len(mins) == 1  # same tool, same parameters, same engine result regardless of language or wording


def test_cash_getting_worse_leads_with_the_trend(client, demo):
    r = ask(client, demo, "Why is my cash flow getting worse?")
    trend = r["data"]["trend"]
    assert trend["direction"] in ("declining", "stable", "improving")
    assert r["answer"].startswith("Your everyday cash flow is")


def test_expense_compare_answers_the_premise_honestly(client, demo):
    r = ask(client, demo, "Pichlay mahine ke muqablay mein kharchay kyun barhay?")
    if r["data"]["change_paisa"] <= 0:
        assert r["answer"].startswith("Overall your expenses did not rise")
    assert r["data"]["windows"] in " ".join(r["evidence"])


# --------------------------------------------------------------------------- honesty and isolation

def test_unsupported_and_out_of_scope_questions(client, demo):
    joke = ask(client, demo, "Tell me a joke")
    assert joke["intent"] == "unknown" and joke["suggestions"] and "I can answer questions about" in joke["answer"]
    psx = ask(client, demo, "What is the PSX index today?", context={"intent": "performance", "params": {}, "pending": False})
    assert psx["intent"] == "out_of_scope"


def test_empty_workspace_explains_missing_data_instead_of_inventing(client):
    h = onboard(client, "copilot-empty", demo=False)
    for q in ("Why is my cash flow getting worse?", "What happens if revenue drops by 20%?",
              "Which customers owe me money?", "Compare expenses over the last two months."):
        r = ask(client, h, q)
        assert r["intent"] != "unknown" and r["data"].get("missing"), (q, r)
        assert "Rs. 118,000" not in r["answer"] and "haven't added" in r["answer"]


def test_answers_use_only_the_callers_records_even_with_foreign_context(client, demo):
    other = onboard(client, "copilot-other", demo=False)
    a = ask(client, demo, "What happens if revenue drops by 20%?")
    # replaying user A's context as user B carries no data: B's answer is computed from B's (empty) records
    b = ask(client, other, "What if it drops another 10%?", context=a["context"])
    assert b["intent"] == "sales_decline" and b["data"].get("missing")
    assert str(a["data"]["scenario"]["min_balance_paisa"]) not in json.dumps(b)
    assert client.post(f"{API}/copilot/query", json={"question": "Who owes me?"}).status_code == 401


def test_context_is_validated(client, demo):
    bad = client.post(f"{API}/copilot/query", headers=demo,
                      json={"question": "and another 10%?", "context": {"intent": "sales_decline", "params": {"percent": 500}}})
    assert bad.status_code == 422
    smuggled = client.post(f"{API}/copilot/query", headers=demo,
                           json={"question": "x", "context": {"intent": "x", "params": {}, "balance": 1}})
    assert smuggled.status_code == 422
    unknown_intent = ask(client, demo, "and another 10%?", context={"intent": "drop_tables", "params": {}, "pending": True})
    assert unknown_intent["intent"] in ("clarify", "unknown")


# --------------------------------------------------------------------------- LLM interpretation (mocked HTTP)

def interp_ok(obj):
    return (200, {"choices": [{"message": {"content": json.dumps(obj)}}]})


def test_llm_maps_unplaced_question_to_a_tool_with_consent(client, monkeypatch, keys):  # noqa: F811
    keys(gemini=False)
    q = "Who hasn't settled up with me yet?"
    h = onboard(client, "copilot-llm", demo=True)
    assert ask(client, h, q)["intent"] == "unknown"  # rules alone can't place it, and no consent -> nothing sent
    client.put(f"{API}/business", headers=h, json={"ai_consent": True})
    http = FakeHTTP(monkeypatch, {"groq": [
        interp_ok({"intent": "follow_up", "percent": None, "delay_days": None, "amount_rupees": None, "days_from_now": None}),
        interp_ok({"answer": "Contact the customers in the order shown."})]})
    r = ask(client, h, q)
    assert r["intent"] == "follow_up" and r["interpreted_by"] == "groq"
    assert r["data"]["total_owed_paisa"] > 0  # figures from the engine, not the model
    sent = json.dumps(http.calls[0][3])
    assert "Rs." not in sent and "Al-Madina" not in sent  # only the question left the server


def test_llm_with_invalid_output_falls_back_to_honest_reply(client, monkeypatch, keys):  # noqa: F811
    keys(gemini=False)
    h = onboard(client, "copilot-llm-bad", demo=True)
    client.put(f"{API}/business", headers=h, json={"ai_consent": True})
    FakeHTTP(monkeypatch, {"groq": [interp_ok({"intent": "wire_money_abroad"})]})
    r = ask(client, h, "Who hasn't settled up with me yet?")
    assert r["intent"] == "unknown" and r["suggestions"]


def test_llm_cannot_invent_an_amount(client, monkeypatch, keys):  # noqa: F811
    keys(gemini=False)
    h = onboard(client, "copilot-llm-amt", demo=True)
    client.put(f"{API}/business", headers=h, json={"ai_consent": True})
    FakeHTTP(monkeypatch, {"groq": [interp_ok({"intent": "affordability", "percent": None, "delay_days": None,
                                               "amount_rupees": 999999, "days_from_now": 7})]})
    r = ask(client, h, "Is that thing I mentioned doable?")
    assert r["intent"] == "clarify" and r["context"]["intent"] == "affordability"


# --------------------------------------------------------------------------- parsers

def test_parameter_parsers():
    assert parse_percent("sales fall by a fifth") == (20, False)
    assert parse_percent("drops another 10%") == (10, True)
    assert parse_percent("bees fisad kam") == (20, False)
    assert parse_delay_days("my customer pays two weeks late") == 14
    assert parse_delay_days("15 din der se") == 15
    assert parse_delay_days("delayed by a month") == 30
    assert parse_amount("revenue drops by 20%") is None
    assert parse_amount("in 10 days") is None
    assert parse_amount("Can I afford 1.5 lakh") == 15_000_000
    assert parse_amount("Rs 40,000") == 4_000_000


def test_understand_is_stateless_without_context():
    assert understand("What if it drops another 10%?", TODAY).intent == "clarify"
    u = understand("What if it drops another 10%?", TODAY, {"intent": "sales_decline", "params": {"percent": 20}})
    assert u.intent == "sales_decline" and u.params["percent"] == 30 and u.followup
