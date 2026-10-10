"""AI layer with mocked HTTP: routing, fallback, validation, safety guards, consent and quota.
No real API keys are used and no request leaves the machine."""
import json

import httpx
import pytest
from conftest import onboard

from app.config import get_settings
from app.services import ai
from app.services.ai import base as ai_base
from app.services.ai import tasks
from app.services.ai.base import strict_json_schema

API = "/api/v1"
EVIDENCE = ["Cash today Rs. 118,000", "Bill from Haji Traders Rs. 60,000 due 2026-10-19"]


@pytest.fixture
def keys(monkeypatch):
    def set_keys(groq: bool = True, gemini: bool = True, limit: int = 60):
        monkeypatch.setenv("GROQ_API_KEY", "test-groq-key" if groq else "")
        monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key" if gemini else "")
        monkeypatch.setenv("AI_DAILY_LIMIT", str(limit))
        get_settings.cache_clear()
    yield set_keys
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.delenv("AI_DAILY_LIMIT", raising=False)
    get_settings.cache_clear()


class FakeHTTP:
    """Scripted responses per host; records every request."""

    def __init__(self, monkeypatch, script):
        self.calls = []
        self.script = {k: list(v) for k, v in script.items()}
        monkeypatch.setattr(ai_base.httpx, "post", self.post)
        monkeypatch.setattr(ai_base.time, "sleep", lambda s: self.calls.append(("sleep", s)))

    def post(self, url, headers=None, json=None, timeout=None):
        host = "groq" if "groq.com" in url else "gemini"
        self.calls.append((host, url, headers, json))
        step = self.script[host].pop(0)
        if isinstance(step, Exception):
            raise step
        status, body, extra = step if len(step) == 3 else (*step, {})
        return httpx.Response(status, json=body, headers=extra, request=httpx.Request("POST", url))

    def hosts(self):
        return [c[0] for c in self.calls if c[0] != "sleep"]


def groq_ok(answer):
    return (200, {"choices": [{"message": {"content": json.dumps({"answer": answer})}}]})


def gemini_ok(obj):
    return (200, {"candidates": [{"content": {"parts": [{"text": "thinking...", "thought": True},
                                                         {"text": json.dumps(obj)}]}}]})


def test_groq_is_used_first_with_strict_schema_and_masked_names(monkeypatch, keys):
    keys()
    http = FakeHTTP(monkeypatch, {"groq": [groq_ok("Pay [P1] Rs. 60,000 on 2026-10-19; you hold Rs. 118,000.")]})
    text, provider = tasks.explain("Can I pay Haji Traders?", "Yes", EVIDENCE, "en", ["Haji Traders"])
    assert provider == "groq" and text == "Pay Haji Traders Rs. 60,000 on 2026-10-19; you hold Rs. 118,000."
    _, url, headers, payload = http.calls[0]
    assert url.endswith("/openai/v1/chat/completions") and headers == {"Authorization": "Bearer test-groq-key"}
    assert payload["model"] == "openai/gpt-oss-20b" and payload["reasoning_effort"] == "low"
    fmt = payload["response_format"]
    assert fmt["type"] == "json_schema" and fmt["json_schema"]["strict"] is True
    sent = json.dumps(payload)
    assert "Haji Traders" not in sent and "[P1]" in sent  # names never leave the server


def test_fallback_to_gemini_after_rate_limit_and_key_stays_out_of_url(monkeypatch, keys):
    keys()
    http = FakeHTTP(monkeypatch, {"groq": [(429, {}, {"retry-after": "30"}), (429, {})],
                                  "gemini": [gemini_ok({"answer": "You hold Rs. 118,000."})]})
    text, provider = tasks.explain("balance?", "Rs. 118,000", EVIDENCE, "en", [])
    assert provider == "gemini" and text == "You hold Rs. 118,000."
    assert http.hosts() == ["groq", "groq", "gemini"]
    assert ("sleep", 3.0) in http.calls  # Retry-After honoured but capped
    _, url, headers, payload = [c for c in http.calls if c[0] == "gemini"][0]
    assert "key=" not in url and headers == {"x-goog-api-key": "test-gemini-key"}
    assert payload["generationConfig"]["responseMimeType"] == "application/json"


def test_invalid_output_and_ungrounded_numbers_fall_back_to_the_template(monkeypatch, keys):
    keys()
    FakeHTTP(monkeypatch, {"groq": [(200, {"choices": [{"message": {"content": "not json"}}]})],
                           "gemini": [gemini_ok({"wrong": "shape"})]})
    assert tasks.explain("q", "a", EVIDENCE, "en", []) is None
    FakeHTTP(monkeypatch, {"groq": [groq_ok("You will have Rs. 999,999 next week.")]})
    assert tasks.explain("q", "a", EVIDENCE, "en", []) is None


def test_timeouts_and_missing_keys_never_raise_to_the_caller(monkeypatch, keys):
    keys(gemini=False)
    FakeHTTP(monkeypatch, {"groq": [httpx.ReadTimeout("slow")]})
    assert tasks.explain("q", "a", EVIDENCE, "en", []) is None
    keys(groq=False, gemini=False)
    assert ai.status()["tasks"]["explain"]["available"] is False
    assert tasks.explain("q", "a", EVIDENCE, "en", []) is None


def test_strict_schema_requires_every_field_and_forbids_extras():
    schema = strict_json_schema(tasks.ReceiptOut)
    assert schema["additionalProperties"] is False and set(schema["required"]) == set(schema["properties"])
    item = schema["properties"]["line_items"]["items"]
    assert item["additionalProperties"] is False and "maxLength" not in json.dumps(schema)


def test_copilot_respects_consent_and_quota(client, monkeypatch, keys):
    keys(limit=2)
    http = FakeHTTP(monkeypatch, {"groq": [groq_ok("Cash today is Rs. 118,000."), groq_ok("Cash today is Rs. 118,000.")]})
    h = onboard(client, "ai-owner", demo=True)
    q = {"question": "How much cash do I have?"}
    r = client.post(f"{API}/copilot/query", headers=h, json=q).json()
    assert r["used_llm"] is False and http.hosts() == []  # no consent -> nothing sent
    client.put(f"{API}/business", headers=h, json={"ai_consent": True})
    r = client.post(f"{API}/copilot/query", headers=h, json=q).json()
    assert r["llm_available"] is True
    assert http.hosts() == ["groq"]
    # second call uses the last quota unit; the third falls back to the rule-based answer instead of failing
    client.post(f"{API}/copilot/query", headers=h, json=q)
    over = client.post(f"{API}/copilot/query", headers=h, json=q)
    assert over.status_code == 200, over.text
    body = over.json()
    assert body["used_llm"] is False and body["ai_fallback"] == "quota" and "Rs." in body["answer"]
    assert http.hosts() == ["groq", "groq"]
    status = client.get(f"{API}/ai/status", headers=h).json()
    assert status["providers"]["groq"] == {"configured": True, "model": "openai/gpt-oss-20b"} and status["consent"] is True
    assert "test-groq-key" not in json.dumps(status)


def test_health_reports_providers_as_booleans_only(client, keys):
    keys(groq=True, gemini=False)
    body = client.get(f"{API}/health").json()
    assert body["ai"] == {"groq": True, "gemini": False} and "key" not in json.dumps(body).lower().replace("ai", "")


def test_roman_urdu_detection():
    from app.services.copilot import is_roman_urdu
    assert is_roman_urdu("agle hafte kitna cash bachega?")
    assert not is_roman_urdu("How much cash will I have next week?")


# ------------------------------------------------------------------ receipts

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 100


def test_receipt_extraction_is_a_reviewable_proposal(client, monkeypatch, keys):
    keys()
    http = FakeHTTP(monkeypatch, {"gemini": [gemini_ok({
        "is_financial_document": True, "document_type": "bill", "merchant": "LESCO", "date": "2026-10-05",
        "currency": "PKR", "total_amount": "12450.50", "direction": "money_out",
        "line_items": [{"description": "Units 310", "amount": "11000"}, {"description": "Tax", "amount": "1450.50"}],
        "confidence": 0.91})]})
    h = onboard(client, "rcpt")
    files = {"file": ("bill.jpg", JPEG, "image/jpeg")}
    assert client.post(f"{API}/import/receipt", headers=h, files=files).json()["error"]["code"] == "ai_consent_required"
    client.put(f"{API}/business", headers=h, json={"ai_consent": True})
    r = client.post(f"{API}/import/receipt", headers=h, files=files)
    assert r.status_code == 200, r.text
    row = r.json()["rows"][0]
    assert row["status"] == "accepted" and row["amount_paisa"] == 1_245_050 and row["date"] == "2026-10-05"
    assert row["kind"] == "expense" and row["ai_extracted"] and any("Check every field" in w for w in row["warnings"])
    assert http.hosts() == ["gemini"]  # documents never go to Groq
    # nothing in the ledger until the user confirms
    assert client.get(f"{API}/transactions", headers=h).json()["total"] == 0
    done = client.post(f"{API}/import/confirm", headers=h, json={"batch_id": r.json()["batch_id"]}).json()
    assert done["imported"] == 1


def test_low_confidence_or_odd_receipts_need_correction(client, monkeypatch, keys):
    keys()
    FakeHTTP(monkeypatch, {"gemini": [gemini_ok({
        "is_financial_document": True, "document_type": "receipt", "merchant": "Shop", "date": "2031-01-01",
        "currency": "USD", "total_amount": "abc", "direction": "unknown", "line_items": [], "confidence": 0.3})]})
    h = onboard(client, "rcpt2")
    client.put(f"{API}/business", headers=h, json={"ai_consent": True})
    row = client.post(f"{API}/import/receipt", headers=h, files={"file": ("r.png", b"\x89PNG" + b"0" * 50, "image/png")}).json()["rows"][0]
    assert row["status"] == "rejected"
    text = " ".join(row["reasons"])
    for problem in ("total amount", "looks wrong", "USD", "low confidence"):
        assert problem in text
    # spoofed type and oversized files are refused before any AI call
    bad = client.post(f"{API}/import/receipt", headers=h, files={"file": ("x.jpg", b"%PDF-1.4", "image/jpeg")})
    assert bad.status_code == 415
    assert client.post(f"{API}/import/receipt", headers=h, files={"file": ("x.gif", b"GIF89a", "image/gif")}).status_code == 415


def test_receipt_reading_unavailable_without_gemini(client, keys):
    keys(gemini=False)
    h = onboard(client, "rcpt3")
    client.put(f"{API}/business", headers=h, json={"ai_consent": True})
    r = client.post(f"{API}/import/receipt", headers=h, files={"file": ("bill.jpg", JPEG, "image/jpeg")})
    assert r.status_code == 503 and r.json()["error"]["code"] == "ai_unavailable"


def test_decimal_amounts_never_use_float_rounding():
    assert tasks.to_paisa("0.29") == 29 and tasks.to_paisa("1,25,000.505") == 12_500_051
    assert tasks.to_paisa("-5") is None and tasks.to_paisa("") is None
