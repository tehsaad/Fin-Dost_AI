"""Question understanding for the Copilot: intent scoring, parameter extraction and follow-ups.

The old router took the *first* regex that matched from an ordered list, so a paraphrase either
fell through to the generic "I couldn't match that" reply or landed on the wrong tool. Here every
question is turned into a set of concepts (English, Roman Urdu and Urdu script), each intent is
scored from those concepts, and the best-scoring intent wins only if it is clearly supported.
Weak matches become a specific clarification; follow-ups ("what if it drops another 10%?") reuse
the previous turn's intent and parameters, which the client echoes back and we re-validate.

Nothing here touches financial data: it only decides which engine tool to run and with what inputs.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date

from ..money import rupees

URDU_SCRIPT = re.compile(r"[؀-ۿ]")

# Intents that run an engine tool. "clarify", "unknown" and "out_of_scope" are answers about the question itself.
TOOL_INTENTS = ("balance", "why_risk", "follow_up", "overdue", "expense_compare", "spending", "upcoming_expense",
                "after_suppliers", "sales_decline", "delayed_collection", "scenario", "compare", "affordability",
                "explain_dashboard", "performance", "party", "glossary")
SCENARIO_INTENTS = ("sales_decline", "delayed_collection", "scenario")
PARAM_KEYS = ("percent", "delay_days", "amount_paisa", "day")
# Parameters each tool actually uses; only these are carried between turns.
RELEVANT = {"sales_decline": ("percent",), "delayed_collection": ("delay_days",), "scenario": ("percent", "delay_days"),
            "affordability": ("amount_paisa", "day"), "balance": ("day",)}


def relevant_params(intent: str | None, params: dict) -> dict:
    keys = RELEVANT.get(intent or "", ())
    if intent == "sales_decline" or intent == "delayed_collection":
        keys = RELEVANT["scenario"]  # a sales scenario can grow into a combined one
    return {k: v for k, v in params.items() if k in keys and v is not None}

CONFIDENT = 3.0
WEAK = 1.5

# Concepts. Patterns run on lower-cased text; Urdu-script words have no case.
CONCEPTS: dict[str, tuple[str, ...]] = {
    "whatif": (r"\bwhat if\b", r"\bwhat happens\b", r"\bwhat would happen\b", r"\bsuppose\b", r"\bimagine\b", r"\bassum",
               r"\bif\b", r"\bagar\b", r"\bfarz\b", r"\bscenario", r"\bsimulat", r"\bimpact\b", r"\beffect\b", r"\basar\b",
               r"kya hoga", r"اگر", r"فرض", r"اثر", r"کیا ہوگا"),
    "sales": (r"\bsales?\b", r"\brevenue\b", r"\bincome\b", r"\bturnover\b", r"\bearnings?\b", r"\bbikri\b", r"\bbikree\b",
              r"\bfarokht\b", r"\baamdani\b", r"\bamdani\b", r"\bkamai\b", r"\bselling\b", r"\bbusiness\b", r"فروخت",
              r"آمدنی", r"کمائی", r"سیل", r"بکری"),
    "decline": (r"\bdrops?\b", r"\bdropp", r"\bfalls?\b", r"\bfell\b", r"\bfalling\b", r"\bdeclin", r"\bdecreas", r"\bdown\b",
                r"\blower\b", r"\bless\b", r"\breduc", r"\bshrink", r"\bslump", r"\bslow(s|er)? down\b", r"\bdip",
                r"\bkam\b", r"\bghat", r"\bgir\b", r"\bgir ja", r"\bgirr", r"کم", r"گر", r"گھٹ"),
    "increase": (r"\bincreas", r"\brise\b", r"\brising\b", r"\brose\b", r"\bgrow", r"\bwent up\b", r"\bgone up\b", r"\bgo up\b",
                 r"\bhigher\b", r"\bmore\b", r"\bbarh", r"\bbadh", r"\bzyada\b", r"\bziada\b", r"بڑھ", r"زیادہ"),
    "delay": (r"\blate\b", r"\bdelay", r"\blater\b", r"\bslow(ly)? to pay\b", r"\bpays? slow", r"\bder\b", r"\bdair\b",
              r"\bdeir\b", r"\btakheer\b", r"دیر", r"تاخیر"),
    "customer": (r"\bcustomers?\b", r"\bclients?\b", r"\bbuyers?\b", r"\bdebtors?\b", r"\bgahak", r"\bgaahak", r"گاہک",
                 r"\bkhareedar"),
    "owe_me": (r"\bowes? me\b", r"\bowed to me\b", r"\bowe us\b", r"\breceivables?\b", r"\budhaa?r\b", r"\blena hai\b",
               r"\bcollect", r"\bwasool", r"\bunpaid invoices?\b", r"\boutstanding\b", r"\binvoices?\b", r"\bbaqaya\b",
               r"ادھار", r"وصول", r"بقایا"),
    "contact": (r"\bcontact\b", r"\bcall\b", r"\bremind", r"\bfollow.?up\b", r"\bchase\b", r"\bfirst\b", r"\bprioriti",
                r"\bpehle\b", r"\bpehlay\b", r"\brabta\b", r"پہلے", r"رابطہ"),
    "supplier": (r"\bsuppliers?\b", r"\bvendors?\b", r"\bpayables?\b", r"\bcreditors?\b", r"\bsapplier", r"\bdistributor",
                 r"\bwholesaler", r"سپلائر", r"\bi owe\b", r"\bbills? due\b"),
    "pay": (r"\bpay\b", r"\bpaying\b", r"\bpays\b", r"\bpayments?\b", r"\bpaid\b", r"\badaigi\b", r"\badayegi\b",
            r"ادائیگی", r"\bbills?\b"),
    "expense": (r"\bexpenses?\b", r"\bexpenditure", r"\bspend", r"\bspent\b", r"\bcosts?\b", r"\boutgoings?\b",
                r"\bkharch", r"\bkharcha", r"\bakhrajat\b", r"خرچ", r"اخراجات"),
    "compare": (r"\bcompar", r"\bvs\.?\b", r"\bversus\b", r"\bagainst\b", r"\bmuqab", r"\bmukab", r"\bdifference\b",
                r"\bchanged?\b", r"\bthan\b", r"\bmonth over month\b", r"مقابل", r"موازنہ", r"فرق"),
    "period_prev": (r"\blast (two|2|three|3|few) months\b", r"\blast month\b", r"\bprevious month\b", r"\bprior month\b",
                    r"\bpichl", r"\bpichh", r"\bguzisht", r"پچھل", r"گزشتہ", r"\bover the last\b", r"\bthis month\b",
                    r"\bis mahine\b"),
    "why": (r"\bwhy\b", r"\breasons?\b", r"\bcaus", r"\bdriv", r"\bhow come\b", r"\bkyun\b", r"\bkyon\b", r"\bkiyun\b",
            r"\bwajah\b", r"\bwaja\b", r"کیوں", r"وجہ"),
    "worse": (r"\bworse\b", r"\bworsen", r"\bgetting bad\b", r"\bdeteriorat", r"\bshrinking\b", r"\bkharab\b",
              r"\bbad shape\b", r"\bdeclining\b", r"خراب"),
    "run_out": (r"\brun(ning)? out\b", r"\bran out\b", r"\brun(ning)? short\b", r"\bshortage\b", r"\bshort (of|on) (cash|money)\b",
                r"\bout of (cash|money)\b", r"\bbroke\b", r"\binsufficient\b", r"\bnot enough (cash|money)\b",
                r"\bkhatam\b", r"\bkami\b", r"\bgo negative\b", r"ختم", r"کمی"),
    "risk": (r"\brisks?\b", r"\brisky\b", r"\bdanger", r"\bkhatr", r"\bthreat", r"\bwarnings?\b", r"\balerts?\b",
             r"\bvulnerab", r"\bworr", r"خطر"),
    "cash": (r"\bcash\b", r"\bmoney\b", r"\bbalance\b", r"\bfunds?\b", r"\bliquidity\b", r"\bpais[ae]\b", r"\bpaisay\b",
             r"\bpes[ae]\b", r"\braqam\b", r"\bnaqd", r"\bcash.?flow\b", r"نقد", r"پیس", r"رقم", r"کیش"),
    "how_much": (r"\bhow much\b", r"\bkitna\b", r"\bkitni\b", r"\bkitne\b", r"\bwhat('s| is) my\b", r"\bdo i have\b",
                 r"\bi have\b", r"\bleft\b", r"\bremain", r"\bbach", r"کتن", r"بچ"),
    "future": (r"\bnext (week|month)\b", r"\bwill i\b", r"\bforecast", r"\bproject", r"\bupcoming\b", r"\bcoming\b",
               r"\bagl[ae]\b", r"\baglay\b", r"\bfuture\b", r"\bend of (the )?month\b", r"\bin \d+ days?\b",
               r"\btomorrow\b", r"\bhoga\b", r"\bhogi\b", r"\bhonge\b", r"اگلے", r"ہوگا", r"ہوگی"),
    "afford": (r"\bafford", r"\bcan i (buy|spend|pay|purchase|take on)\b", r"\ble sakta\b", r"\ble sakti\b", r"\bkhareed",
               r"\bkharid", r"\bbardasht\b", r"\bde sakta\b", r"\bde sakti\b", r"\bdo i have enough\b",
               r"\benough (cash|money) (for|to)\b", r"\bpurchase\b", r"خرید", r"برداشت", r"سکتا", r"سکتی"),
    "strategy": (r"\bstrateg", r"\boptions?\b", r"\brecovery\b", r"\bwhat (should|can) i do\b", r"\bhow (can|do|should) i (improve|fix|recover|avoid|prevent)\b",
                 r"\bsolutions?\b", r"\bplan\b", r"\bhal\b", r"\btajweez\b", r"\bkya karun\b", r"\bkya karoon\b",
                 r"\bimprove\b", r"\bsteps\b", r"حل", r"تجویز", r"کیا کروں"),
    "dashboard": (r"\bdashboard\b", r"\bsummary\b", r"\bsummari", r"\boverview\b", r"\bkhulasa\b", r"\bhow am i doing\b",
                  r"\bhow('s| is) (my )?(business|shop|dukaan) doing\b", r"\bhealth", r"\bhealthy\b", r"\bstatus\b",
                  r"\bposition\b", r"\bsamjha", r"\bbig picture\b", r"خلاصہ", r"سمجھا", r"ڈیش بورڈ", r"\bkaisa chal\b"),
    "profit": (r"\bprofit", r"\bmunafa\b", r"\bmunafay\b", r"\bmargin", r"\bloss\b", r"\bnuqsan\b", r"\bnet income\b",
               r"\bmade\b", r"\bearn(ed)?\b", r"منافع", r"نقصان"),
    "biggest": (r"\bbiggest\b", r"\blargest\b", r"\btop\b", r"\bmain\b", r"\bmost\b", r"\bsab se\b", r"\bwhere\b",
                r"\bcategor", r"\bbreakdown\b", r"\bkahan\b", r"سب سے", r"کہاں"),
    "upcoming": (r"\bupcoming\b", r"\bnext\b", r"\bcoming\b", r"\bdue soon\b", r"\bdue (this|next) week\b", r"\baane wal",
                 r"\banay wal", r"آنے وال"),
    "overdue": (r"\boverdue\b", r"\bpast due\b", r"\blate (payments?|bills?|invoices?)\b", r"\bdue date (guzar|nikal)",
                r"\bnot paid (on time|yet)\b", r"\bdefault", r"واجب الادا", r"\btakheer\b.*\b(wasool|adaigi)"),
    "after": (r"\bafter\b", r"\bonce i pay\b", r"\bremain", r"\bleft over\b", r"\bbach", r"\bimpact\b", r"\bnow or later\b",
              r"\bdefer", r"\bpostpone", r"\bdelay paying\b", r"\bbaad\b", r"بعد"),
    "who": (r"\bwho\b", r"\bwhich\b", r"\bkaun\b", r"\bkon\b", r"\bkis\b", r"کون", r"کس"),
    "urdu_request": (r"\bin urdu\b", r"\burdu (mein|me|main)\b", r"اردو میں"),
    "followup_cue": (r"\banother\b", r"\bmore\b", r"\binstead\b", r"\bwhat about\b", r"\bhow about\b", r"\band if\b",
                     r"\bsame\b", r"\bagain\b", r"\bit\b", r"\bthat\b", r"\bthen\b", r"\baur\b", r"\bphir\b", r"\bmazeed\b",
                     r"\bbhi\b", r"\balso\b", r"اور", r"مزید", r"بھی"),
}
_COMPILED = {k: [re.compile(p) for p in v] for k, v in CONCEPTS.items()}

GLOSSARY_Q = (re.compile(r"\bwhat (is|are|does) (a |an |the )?(receivable|payable|cash ?flow|profit|reserve|forecast|shortage|udhaar|risk)s?\b(\s+mean)?\s*\??$"),
              re.compile(r"\bmatlab\b"), re.compile(r"کا مطلب"), re.compile(r"\bmeaning of\b"))

YES = re.compile(r"^(yes|yeah|yep|sure|ok(ay)?|right|correct|exactly|haan|han|ji|ji haan|jee|bilkul|ہاں|جی|جی ہاں|بالکل)\b")

OUT_OF_SCOPE = (r"stock market", r"\bpsx\b", r"crypto", r"bitcoin", r"\bgold\b", r"interest rate", r"exchange rate",
                r"weather", r"\btax\b", r"\bloan\b", r"\bdollar rate\b", r"\bcricket\b")

# Number words for percentages, delays and amounts.
FRACTIONS = {"a fifth": 20, "one fifth": 20, "a quarter": 25, "one quarter": 25, "one fourth": 25, "a fourth": 25,
             "a third": 33, "one third": 33, "half": 50, "aadha": 50, "aadhi": 50, "a tenth": 10, "one tenth": 10,
             "chothai": 25, "chauthai": 25, "آدھ": 50, "چوتھائی": 25}
NUMBER_WORDS = {"one": 1, "a": 1, "an": 1, "ek": 1, "two": 2, "do": 2, "three": 3, "teen": 3, "four": 4, "char": 4,
                "chaar": 4, "five": 5, "paanch": 5, "panch": 5, "six": 6, "seven": 7, "ten": 10, "das": 10,
                "fifteen": 15, "pandrah": 15, "twenty": 20, "bees": 20, "twenty-five": 25, "twenty five": 25,
                "pachees": 25, "pachchees": 25, "thirty": 30, "tees": 30, "forty": 40, "chalees": 40, "fifty": 50,
                "pachas": 50, "pachaas": 50}
UNIT_DAYS = {"day": 1, "days": 1, "din": 1, "week": 7, "weeks": 7, "hafta": 7, "hafte": 7, "haftay": 7, "haftey": 7,
             "month": 30, "months": 30, "mahina": 30, "mahine": 30, "mahinay": 30, "دن": 1, "ہفتے": 7, "ہفتہ": 7,
             "مہینہ": 30, "مہینے": 30}
_NUM_ALT = "|".join(sorted((re.escape(w) for w in NUMBER_WORDS), key=len, reverse=True))
_UNIT_ALT = "|".join(sorted((re.escape(w) for w in UNIT_DAYS), key=len, reverse=True))


@dataclass
class Understanding:
    intent: str
    score: float
    params: dict = field(default_factory=dict)
    candidates: list[tuple[str, float]] = field(default_factory=list)
    concepts: frozenset[str] = frozenset()
    followup: bool = False          # parameters/intent were carried over from the previous turn
    clarify_for: str | None = None  # intent we think was meant, when asking a clarifying question
    language_only: bool = False     # "say that in Urdu": repeat the previous answer


def concepts(text: str) -> frozenset[str]:
    low = text.lower()
    return frozenset(k for k, pats in _COMPILED.items() if any(p.search(low) for p in pats))


# ------------------------------------------------------------------------------------- parameters

def _word_or_digit(token: str) -> float | None:
    token = token.strip().lower()
    if re.fullmatch(r"\d+(\.\d+)?", token):
        return float(token)
    return float(NUMBER_WORDS[token]) if token in NUMBER_WORDS else None


def parse_percent(text: str) -> tuple[int | None, bool]:
    """(percent, additional). '20%', '20 percent', 'bees fisad', 'a fifth', 'by half'; 'another 10%' is additional."""
    low = text.lower()
    additional = bool(re.search(r"\b(another|more|further|extra|additional|mazeed|aur)\b|مزید", low))
    m = re.search(r"(\d{1,3}(?:\.\d+)?)\s*(%|percent\b|per cent\b|pc\b|fisad\b|feesad\b|فیصد)", low)
    if m:
        return min(int(round(float(m.group(1)))), 100), additional
    m = re.search(rf"\b({_NUM_ALT})\s+(percent|per cent|fisad|feesad)\b", low)
    if m:
        v = _word_or_digit(m.group(1))
        return (min(int(v), 100) if v else None), additional
    for phrase, value in sorted(FRACTIONS.items(), key=lambda kv: -len(kv[0])):
        if re.search(rf"(?<!\w){re.escape(phrase)}(?!\w)", low):
            return value, additional
    if re.search(r"\b(doubles?|double ho)\b", low):
        return None, additional
    return None, additional


def parse_delay_days(text: str) -> int | None:
    """'two weeks late', '15 days late', 'a month late', 'do hafte der se', 'delayed by 10 days'."""
    low = text.lower()
    m = re.search(rf"(\d+|{_NUM_ALT})[\s-]*({_UNIT_ALT})\b[^.?!]{{0,30}}?\b(late|delay|later|der|dair|takheer)", low) \
        or re.search(rf"(late|delay(?:ed)?|later|der|dair|takheer)\b[^.?!]{{0,15}}?\b(?:by\s+)?(\d+|{_NUM_ALT})[\s-]*({_UNIT_ALT})\b", low)
    if not m:
        m = re.search(rf"(\d+|{_NUM_ALT})\s*({_UNIT_ALT})[^.?!]{{0,20}}(دیر|تاخیر)", low)
    if not m:
        return None
    groups = [g for g in m.groups() if g]
    num = next((g for g in groups if _word_or_digit(g) is not None), None)
    unit = next((g for g in groups if g in UNIT_DAYS), None)
    if num is None or unit is None:
        return None
    days = int(_word_or_digit(num) * UNIT_DAYS[unit])
    return max(1, min(days, 180))


def parse_amount(text: str) -> int | None:
    """An amount in paisa. Prefers numbers marked as money (Rs, rupees, lakh, k); ignores percentages,
    day/week counts, years and dates so '20%' or 'in 10 days' are never read as an amount."""
    low = text.lower().replace(",", "")
    low = re.sub(r"\d{4}-\d{2}-\d{2}", " ", low)
    best: int | None = None
    for m in re.finditer(r"(rs\.?|pkr|rupees?|روپے)?\s*(\d+(?:\.\d+)?)\s*(lakh|lac|crore|k\b|thousand|hazar|hazaar|ہزار|لاکھ)?"
                         r"\s*(%|percent|fisad|days?|din|weeks?|hafte|haftay|months?|mahine|rupees?|روپے)?", low):
        prefix, num, unit, suffix = m.groups()
        if suffix and suffix not in ("rupee", "rupees", "روپے"):
            continue
        value = float(num)
        mult = {"lakh": 100_000, "lac": 100_000, "لاکھ": 100_000, "crore": 10_000_000, "k": 1_000, "thousand": 1_000,
                "hazar": 1_000, "hazaar": 1_000, "ہزار": 1_000}.get((unit or "").strip(), 1)
        marked = bool(prefix or unit or suffix)
        if not marked and (1900 <= value <= 2100 or value < 100):
            continue  # a year, or a small count ("2 customers") rather than an amount
        amount = rupees(value * mult)
        if marked:
            return amount
        best = max(best or 0, amount)
    return best


def parse_day(text: str, today: date) -> int | None:
    """Days from today for 'tomorrow', 'next week', 'in 10 days', 'agle mahine', an ISO date; None if not stated."""
    low = text.lower()
    m = re.search(r"(\d{4}-\d{2}-\d{2})", low)
    if m:
        try:
            return max((date.fromisoformat(m.group(1)) - today).days, 1)
        except ValueError:
            pass
    m = re.search(r"\bin (\d+) days?\b", low) or re.search(r"\b(\d+) din\b", low)
    if m:
        return max(int(m.group(1)), 1)
    if re.search(r"\btomorrow\b|\bkal\b", low):
        return 1
    if re.search(r"next month|agl[ae] mahin|aglay mahin|end of (the )?month|اگلے مہینے", low):
        return 30
    if re.search(r"next week|agl[ae] haft|aglay haft|اگلے ہفتے", low):
        return 7
    if re.search(r"\btoday\b|\baaj\b|آج", low):
        return 1
    return None


def extract_params(text: str, today: date) -> dict:
    pct, additional = parse_percent(text)
    out = {"percent": pct, "percent_additional": additional and pct is not None,
           "delay_days": parse_delay_days(text), "amount_paisa": None, "day": parse_day(text, today)}
    if pct is None:  # "drops by 20%" must never become Rs. 20
        out["amount_paisa"] = parse_amount(text)
    return out


# ------------------------------------------------------------------------------------- scoring

def score_intents(c: frozenset[str], p: dict) -> dict[str, float]:
    s: dict[str, float] = {}

    def add(intent: str, value: float) -> None:
        s[intent] = s.get(intent, 0.0) + value

    has = c.__contains__
    # Affordability: "can I afford", "do I have enough for", "kya main X le sakta hoon"
    if has("afford"):
        add("affordability", 4)
    if has("pay") and p["amount_paisa"] and (has("future") or p["day"]) and not has("supplier"):
        add("affordability", 2.5)

    # Scenarios: a sales drop, late customer payments, or both
    if has("sales") and has("decline"):
        add("sales_decline", 3 + (1.5 if has("whatif") else 0) + (1 if p["percent"] else 0))
    elif has("decline") and has("whatif"):
        add("sales_decline", 1.5 + (0.5 if p["percent"] else 0))  # "what if it drops 10%?" - needs context
    if has("sales") and has("whatif") and p["percent"] and not has("increase"):
        add("sales_decline", 1)
    if has("delay") and (has("customer") or has("pay") or has("owe_me")) and (has("whatif") or p["delay_days"]):
        add("delayed_collection", 3.5 + (1 if p["delay_days"] else 0))
    if s.get("sales_decline", 0) >= CONFIDENT and s.get("delayed_collection", 0) >= CONFIDENT:
        add("scenario", max(s["sales_decline"], s["delayed_collection"]) + 1)

    # Receivables
    if has("overdue"):
        add("overdue", 4)
    if has("owe_me"):
        add("follow_up", 3 + (1.5 if has("contact") else 0) + (0.5 if has("who") else 0))
    if has("customer") and (has("contact") or has("who")) and not has("delay"):
        add("follow_up", 2)
    if has("customer") and has("pay") and has("who") and not has("delay"):
        add("follow_up", 1.5)

    # Expenses
    if has("expense"):
        if has("compare") or has("period_prev") or (has("why") and (has("increase") or has("decline"))):
            add("expense_compare", 4 + (1 if has("why") else 0) + (0.5 if has("period_prev") else 0))
        if has("upcoming") or (has("future") and not has("period_prev")):
            add("upcoming_expense", 3 + (1.5 if has("biggest") else 0))
        else:
            add("spending", 2 + (1.5 if has("biggest") else 0) + (0.5 if has("how_much") else 0))
    elif has("upcoming") and has("pay") and has("biggest"):
        add("upcoming_expense", 4)

    # Suppliers
    if has("supplier"):
        add("after_suppliers", 2 + (1.5 if (has("pay") or has("after") or has("how_much")) else 0)
            + (0.5 if has("cash") else 0))
    elif has("after") and has("pay") and (has("cash") or has("how_much")):
        add("after_suppliers", 4)  # "how much cash remains after scheduled bills?"

    # Cash position, risk and trend
    if has("run_out"):
        add("why_risk", 3.5 + (1 if has("why") else 0))
    if has("risk"):
        add("why_risk", 2.5 + (1 if has("why") else 0))
    if has("worse") and (has("cash") or has("sales") or has("business")):
        add("why_risk", 3.5)
    if has("why") and has("cash") and not has("expense"):
        add("why_risk", 2.5)
    if has("cash") and (has("how_much") or has("future")) and not has("whatif"):
        add("balance", 3 + (0.5 if has("how_much") else 0))
    elif has("cash") and not s:
        add("balance", 1.5)

    # Recovery strategies
    if has("strategy"):
        add("compare", 3.5 + (0.5 if has("compare") else 0))

    # Overview and performance
    if has("dashboard"):
        add("explain_dashboard", 3.5)
    if has("profit"):
        add("performance", 3.5)
    if has("sales") and (has("how_much") or has("period_prev")) and not (has("whatif") or has("decline") or has("delay")):
        add("performance", 3)
    return s


PRIORITY = ("glossary", "scenario", "affordability", "delayed_collection", "sales_decline", "expense_compare", "overdue",
            "follow_up", "upcoming_expense", "after_suppliers", "why_risk", "compare", "performance", "spending",
            "balance", "explain_dashboard")


def classify(text: str, today: date) -> Understanding:
    c = concepts(text)
    p = extract_params(text, today)
    low = text.lower()
    if any(g.search(low) for g in GLOSSARY_Q):
        return Understanding("glossary", 5.0, p, [("glossary", 5.0)], c)
    scores = score_intents(c, p)
    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], PRIORITY.index(kv[0]) if kv[0] in PRIORITY else 99))
    if not ranked:
        return Understanding("unknown", 0.0, p, [], c)
    intent, score = ranked[0]
    return Understanding(intent, score, p, ranked[:4], c)


def is_out_of_scope(text: str) -> bool:
    low = text.lower()
    return any(re.search(p, low) for p in OUT_OF_SCOPE)


# ------------------------------------------------------------------------------------- follow-ups

def _clean_params(params: dict | None) -> dict:
    """Context echoed by the client is untrusted: keep known keys with sane values only."""
    out: dict = {}
    for key in PARAM_KEYS:
        v = (params or {}).get(key)
        if isinstance(v, bool) or not isinstance(v, int):
            continue
        limits = {"percent": (1, 100), "delay_days": (1, 180), "amount_paisa": (1, 10**13), "day": (1, 365)}[key]
        if limits[0] <= v <= limits[1]:
            out[key] = v
    return out


def understand(text: str, today: date, context: dict | None = None) -> Understanding:
    """Classify a question, using the previous turn's intent/parameters for follow-ups."""
    u = classify(text, today)
    prev_intent = (context or {}).get("intent")
    prev_intent = prev_intent if prev_intent in TOOL_INTENTS else None
    prev_params = _clean_params((context or {}).get("params"))
    pending = bool((context or {}).get("pending"))
    if u.score < CONFIDENT and is_out_of_scope(text):
        return u  # "what about the PSX index today?" is not a follow-up
    new = relevant_params(prev_intent, u.params) if prev_intent else {}

    if prev_intent and pending and u.score < CONFIDENT and YES.match(text.strip().lower()):
        return Understanding(prev_intent, CONFIDENT, {**prev_params, **new}, u.candidates, u.concepts, followup=True)

    if prev_intent and "urdu_request" in u.concepts and u.score < CONFIDENT:
        return Understanding(prev_intent, CONFIDENT, {**prev_params}, u.candidates, u.concepts, followup=True,
                             language_only=True)

    if prev_intent and u.score < CONFIDENT:
        carries = bool(new) or "followup_cue" in u.concepts or u.intent == prev_intent
        compatible = u.intent in ("unknown", prev_intent) or (u.intent in SCENARIO_INTENTS and prev_intent in SCENARIO_INTENTS)
        if carries and (compatible or pending):
            params = {**prev_params}
            if new.get("percent") and u.params.get("percent_additional") and prev_params.get("percent"):
                params["percent"] = min(prev_params["percent"] + new["percent"], 100)
                new = {k: v for k, v in new.items() if k != "percent"}
            params.update(new)
            return Understanding(prev_intent, CONFIDENT, params, u.candidates, u.concepts, followup=True)

    # Confident new intent: a scenario follow-up keeps the earlier shock unless restated ("and if customers also pay late").
    if prev_intent in SCENARIO_INTENTS and u.intent in SCENARIO_INTENTS and "followup_cue" in u.concepts:
        merged = {**prev_params, **new}
        if new.get("percent") and u.params.get("percent_additional") and prev_params.get("percent"):
            merged["percent"] = min(prev_params["percent"] + new["percent"], 100)
        if merged.get("percent") and merged.get("delay_days"):
            return Understanding("scenario", u.score, merged, u.candidates, u.concepts, followup=True)
        u.params = {**u.params, **merged}
        u.followup = True
        return u

    if u.score >= CONFIDENT:
        return u
    if u.score >= WEAK:
        return Understanding("clarify", u.score, u.params, u.candidates, u.concepts, clarify_for=u.intent)
    return u


def language_of(text: str, preferred: str) -> str:
    if URDU_SCRIPT.search(text) or re.search(r"\burdu\b", text, re.I):
        return "ur"
    return preferred if preferred in ("en", "ur") else "en"
