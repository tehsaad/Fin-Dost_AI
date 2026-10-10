"""Optional, evidence-grounded LLM rephrasing (Layer 4).

Used only when GEMINI_API_KEY is configured AND the business owner has given
consent. The model receives the question and already-computed evidence (with
customer/supplier names masked) and may only rephrase it. Its answer is
rejected - and the deterministic template answer used instead - if it contains
any number that is not present in the evidence.
"""
from __future__ import annotations

import logging
import re

import httpx

from ..config import get_settings

log = logging.getLogger("findost.llm")
_NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def _numbers(text: str) -> set[str]:
    out = set()
    for m in _NUM.findall(text):
        n = m.replace(",", "")
        out.add(n.split(".")[0] if n.endswith(".0") or n.endswith(".00") else n)
    return out


def numbers_grounded(answer: str, evidence: str) -> bool:
    allowed = _numbers(evidence)
    return all(n in allowed or len(n) <= 1 for n in _numbers(answer))


def mask_names(text: str, names: list[str]) -> tuple[str, dict[str, str]]:
    mapping = {}
    for i, name in enumerate(sorted(set(n for n in names if n), key=len, reverse=True)):
        token = f"[P{i + 1}]"
        if name in text:
            mapping[token] = name
            text = text.replace(name, token)
    return text, mapping


def rephrase(question: str, template_answer: str, evidence: list[str], language: str, names: list[str]) -> str | None:
    settings = get_settings()
    if not settings.gemini_api_key:
        return None
    evidence_text = "\n".join(evidence + [template_answer])
    masked_evidence, mapping = mask_names(evidence_text, names)
    masked_question, qmap = mask_names(question, names)
    mapping.update(qmap)
    lang = "simple Urdu (Urdu script)" if language == "ur" else "simple English"
    prompt = (
        "You are FinDost, a careful financial assistant for a small business in Pakistan.\n"
        f"Answer the user's question in {lang}, in at most 5 short sentences.\n"
        "Use ONLY the facts and numbers in EVIDENCE. Do not add any new number, date, name or advice.\n"
        "Keep amounts exactly as written (e.g. 'Rs. 12,500'). If the evidence does not answer the question, say so.\n"
        f"QUESTION: {masked_question}\nEVIDENCE:\n{masked_evidence}\n"
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent"
    try:
        resp = httpx.post(url, params={"key": settings.gemini_api_key}, timeout=settings.llm_timeout_seconds,
                          json={"contents": [{"parts": [{"text": prompt}]}],
                                "generationConfig": {"temperature": 0.2, "maxOutputTokens": 400,
                                                     # Rephrasing needs no reasoning; thinking tokens would eat the budget.
                                                     "thinkingConfig": {"thinkingBudget": 0}}})
        if resp.status_code >= 400:
            # Never log the URL or exception text: the API key is a query parameter.
            log.warning("LLM call failed: HTTP %s (model %s)", resp.status_code, settings.gemini_model)
            return None
        parts = resp.json()["candidates"][0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
    except Exception as exc:  # network, timeout, schema - fall back silently
        log.warning("LLM call failed: %s", type(exc).__name__)
        return None
    if not text:
        return None
    if not numbers_grounded(text, masked_evidence):
        log.info("LLM answer rejected by number check")
        return None
    for token, name in mapping.items():
        text = text.replace(token, name)
    return text[:2000]
