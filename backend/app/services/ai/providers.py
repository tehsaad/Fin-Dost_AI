"""Groq and Gemini providers (plain HTTPS via httpx; no SDKs)."""
from __future__ import annotations

import base64
import json
import time

from ...config import get_settings
from .base import AIError, AIRequest, AIResult, parse_json_output, post_with_retry, strict_json_schema

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# Groq models that support strict json_schema decoding (console.groq.com/docs/structured-outputs, Oct 2026).
GROQ_STRICT_MODELS = {"openai/gpt-oss-20b", "openai/gpt-oss-120b"}


class GroqProvider:
    """Text-only. Used for explanations (English, Urdu, Roman Urdu) of figures FinDost already computed."""

    name = "groq"
    supports_attachments = False

    def __init__(self) -> None:
        s = get_settings()
        self.key, self.model, self.timeout = s.groq_api_key, s.groq_model, s.llm_timeout_seconds

    def configured(self) -> bool:
        return bool(self.key)

    def generate(self, req: AIRequest) -> AIResult:
        if not self.key:
            raise AIError("unavailable", "Groq is not configured")
        if req.attachments:
            raise AIError("unsupported", "Groq provider does not take documents")
        if self.model in GROQ_STRICT_MODELS:
            response_format = {"type": "json_schema", "json_schema": {
                "name": req.task, "strict": True, "schema": strict_json_schema(req.schema)}}
        else:  # other models: JSON mode + schema in the prompt; Pydantic validates either way
            response_format = {"type": "json_object"}
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": req.system + "\nReply with JSON only, matching this schema: "
                 + json.dumps(strict_json_schema(req.schema))},
                {"role": "user", "content": req.user},
            ],
            "temperature": 0.2,
            "max_completion_tokens": req.max_output_tokens,
            "response_format": response_format,
        }
        if self.model.startswith("openai/gpt-oss"):
            payload["reasoning_effort"] = "low"  # rephrasing needs little reasoning; keeps latency and tokens down
        start = time.monotonic()
        resp = post_with_retry(GROQ_URL, headers={"Authorization": f"Bearer {self.key}"}, payload=payload,
                               timeout=self.timeout, provider="Groq")
        try:
            text = resp.json()["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise AIError("invalid_output", "Groq response had no content") from exc
        data = parse_json_output(text, req.schema, "Groq")
        return AIResult(self.name, self.model, data, int((time.monotonic() - start) * 1000))


class GeminiProvider:
    """Multimodal. Used for receipt/invoice extraction and as a fallback for explanations."""

    name = "gemini"
    supports_attachments = True

    def __init__(self) -> None:
        s = get_settings()
        self.key, self.model, self.timeout = s.gemini_api_key, s.gemini_model, s.llm_timeout_seconds

    def configured(self) -> bool:
        return bool(self.key)

    def generate(self, req: AIRequest) -> AIResult:
        if not self.key:
            raise AIError("unavailable", "Gemini is not configured")
        parts: list[dict] = [{"text": req.user + "\n\nReply with JSON only, matching this schema: "
                              + json.dumps(strict_json_schema(req.schema))}]
        for a in req.attachments:
            parts.append({"inlineData": {"mimeType": a.mime_type, "data": base64.b64encode(a.data).decode()}})
        payload = {
            "systemInstruction": {"parts": [{"text": req.system}]},
            "contents": [{"role": "user", "parts": parts}],
            # max tokens include any thinking tokens on Gemini 3.x, so leave room above the answer size.
            "generationConfig": {"temperature": 0.2, "maxOutputTokens": max(req.max_output_tokens * 3, 2048),
                                 "responseMimeType": "application/json"},
        }
        start = time.monotonic()
        # Key in a header, not the URL, so it can never end up in request logs.
        resp = post_with_retry(GEMINI_URL.format(model=self.model), headers={"x-goog-api-key": self.key},
                               payload=payload, timeout=self.timeout, provider="Gemini")
        try:
            body = resp.json()
            cand = body["candidates"][0]
            text = "".join(p.get("text", "") for p in cand["content"]["parts"] if not p.get("thought"))
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise AIError("invalid_output", "Gemini response had no content (it may have been blocked)") from exc
        data = parse_json_output(text, req.schema, "Gemini")
        return AIResult(self.name, self.model, data, int((time.monotonic() - start) * 1000))
