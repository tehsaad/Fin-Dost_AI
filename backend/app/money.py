"""Exact money helpers. All amounts are integer paisa (1 PKR = 100 paisa)."""
from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

PAISA_PER_RUPEE = 100


def rupees(value: int | float | str | Decimal) -> int:
    """Convert a rupee amount to integer paisa, rounding half up."""
    return int((Decimal(str(value)) * PAISA_PER_RUPEE).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def to_rupees(paisa: int) -> float:
    return paisa / PAISA_PER_RUPEE


def fmt_pkr(paisa: int, *, paisa_digits: bool = False) -> str:
    """Format as "Rs. 1,250,000" (or "-Rs. 500"). Rounds to whole rupees by default."""
    sign = "-" if paisa < 0 else ""
    absolute = abs(int(paisa))
    if paisa_digits:
        return f"{sign}Rs. {absolute // 100:,}.{absolute % 100:02d}"
    whole = int((Decimal(absolute) / 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return f"{sign}Rs. {whole:,}"


_AMOUNT_JUNK = re.compile(r"(?i)\b(?:pkr|rupees?|rs)\b\.?|[₨\s]")


def parse_amount(raw: str | int | float | None) -> int | None:
    """Parse messy amount text into signed paisa.

    Handles "Rs. 1,25,000.50", "(500)" for negatives, trailing minus, "CR"/"DR"
    markers are left to the caller. Returns None when the text is not a number.
    """
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        return rupees(raw)
    text = _AMOUNT_JUNK.sub("", str(raw)).replace(",", "").strip()
    if not text or text in {"-", "--"}:
        return None
    negative = False
    if text.startswith("(") and text.endswith(")"):
        negative, text = True, text[1:-1]
    if text.endswith("-"):
        negative, text = True, text[:-1]
    if text.startswith("-"):
        negative, text = not negative, text[1:]
    if text.startswith("+"):
        text = text[1:]
    try:
        value = Decimal(text)
    except InvalidOperation:
        return None
    if not value.is_finite():
        return None
    paisa = rupees(value)
    return -paisa if negative else paisa
