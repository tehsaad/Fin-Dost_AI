"""Provider-neutral AI interface.

Providers only turn a prompt (and optionally an image/PDF) into JSON that must match a schema.
They never compute financial figures: FinDost's deterministic engine does that, and every model
output is validated before use. Errors are typed so callers can fall back cleanly.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, ValidationError

log = logging.getLogger("findost.ai")


class AIError(Exception):
    """code: unavailable | rate_limited | timeout | http_error | invalid_output | unsupported"""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


@dataclass
class Attachment:
    mime_type: str
    data: bytes


@dataclass
class AIRequest:
    task: str
    system: str
    user: str
    schema: type[BaseModel]
    attachments: list[Attachment] = field(default_factory=list)
    max_output_tokens: int = 800


@dataclass
class AIResult:
    provider: str
    model: str
    data: BaseModel
    latency_ms: int


class AIProvider(Protocol):
    name: str
    model: str
    supports_attachments: bool

    def configured(self) -> bool: ...

    def generate(self, req: AIRequest) -> AIResult: ...


def post_with_retry(url: str, *, headers: dict[str, str], payload: dict[str, Any], timeout: float,
                    provider: str, retries: int = 1) -> httpx.Response:
    """POST with one bounded retry on 429/5xx (honouring a short Retry-After). Never logs headers or bodies."""
    attempt = 0
    while True:
        try:
            resp = httpx.post(url, headers=headers, json=payload, timeout=timeout)
        except httpx.TimeoutException as exc:
            raise AIError("timeout", f"{provider} timed out") from exc
        except httpx.HTTPError as exc:
            raise AIError("http_error", f"{provider} network error: {type(exc).__name__}") from exc
        if resp.status_code < 400:
            return resp
        retryable = resp.status_code == 429 or resp.status_code >= 500
        if retryable and attempt < retries:
            try:
                wait = min(float(resp.headers.get("retry-after", "1")), 3.0)
            except ValueError:
                wait = 1.0
            time.sleep(max(wait, 0.2))
            attempt += 1
            continue
        log.warning("%s returned HTTP %s", provider, resp.status_code)
        if resp.status_code == 429:
            raise AIError("rate_limited", f"{provider} rate limit reached")
        if resp.status_code in (401, 403):
            raise AIError("unavailable", f"{provider} rejected the API key (HTTP {resp.status_code})")
        if resp.status_code == 404:
            raise AIError("unavailable", f"{provider} model not found (HTTP 404) - check the model setting")
        raise AIError("http_error", f"{provider} HTTP {resp.status_code}")


def parse_json_output(text: str, schema: type[BaseModel], provider: str) -> BaseModel:
    """Validate model text against the schema. Tolerates a ```json fence, nothing else."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        cleaned = cleaned[4:] if cleaned.lower().startswith("json") else cleaned
    try:
        return schema.model_validate(json.loads(cleaned))
    except (json.JSONDecodeError, ValidationError) as exc:
        raise AIError("invalid_output", f"{provider} output did not match the expected format") from exc


_DROP = {"title", "default", "maxLength", "minLength", "minimum", "maximum", "maxItems", "minItems", "pattern",
         "format", "exclusiveMinimum", "exclusiveMaximum"}


def strict_json_schema(schema: type[BaseModel]) -> dict[str, Any]:
    """Pydantic JSON schema adjusted for strict structured-output modes: every property required, no
    additional properties, no titles/defaults/length or range keywords (Pydantic re-checks those)."""
    raw = schema.model_json_schema()
    defs = raw.pop("$defs", {})

    def fix(node: Any) -> Any:
        if isinstance(node, dict):
            if "$ref" in node:
                return fix(defs[node["$ref"].split("/")[-1]])
            out = {k: fix(v) for k, v in node.items() if k not in _DROP}
            if out.get("type") == "object" and "properties" in out:
                out["required"] = list(out["properties"].keys())
                out["additionalProperties"] = False
            return out
        if isinstance(node, list):
            return [fix(v) for v in node]
        return node

    return fix(raw)
