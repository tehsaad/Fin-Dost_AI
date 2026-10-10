"""Safety helpers for AI explanations (see services/ai for providers and routing).

Customer/supplier names are masked before any text leaves the server, and a model's answer is
rejected - the deterministic template answer is used instead - if it contains any number that is
not present in the evidence.
"""
from __future__ import annotations

import re

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
