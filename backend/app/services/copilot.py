"""Financial Copilot (Module K).

Deterministic intent routing over the same engine functions the dashboard uses.
Every answer is built from computed evidence, which is returned alongside the
answer. Questions the data cannot support get an explicit "I can't answer that
from your records". An LLM, if enabled with consent, only rephrases.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

from ..money import fmt_pkr, rupees
from .forecast import run_forecast
from .i18n import GLOSSARY, isolate_ltr, urdu_affordability, urdu_dashboard_summary, urdu_shortage_reason
from .ledger import account_balances, period_summary, receivables_summary
from .recovery import recommend
from .simulation import simulate
from .snapshot import Snapshot

URDU_SCRIPT = re.compile(r"[؀-ۿ]")

INTENTS: list[tuple[str, tuple[str, ...]]] = [
    ("glossary", (r"\bwhat (is|are|does) (a |an |the )?(receivable|payable|cash ?flow|profit|reserve|forecast|shortage|udhaar)",
                  r"\bmatlab\b", r"کا مطلب", r"کیا ہے")),
    ("explain_dashboard", (r"explain", r"samjha", r"سمجھا", r"dashboard", r"summary", r"overview", r"خلاصہ")),
    ("affordability", (r"afford", r"can i (buy|spend|pay)", r"kharid", r"khareed", r"خرید", r"le sakta", r"purchase")),
    ("sales_decline", (r"sales? (drop|decrease|decline|fall|down|go down|kam)", r"(decrease|drop|fall|decline) in sales",
                       r"bikri kam", r"فروخت کم")),
    ("why_risk", (r"why", r"\brisk", r"khatra", r"kyun", r"کیوں", r"خطرہ", r"shortage")),
    ("follow_up", (r"follow.?up", r"invoice", r"which customers", r"wasool", r"وصول", r"collect", r"remind", r"udhaar", r"ادھار")),
    ("after_suppliers", (r"supplier", r"after (paying|scheduled)", r"bills? due", r"remain", r"bach")),
    ("compare", (r"compare", r"strateg", r"options?", r"recovery", r"muqabla", r"موازنہ")),
    ("spending", (r"where .*spend", r"spending", r"expenses?", r"kharch", r"خرچ")),
    ("balance", (r"balance", r"how much (cash|money)", r"kitne paise", r"kitna cash", r"cash in hand", r"نقد")),
]
OUT_OF_SCOPE = (r"stock market", r"\bpsx\b", r"crypto", r"bitcoin", r"\bgold\b", r"interest rate", r"exchange rate",
                r"weather", r"\btax\b", r"\bloan\b")


def detect_language(text: str, preferred: str) -> str:
    if URDU_SCRIPT.search(text) or re.search(r"\burdu\b", text, re.I):
        return "ur"
    return preferred if preferred in ("en", "ur") else "en"


ROMAN_URDU = re.compile(r"\b(kya|kitna|kitne|kitni|hai|hain|mein|mera|meri|mujhe|paise|kharch|khatra|kyun|bach|"
                        r"wasool|karun|karoon|sakta|sakti|agle|hafte|batao|samjhao)\b", re.I)


def is_roman_urdu(text: str) -> bool:
    """Urdu written in Latin letters ("kitna cash bachega?"): at least two common Roman Urdu words."""
    return not URDU_SCRIPT.search(text) and len(ROMAN_URDU.findall(text)) >= 2


def detect_intent(text: str) -> str:
    low = text.lower()
    for intent, patterns in INTENTS:
        if any(re.search(p, low) for p in patterns):
            return intent
    return "unknown"


def parse_amount_from_text(text: str) -> int | None:
    low = text.lower().replace(",", "")
    m = re.search(r"(\d+(?:\.\d+)?)\s*(lakh|lac|crore|k|thousand|hazar|hazaar)?\b", low)
    if not m:
        return None
    value = float(m.group(1))
    unit = m.group(2)
    mult = {"lakh": 100_000, "lac": 100_000, "crore": 10_000_000, "k": 1_000, "thousand": 1_000,
            "hazar": 1_000, "hazaar": 1_000}.get(unit or "", 1)
    return rupees(value * mult)


def parse_day_from_text(text: str, today: date) -> int:
    low = text.lower()
    m = re.search(r"(\d{4}-\d{2}-\d{2})", low)
    if m:
        try:
            return max((date.fromisoformat(m.group(1)) - today).days, 1)
        except ValueError:
            pass
    m = re.search(r"in (\d+) days?", low) or re.search(r"(\d+) din", low)
    if m:
        return max(int(m.group(1)), 1)
    if re.search(r"tomorrow|\bkal\b", low):
        return 1
    if re.search(r"next month|agle mahine", low):
        return 30
    if re.search(r"today|\baaj\b", low):
        return 1
    return 7  # "next week" and default


def _percent(text: str, default: int = 20) -> int:
    m = re.search(r"(\d{1,3})\s*(%|percent|fisad)", text.lower())
    return min(int(m.group(1)), 100) if m else default


def answer(snap: Snapshot, today: date, question: str, language: str = "en",
           kind_features: frozenset[str] = frozenset()) -> dict:
    question = question.strip()
    lang = detect_language(question, language)
    low = question.lower()
    if any(re.search(p, low) for p in OUT_OF_SCOPE):
        return _reply("out_of_scope", lang,
                      "I can only answer from your FinDost records (cash, sales, expenses, customers, suppliers, "
                      "forecasts and scenarios). Your records don't contain information to answer that.",
                      "میں صرف آپ کے FinDost ریکارڈ سے جواب دے سکتا ہوں۔ اس سوال کا جواب آپ کے ریکارڈ میں موجود نہیں۔",
                      [], {})
    intent = detect_intent(question)
    forecast = run_forecast(snap, today, 30)
    s = forecast["summary"]
    ev: list[str] = []

    if intent == "glossary":
        for g in GLOSSARY:
            key = g["term"].lower().split(" ")[0]
            if key in low or g["urdu"].split(" ")[0] in question or ("udhaar" in low and "receivable" in key):
                return _reply("glossary", lang, f"{g['term']}: {g['simple']}", f"{g['urdu']}: {g['urdu_simple']}",
                              [], {"term": g["term"]})
        intent = "unknown"

    if intent == "balance":
        b = account_balances(snap, today)
        ev = [f"Cash {fmt_pkr(b['cash'])}", f"Bank {fmt_pkr(b['bank'])}", f"Wallet {fmt_pkr(b['wallet'])}",
              f"Total {fmt_pkr(b['total'])}"]
        return _reply("balance", lang,
                      f"You have {fmt_pkr(b['total'])} in total today: cash {fmt_pkr(b['cash'])}, bank {fmt_pkr(b['bank'])}, "
                      f"wallet {fmt_pkr(b['wallet'])}. In 7 days the forecast is about {fmt_pkr(s['balance_d7_paisa'])}.",
                      f"آج آپ کے پاس کل {fmt_pkr(b['total'])} ہیں: نقد {fmt_pkr(b['cash'])}، بینک {fmt_pkr(b['bank'])}، "
                      f"والٹ {fmt_pkr(b['wallet'])}۔ سات دن بعد اندازاً {fmt_pkr(s['balance_d7_paisa'])} ہوں گے۔",
                      ev + [f"Forecast in 7 days {fmt_pkr(s['balance_d7_paisa'])}"], {"balances": b}, links=["/dashboard"])

    if intent == "affordability":
        amount = parse_amount_from_text(question)
        if not amount:
            return _reply("affordability", lang, "How much would the purchase cost? For example: 'Can I afford Rs. 50,000 next week?'",
                          "خریداری کی رقم بتائیں، مثلاً: 'کیا میں اگلے ہفتے 50,000 روپے خرچ کر سکتا ہوں؟'", [], {})
        day = min(parse_day_from_text(question, today), 30)
        sim = simulate(snap, today, [{"type": "unexpected_expense", "amount_paisa": amount, "day": day,
                                      "label": "Planned purchase"}])
        after = sim["scenario"]["summary"]
        ok = after["shortage_date"] is None
        ev = [f"Purchase {fmt_pkr(amount)} on day {day} ({(today + timedelta(days=day)).isoformat()})",
              f"Lowest balance without it {fmt_pkr(s['min_balance_paisa'])} on {s['min_balance_date']}",
              f"Lowest balance with it {fmt_pkr(after['min_balance_paisa'])} on {after['min_balance_date']}",
              f"Shortage date with it: {after['shortage_date'] or 'none'}"]
        if ok:
            en = (f"Yes, based on your forecast. After spending {fmt_pkr(amount)} in {day} day(s), the lowest projected "
                  f"balance is {fmt_pkr(after['min_balance_paisa'])} on {after['min_balance_date']}.")
            if s["reserve_paisa"] and after["min_balance_paisa"] < s["reserve_paisa"]:
                en += f" That is below your reserve of {fmt_pkr(s['reserve_paisa'])}, so keep it tight."
        else:
            en = (f"Not safely. Spending {fmt_pkr(amount)} in {day} day(s) would push the projected balance down to "
                  f"{fmt_pkr(after['min_balance_paisa'])} on {after['min_balance_date']} (shortage from {after['shortage_date']}).")
            if s["shortage_date"]:
                en += f" Note: a shortage is already projected on {s['shortage_date']} even without this purchase."
        return _reply("affordability", lang, en,
                      urdu_affordability(amount, day, ok, after["min_balance_paisa"], after["min_balance_date"]), ev,
                      {"affordable": ok, "amount_paisa": amount, "day": day, "scenario": after}, links=["/simulator"])

    if intent == "sales_decline":
        pct = _percent(question)
        sim = simulate(snap, today, [{"type": "sales_decline", "percent": pct, "start_day": 1, "duration_days": 30}])
        c = sim["comparison"]
        after = sim["scenario"]["summary"]
        ev = [f"Sales -{pct}% for 30 days", f"Baseline lowest balance {fmt_pkr(s['min_balance_paisa'])}",
              f"Scenario lowest balance {fmt_pkr(after['min_balance_paisa'])} on {after['min_balance_date']}",
              f"Balance after 30 days changes by {fmt_pkr(c['end_balance_change_paisa'])}"]
        en = (f"If sales fall {pct}% for the next 30 days, the lowest projected balance moves from "
              f"{fmt_pkr(s['min_balance_paisa'])} to {fmt_pkr(after['min_balance_paisa'])} "
              f"and cash after 30 days is {fmt_pkr(-c['end_balance_change_paisa'])} lower. "
              + (f"A shortage would start on {after['shortage_date']}." if after["shortage_date"] else "No shortage is projected."))
        ur = (f"اگر اگلے 30 دن فروخت {pct}% کم ہو تو سب سے کم نقدی {fmt_pkr(after['min_balance_paisa'])} ہو سکتی ہے، "
              f"اور 30 دن بعد نقدی {fmt_pkr(-c['end_balance_change_paisa'])} کم ہوگی۔ یہ صرف اندازہ ہے۔")
        return _reply("sales_decline", lang, en, ur, ev, {"comparison": c, "scenario": after}, links=["/simulator"])

    if intent == "follow_up":
        if not snap.receivables:
            return _reply("follow_up", lang, "You have no customer invoices (receivables) recorded, so there is nobody to follow up with.",
                          "آپ کے ریکارڈ میں کوئی ادھار وصولی درج نہیں ہے۔", [], {})
        open_recs = [r for r in snap.receivables if r.outstanding > 0]
        ranked = sorted(open_recs, key=lambda r: -(r.outstanding * (1 + max((today - r.due_on).days, 0) / 30)))
        top = ranked[:5]
        ev = [f"{r.customer_name} {r.reference or ''}: {fmt_pkr(r.outstanding)}, "
              f"{'overdue ' + str((today - r.due_on).days) + ' days' if r.due_on < today else 'due ' + r.due_on.isoformat()}"
              for r in top]
        en = ("Follow up in this order (largest and oldest first): "
              + "; ".join(f"{i + 1}. {r.customer_name} - {fmt_pkr(r.outstanding)}" for i, r in enumerate(top)) + ".")
        if s["shortage_date"]:
            en += f" Collecting before {s['shortage_date']} matters most because that is when cash is projected to run short."
        ur = "اس ترتیب سے وصولی کریں: " + "، ".join(f"{r.customer_name} ({fmt_pkr(r.outstanding)})" for r in top) + "۔"
        return _reply("follow_up", lang, en, ur, ev, {"receivable_ids": [r.id for r in top]},
                      links=["/transactions?tab=receivables"])

    if intent == "after_suppliers":
        horizon_end = today + timedelta(days=14)
        due = [p for p in snap.payables if p.outstanding > 0 and p.due_on <= horizon_end]
        total = sum(p.outstanding for p in due)
        last_day = max(((p.due_on - today).days for p in due), default=0)
        last_day = max(min(last_day, 30), 1)
        bal_after = next(pt["balance_paisa"] for pt in forecast["points"] if pt["day"] == last_day)
        ev = [f"{p.label}: {fmt_pkr(p.outstanding)} due {p.due_on.isoformat()}" for p in due[:8]]
        ev.append(f"Projected balance on day {last_day}: {fmt_pkr(bal_after)}")
        en = (f"{len(due)} scheduled payment(s) totalling {fmt_pkr(total)} are due in the next 14 days. After the last one "
              f"(day {last_day}), the projected balance is about {fmt_pkr(bal_after)}, including expected sales and collections.")
        ur = (f"اگلے 14 دن میں {fmt_pkr(total)} کی ادائیگیاں ہیں۔ آخری ادائیگی کے بعد اندازاً {fmt_pkr(bal_after)} باقی رہیں گے۔")
        return _reply("after_suppliers", lang, en, ur, ev, {"total_due_paisa": total, "balance_after_paisa": bal_after},
                      links=["/forecast"])

    if intent == "compare":
        rec = recommend(snap, today, [], 30)
        top = rec["strategies"][:2]
        if len(top) < 2:
            return _reply("compare", lang, "There are not enough recovery options for your data to compare yet.",
                          "موازنے کے لیے کافی آپشن موجود نہیں۔", [], {})
        a, b = top
        ev = [f"{x['title']}: lowest balance {fmt_pkr(x['result']['min_balance_paisa'])}, change "
              f"{fmt_pkr(x['comparison']['min_balance_change_paisa'])}, score {x['score']}" for x in top]
        better = a if a["result"]["min_balance_paisa"] >= b["result"]["min_balance_paisa"] else b
        en = (f"Option 1 - {a['title']}: raises the lowest balance by {fmt_pkr(a['comparison']['min_balance_change_paisa'])}. "
              f"Option 2 - {b['title']}: raises it by {fmt_pkr(b['comparison']['min_balance_change_paisa'])}. "
              f"'{better['title']}' leaves more cash at the low point under the stated assumptions; "
              f"see trade-offs on the Recovery page.")
        ur = (f"پہلا آپشن ({a['title']}) سب سے کم نقدی میں {fmt_pkr(a['comparison']['min_balance_change_paisa'])} اضافہ کرتا ہے، "
              f"دوسرا ({b['title']}) {fmt_pkr(b['comparison']['min_balance_change_paisa'])}۔")
        return _reply("compare", lang, en, ur, ev, {"strategy_ids": [a["id"], b["id"]]}, links=["/recovery"])

    if intent == "spending":
        p = period_summary(snap, today - timedelta(days=29), today)
        total = sum(p.expense_by_category.values())
        top = list(p.expense_by_category.items())[:4]
        if not total:
            return _reply("spending", lang, "No expenses recorded in the last 30 days.", "پچھلے 30 دن میں کوئی خرچ درج نہیں۔", [], {})
        ev = [f"{c}: {fmt_pkr(a)} ({a / total * 100:.0f}%)" for c, a in top]
        en = f"In the last 30 days you spent {fmt_pkr(total)}. Biggest categories: " + "; ".join(ev) + "."
        ur = f"پچھلے 30 دن میں کل خرچ {fmt_pkr(total)} رہا۔ سب سے بڑے خرچ: " + "، ".join(ev) + "۔"
        return _reply("spending", lang, en, ur, ev, {"categories": dict(top)}, links=["/reports"])

    if intent == "why_risk":
        contributors = forecast["contributors"][:4]
        ev = [f"Today {fmt_pkr(s['opening_balance_paisa'])}", f"Lowest {fmt_pkr(s['min_balance_paisa'])} on {s['min_balance_date']}"]
        ev += [f"{c['date']}: {c['label']} {fmt_pkr(c['amount_paisa'])}" for c in contributors]
        if s["shortage_date"]:
            en = (f"Your risk is {s['shortage_risk']} because large payments arrive before enough money comes in: "
                  + "; ".join(f"{c['label']} {fmt_pkr(-c['amount_paisa'])} on {c['date']}" for c in contributors[:3])
                  + f". The projected balance falls to {fmt_pkr(s['min_balance_paisa'])} on {s['min_balance_date']}.")
        else:
            en = (f"Your shortage risk is {s['shortage_risk']}. The lowest projected balance is {fmt_pkr(s['min_balance_paisa'])} "
                  f"on {s['min_balance_date']}.")
        rs = receivables_summary(snap, today)
        if rs["overdue_paisa"]:
            ev.append(f"Overdue receivables {fmt_pkr(rs['overdue_paisa'])}")
            en += f" Also, {fmt_pkr(rs['overdue_paisa'])} owed by customers is overdue."
        return _reply("why_risk", lang, en, urdu_shortage_reason(s, contributors), ev,
                      {"summary": s}, links=["/alerts", "/forecast"])

    if intent == "explain_dashboard":
        b = account_balances(snap, today)
        p = period_summary(snap, today - timedelta(days=29), today)
        overdue = sorted([r for r in snap.receivables if r.outstanding and r.due_on < today], key=lambda r: -r.outstanding)
        top_overdue = (overdue[0].customer_name, overdue[0].outstanding) if overdue else None
        ev = [f"Balance {fmt_pkr(b['total'])}", f"30-day revenue {fmt_pkr(p.revenue)}", f"30-day expenses {fmt_pkr(p.expenses)}",
              f"Estimated profit {fmt_pkr(p.profit)}", f"Lowest projected {fmt_pkr(s['min_balance_paisa'])} on {s['min_balance_date']}"]
        en = (f"Today you have {fmt_pkr(b['total'])}. In the last 30 days revenue was {fmt_pkr(p.revenue)} and expenses "
              f"{fmt_pkr(p.expenses)}, so estimated profit is {fmt_pkr(p.profit)}. "
              + (f"The forecast shows cash may run short on {s['shortage_date']} (lowest {fmt_pkr(s['min_balance_paisa'])})."
                 if s["shortage_date"] else f"No shortage is projected; the lowest point is {fmt_pkr(s['min_balance_paisa'])}.")
              + (f" Start by collecting {fmt_pkr(top_overdue[1])} from {top_overdue[0]}." if top_overdue else ""))
        return _reply("explain_dashboard", lang, en,
                      urdu_dashboard_summary(b["total"], p.revenue, p.expenses, p.profit, s, top_overdue), ev,
                      {"summary": s}, links=["/dashboard"])

    return _reply("unknown", lang,
                  "I couldn't match that to your records. Try: 'Can I afford Rs. 50,000 next week?', 'Why is my cash-flow risk high?', "
                  "'Which invoices should I follow up first?', 'What happens if sales decrease by 20%?', "
                  "'How much cash remains after supplier payments?', 'Compare recovery strategies', or 'Explain my dashboard in Urdu'.",
                  "یہ سوال آپ کے ریکارڈ سے نہیں ملا۔ مثلاً پوچھیں: 'کیا میں اگلے ہفتے 50,000 خرچ کر سکتا ہوں؟' یا 'میرا ڈیش بورڈ اردو میں سمجھاؤ'۔",
                  [], {})


def _reply(intent: str, lang: str, en: str, ur: str, evidence: list[str], data: dict, links: list[str] | None = None) -> dict:
    return {
        "intent": intent,
        "language": lang,
        "answer": isolate_ltr(ur) if lang == "ur" else en,
        "answer_en": en,
        "answer_ur": isolate_ltr(ur),
        "evidence": evidence,
        "data": data,
        "links": links or [],
        "grounded": True,
        "used_llm": False,
        "disclaimer": "Answers are calculated from your FinDost records and forecast assumptions. Decision support only.",
    }
