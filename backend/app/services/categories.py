"""Category vocabulary, expense groups and rule-based categorization.

Keywords cover English, Roman Urdu and common Pakistani merchant names so that
imported bank/wallet descriptions land in sensible categories. Rules are
transparent on purpose: every suggestion carries the keyword that matched.
"""
from __future__ import annotations

import re
from collections import Counter

INCOME_CATEGORIES = [
    "Sales", "Digital Payments", "Salary", "Family Allowance", "Freelance Income",
    "Export Sales", "Other Income",
]
EXPENSE_CATEGORIES = [
    "Inventory Purchase", "Raw Material", "Rent", "Salaries & Wages", "Utilities", "Transport & Fuel",
    "Packaging", "Repairs & Maintenance", "Mobile & Internet", "Education", "Groceries",
    "Medical", "Dining & Leisure", "Shopping", "Bank & Wallet Fees", "Taxes & Fees",
    "Committee (ROSCA)", "Miscellaneous",
]

# keyword -> category. Order matters: first match wins.
_RULES: list[tuple[str, str]] = [
    # income
    (r"\b(salary|tankhwah|payroll credit)\b", "Salary"),
    (r"\b(allowance|jeb kharch|stipend|pocket money)\b", "Family Allowance"),
    (r"\b(freelanc|fiverr|upwork|tutoring|tuition fee received)\w*", "Freelance Income"),
    (r"\b(easypaisa|jazzcash|raast|qr settlement|sadapay|nayapay)\b.*\b(settle|receiv|credit)\w*", "Digital Payments"),
    (r"\b(export|lc settlement|letter of credit)\b", "Export Sales"),
    (r"\b(sale|sales|bikri|counter cash|pos batch|cash sale)\b", "Sales"),
    # expenses
    (r"\b(rent|kiraya|kiraaya)\b", "Rent"),
    (r"\b(lesco|kesc|k-electric|iesco|fesco|mepco|gepco|pesco|sngpl|ssgc|electric\w*|bijli|gas bill|water bill|wasa|utility)\b", "Utilities"),
    (r"\b(ptcl|internet|broadband|jazz|zong|telenor|ufone|mobile load|data card|fiber)\b", "Mobile & Internet"),
    (r"\b(wages|salaries|staff pay|payroll|mazdoori|helper)\b", "Salaries & Wages"),
    (r"\b(petrol|diesel|fuel|pso|shell|careem|uber|bykea|rickshaw|transport|freight|cargo|loader)\b", "Transport & Fuel"),
    (r"\b(cotton|yarn|raw material|dyes?|chemicals?)\b", "Raw Material"),
    (r"\b(wholesale|distributor|restock|stock|maal|unilever|nestle|engro|shan|national foods|p&g|dalda|olpers|tapal|coca|pepsi|ghee|atta|flour|sugar|cheeni|rice|chawal)\b", "Inventory Purchase"),
    (r"\b(packing|packaging|shopper|polythene|cartons?)\b", "Packaging"),
    (r"\b(repair|maintenance|mistri|plumber|electrician)\b", "Repairs & Maintenance"),
    (r"\b(school|college|university|fee challan|tuition|books|stationery)\b", "Education"),
    (r"\b(grocery|groceries|sabzi|vegetables|metro|imtiaz|carrefour|al-fatah|naheed)\b", "Groceries"),
    (r"\b(pharmacy|medical|doctor|hospital|clinic|medicine|dawai)\b", "Medical"),
    (r"\b(restaurant|cafe|dining|foodpanda|cinema|movie|hotel|chai|biryani)\b", "Dining & Leisure"),
    (r"\b(clothes|shopping|daraz|mall|shoes)\b", "Shopping"),
    (r"\b(bank charges|service charge|wallet fee|withholding|excise|fbr|tax)\b", "Taxes & Fees"),
    (r"\b(committee|kameti|bc payment|rosca)\b", "Committee (ROSCA)"),
]
_COMPILED = [(re.compile(p, re.IGNORECASE), c) for p, c in _RULES]

INVENTORY_HINTS = ("inventory", "stock", "raw material", "wholesale", "restock")
DISCRETIONARY_HINTS = ("dining", "leisure", "shopping", "entertainment", "gift", "misc", "decor", "subscription")
UTILITY_HINTS = ("utilit", "electric", "power", "gas", "energy")


def expense_group(category: str) -> str:
    c = category.lower()
    if any(h in c for h in INVENTORY_HINTS):
        return "inventory"
    if any(h in c for h in DISCRETIONARY_HINTS):
        return "discretionary"
    if any(h in c for h in UTILITY_HINTS):
        return "utilities"
    return "operating"


def is_utility(category: str) -> bool:
    return expense_group(category) == "utilities"


def _tokens(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z]{3,}", text.lower()) if t not in {"the", "and", "for", "from", "with"}}


def categorize(description: str, direction: str, history: list[tuple[str, str]] | None = None) -> tuple[str, str, float]:
    """Suggest a category for a description.

    Returns (category, reason, confidence). The user's own past categorizations
    (description, category) are checked first: a strong token overlap with an
    earlier transaction reuses that category ("learned from your edits").
    """
    if history:
        tokens = _tokens(description)
        if tokens:
            votes: Counter[str] = Counter()
            for past_desc, past_cat in history:
                overlap = len(tokens & _tokens(past_desc))
                if overlap and overlap / max(len(tokens), 1) >= 0.5:
                    votes[past_cat] += overlap
            if votes:
                cat, _ = votes.most_common(1)[0]
                return cat, "matched your earlier transactions", 0.9
    for pattern, category in _COMPILED:
        m = pattern.search(description)
        if m:
            is_income_cat = category in INCOME_CATEGORIES
            if (direction == "in") == is_income_cat:
                return category, f"keyword '{m.group(0).strip()}'", 0.75
    return ("Other Income" if direction == "in" else "Miscellaneous"), "no rule matched", 0.3
