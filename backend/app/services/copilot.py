"""Financial Copilot (Module K).

Questions are understood by copilot_nlu (scored intents, parameters, follow-ups) and answered by
tools that call the same engine functions the dashboard uses. Every answer is built from computed
evidence, which is returned alongside it. Missing data is said plainly; questions outside the
records get an explicit "I can't answer that from your records"; ambiguous ones get a specific
clarifying question. An LLM, if enabled with consent, may help interpret a question or rephrase
an answer, but never produces the figures.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Callable

from ..money import fmt_pkr
from .copilot_nlu import (CONFIDENT, PARAM_KEYS, TOOL_INTENTS, URDU_SCRIPT, Understanding, is_out_of_scope,
                          language_of, parse_amount, parse_day, relevant_params, understand)
from .forecast import run_forecast
from .i18n import GLOSSARY, isolate_ltr, urdu_affordability, urdu_dashboard_summary, urdu_shortage_reason
from .ledger import account_balances, payables_summary, period_summary, receivables_summary
from .recovery import recommend
from .simulation import simulate
from .snapshot import Snapshot

log = logging.getLogger("findost.copilot")

ROMAN_URDU = re.compile(r"\b(kya|kitna|kitne|kitni|hai|hain|mein|mera|meri|mujhe|paise|kharch|khatra|kyun|bach|"
                        r"wasool|karun|karoon|sakta|sakti|agle|hafte|batao|samjhao|agar|kam|ho|jayein|hoga|asar|"
                        r"pichlay|mahine|kharchay|barhay|ke|ka|ki|par|se)\b", re.I)

# One canonical question per tool, used for suggestions and clarifications.
EXAMPLES = {
    "balance": "How much cash will I have next week?",
    "why_risk": "Why is my cash flow getting worse?",
    "follow_up": "Which customers owe me money, and who should I contact first?",
    "overdue": "Which payments are overdue?",
    "expense_compare": "Compare my expenses with last month",
    "spending": "Where am I spending the most?",
    "upcoming_expense": "What is my biggest upcoming payment?",
    "after_suppliers": "How much cash remains after supplier payments?",
    "sales_decline": "What happens if sales drop 20%?",
    "delayed_collection": "What if my customers pay 2 weeks late?",
    "scenario": "What if sales fall 20% and customers pay 2 weeks late?",
    "compare": "Compare recovery strategies",
    "affordability": "Can I afford Rs. 50,000 next week?",
    "explain_dashboard": "Explain my dashboard",
    "performance": "What was my profit in the last 30 days?",
}
CAPABILITIES_EN = ("cash balance and forecasts, why cash is at risk, who owes you and whom to contact first, overdue "
                   "payments, expense comparisons, upcoming bills, supplier payment impact, sales-drop and late-payment "
                   "scenarios, recovery strategies, affordability checks and your dashboard")
CAPABILITIES_UR = ("نقدی اور پیشگوئی، نقدی کے خطرے کی وجہ، ادھار وصولی، تاخیر والی ادائیگیاں، اخراجات کا موازنہ، آنے والے بل، "
                   "سپلائر ادائیگیوں کا اثر، فروخت میں کمی یا دیر سے وصولی کے اندازے، بحالی کی حکمت عملیاں، خریداری کی گنجائش اور ڈیش بورڈ")


def detect_language(text: str, preferred: str) -> str:
    return language_of(text, preferred)


def is_roman_urdu(text: str) -> bool:
    """Urdu written in Latin letters ("kitna cash bachega?"): at least two common Roman Urdu words."""
    return not URDU_SCRIPT.search(text) and len(ROMAN_URDU.findall(text)) >= 2


def parse_amount_from_text(text: str) -> int | None:
    return parse_amount(text)


def parse_day_from_text(text: str, today: date) -> int:
    return parse_day(text, today) or 7  # "next week" and default


def _find_party(snap: Snapshot, low: str) -> tuple[str, str, str] | None:
    """A customer or supplier named in the question (longest name wins)."""
    names = [("customer", i, n) for i, n in snap.customers.items()] + [("supplier", i, n) for i, n in snap.suppliers.items()]
    hits = [x for x in names if len(x[2]) >= 3 and x[2].lower() in low]
    return max(hits, key=lambda x: len(x[2])) if hits else None


@dataclass
class Ctx:
    snap: Snapshot
    today: date
    question: str
    low: str
    lang: str
    params: dict
    party: tuple[str, str, str] | None
    concepts: frozenset[str] = frozenset()
    _forecast: dict | None = None

    @property
    def forecast(self) -> dict:
        if self._forecast is None:
            self._forecast = run_forecast(self.snap, self.today, 30)
        return self._forecast

    @property
    def s(self) -> dict:
        return self.forecast["summary"]


def _has_records(snap: Snapshot) -> bool:
    return bool(snap.txs or snap.receivables or snap.payables)


# ------------------------------------------------------------------------------------------ tools

def t_glossary(c: Ctx) -> dict | None:
    for g in GLOSSARY:
        key = g["term"].lower().split(" ")[0]
        if key in c.low or g["urdu"].split(" ")[0] in c.question or ("udhaar" in c.low and "receivable" in key) \
                or (key == "cash" and re.search(r"cash ?flow", c.low)):
            return _reply("glossary", c.lang, f"{g['term']}: {g['simple']}", f"{g['urdu']}: {g['urdu_simple']}",
                          [], {"term": g["term"]})
    return None


def t_balance(c: Ctx) -> dict:
    s = c.s
    b = account_balances(c.snap, c.today)
    day = min(c.params.get("day") or 7, 30)
    at_day = next(pt["balance_paisa"] for pt in c.forecast["points"] if pt["day"] == day)
    when = (c.today + timedelta(days=day)).isoformat()
    ev = [f"Cash {fmt_pkr(b['cash'])}", f"Bank {fmt_pkr(b['bank'])}", f"Wallet {fmt_pkr(b['wallet'])}",
          f"Total {fmt_pkr(b['total'])}", f"Forecast in {day} days ({when}) {fmt_pkr(at_day)}"]
    en = (f"You have {fmt_pkr(b['total'])} in total today: cash {fmt_pkr(b['cash'])}, bank {fmt_pkr(b['bank'])}, "
          f"wallet {fmt_pkr(b['wallet'])}. In {day} days the forecast is about {fmt_pkr(at_day)}.")
    ur = (f"آج آپ کے پاس کل {fmt_pkr(b['total'])} ہیں: نقد {fmt_pkr(b['cash'])}، بینک {fmt_pkr(b['bank'])}، "
          f"والٹ {fmt_pkr(b['wallet'])}۔ {day} دن بعد اندازاً {fmt_pkr(at_day)} ہوں گے۔")
    if s["shortage_date"]:
        ev.append(f"Projected shortage from {s['shortage_date']}")
        en += f" Cash is projected to run short from {s['shortage_date']} (lowest {fmt_pkr(s['min_balance_paisa'])})."
        ur += f" {s['shortage_date']} سے نقدی کم پڑنے کا اندازہ ہے۔"
    return _reply("balance", c.lang, en, ur, ev, {"balances": b, "day": day, "forecast_balance_paisa": at_day},
                  links=["/dashboard", "/forecast"])


def t_why_risk(c: Ctx) -> dict:
    s, f = c.s, c.forecast
    contributors = f["contributors"][:4]
    trend = f.get("trend") or {}
    ev = [f"Today {fmt_pkr(s['opening_balance_paisa'])}", f"Lowest {fmt_pkr(s['min_balance_paisa'])} on {s['min_balance_date']}"]
    ev += [f"{x['date']}: {x['label']} {fmt_pkr(x['amount_paisa'])}" for x in contributors]
    if s["shortage_date"]:
        en = (f"Your shortage risk is {s['shortage_risk']} because large payments arrive before enough money comes in: "
              + "; ".join(f"{x['label']} {fmt_pkr(-x['amount_paisa'])} on {x['date']}" for x in contributors[:3] if x["amount_paisa"] < 0)
              + f". The projected balance falls to {fmt_pkr(s['min_balance_paisa'])} on {s['min_balance_date']} "
              f"(shortage from {s['shortage_date']}).")
    else:
        en = (f"Your shortage risk is {s['shortage_risk']}. No shortage is projected in the next 30 days; the lowest projected "
              f"balance is {fmt_pkr(s['min_balance_paisa'])} on {s['min_balance_date']}.")
    ur = urdu_shortage_reason(s, contributors)
    if trend:
        recent, prior = trend["recent_4w_net_paisa"], trend["prior_4w_net_paisa"]
        ev.append(f"Everyday net cash flow: last 4 weeks {fmt_pkr(recent)}, 4 weeks before {fmt_pkr(prior)} ({trend['direction']})")
        if trend["direction"] == "declining":
            worse = (f"Your everyday cash flow is getting worse: net {fmt_pkr(recent)} in the last 4 weeks versus "
                     f"{fmt_pkr(prior)} in the 4 weeks before.")
            en = f"{worse} {en}" if "worse" in c.concepts else f"{en} {worse}"
            ur += f" پچھلے 4 ہفتوں میں روزمرہ کا خالص بہاؤ {fmt_pkr(recent)} رہا، اس سے پہلے {fmt_pkr(prior)} تھا، یعنی کمی آئی ہے۔"
        else:
            steady = (f"Everyday net cash flow is {trend['direction']}: {fmt_pkr(recent)} in the last 4 weeks versus "
                      f"{fmt_pkr(prior)} before.")
            en = (f"Your everyday cash flow is not getting worse - it is {trend['direction']} ({fmt_pkr(recent)} in the last "
                  f"4 weeks versus {fmt_pkr(prior)} before). " + en) if "worse" in c.concepts else f"{en} {steady}"
    rs = receivables_summary(c.snap, c.today)
    if rs["overdue_paisa"]:
        ev.append(f"Overdue receivables {fmt_pkr(rs['overdue_paisa'])}")
        en += f" Also, {fmt_pkr(rs['overdue_paisa'])} owed by customers is overdue."
        ur += f" گاہکوں کے ذمے {fmt_pkr(rs['overdue_paisa'])} کی وصولی میں تاخیر ہے۔"
    return _reply("why_risk", c.lang, en, ur, ev, {"summary": s, "trend": trend}, links=["/alerts", "/forecast"])


def t_overdue(c: Ctx) -> dict:
    today = c.today
    late_in = sorted([r for r in c.snap.receivables if r.outstanding and r.due_on < today], key=lambda r: r.due_on)
    late_out = sorted([p for p in c.snap.payables if p.outstanding and p.due_on < today], key=lambda p: p.due_on)
    if not late_in and not late_out:
        return _reply("overdue", c.lang, "Nothing is overdue: no customer invoice or bill in your records is past its due date.",
                      "کوئی ادائیگی تاخیر میں نہیں: آپ کے ریکارڈ میں کوئی وصولی یا بل مقررہ تاریخ سے آگے نہیں۔", [], {})
    ev = [f"Owed to you: {r.customer_name} {r.reference or ''} {fmt_pkr(r.outstanding)}, {(today - r.due_on).days} days late"
          for r in late_in[:6]]
    ev += [f"You owe: {p.label} {fmt_pkr(p.outstanding)}, {(today - p.due_on).days} days late" for p in late_out[:6]]
    parts = []
    if late_in:
        parts.append(f"{len(late_in)} customer invoice(s) totalling {fmt_pkr(sum(r.outstanding for r in late_in))} are overdue "
                     f"(oldest: {late_in[0].customer_name}, {(today - late_in[0].due_on).days} days)")
    if late_out:
        parts.append(f"you have {len(late_out)} overdue bill(s) totalling {fmt_pkr(sum(p.outstanding for p in late_out))} "
                     f"(oldest: {late_out[0].label}, {(today - late_out[0].due_on).days} days)")
    joined = "; ".join(parts)
    en = joined[0].upper() + joined[1:] + "."
    ur = (f"{len(late_in)} وصولیاں ({fmt_pkr(sum(r.outstanding for r in late_in))}) اور {len(late_out)} بل "
          f"({fmt_pkr(sum(p.outstanding for p in late_out))}) تاخیر میں ہیں۔")
    return _reply("overdue", c.lang, en, ur, ev, {"receivable_ids": [r.id for r in late_in], "payable_ids": [p.id for p in late_out]},
                  links=["/transactions?tab=receivables", "/transactions?tab=payables"])


def t_upcoming_expense(c: Ctx) -> dict:
    outs = sorted([e for e in c.forecast["events"] if e["amount_paisa"] < 0 and e["kind"] in ("payable", "recurring_out")],
                  key=lambda e: e["amount_paisa"])
    if not outs:
        return _reply("upcoming_expense", c.lang,
                      "No recorded bills or detected monthly payments fall in the next 30 days. Everyday spending is in the forecast, "
                      "but no single large payment is scheduled.",
                      "اگلے 30 دن میں کوئی درج شدہ بڑا بل یا ماہانہ ادائیگی نہیں۔", [], {})
    top = outs[0]
    basis = "a recorded bill" if top["certainty"] == "recorded" else "estimated from your monthly pattern"
    ev = [f"{e['date']}: {e['label']} {fmt_pkr(-e['amount_paisa'])} ({e['certainty']})" for e in outs[:5]]
    en = f"Your biggest upcoming payment is {top['label']}: {fmt_pkr(-top['amount_paisa'])} on {top['date']} ({basis})."
    if len(outs) > 1:
        en += " The next largest: " + "; ".join(f"{e['label']} {fmt_pkr(-e['amount_paisa'])} on {e['date']}" for e in outs[1:3]) + "."
    ur = f"سب سے بڑی آنے والی ادائیگی {top['label']} ہے: {fmt_pkr(-top['amount_paisa'])}، تاریخ {top['date']}۔"
    return _reply("upcoming_expense", c.lang, en, ur, ev, {"events": outs[:5]}, links=["/forecast"])


def t_party(c: Ctx) -> dict:
    kind, pid, name = c.party  # type: ignore[misc]
    today = c.today
    if kind == "customer":
        recs = [r for r in c.snap.receivables if r.customer_id == pid]
        owed, paid = sum(r.outstanding for r in recs), sum(r.paid for r in recs)
        late = [r for r in recs if r.outstanding and r.due_on < today]
        ev = [f"{r.reference or r.issued_on.isoformat()}: {fmt_pkr(r.amount)} invoiced, {fmt_pkr(r.paid)} paid, "
              f"{fmt_pkr(r.outstanding)} open, due {r.due_on.isoformat()}" for r in recs[:8]]
        en = (f"{name} has {len(recs)} invoice(s): {fmt_pkr(sum(r.amount for r in recs))} invoiced, {fmt_pkr(paid)} paid so far "
              f"and {fmt_pkr(owed)} still owed" + (f", of which {fmt_pkr(sum(r.outstanding for r in late))} is overdue." if late else "."))
        ur = f"{name} نے اب تک {fmt_pkr(paid)} ادا کیے ہیں اور {fmt_pkr(owed)} باقی ہیں۔"
    else:
        pays = [p for p in c.snap.payables if p.supplier_id == pid]
        owed, paid = sum(p.outstanding for p in pays), sum(p.paid for p in pays)
        ev = [f"{p.reference or p.issued_on.isoformat()}: {fmt_pkr(p.amount)} billed, {fmt_pkr(p.paid)} paid, due {p.due_on.isoformat()}"
              for p in pays[:8]]
        en = f"You have paid {name} {fmt_pkr(paid)} against {len(pays)} bill(s) and still owe {fmt_pkr(owed)}."
        ur = f"آپ {name} کو {fmt_pkr(paid)} ادا کر چکے ہیں اور {fmt_pkr(owed)} باقی ہیں۔"
    return _reply("party", c.lang, en, ur, ev, {"party": {"type": kind, "id": pid, "name": name}},
                  links=["/transactions?tab=receivables" if kind == "customer" else "/transactions?tab=payables"])


def t_follow_up(c: Ctx) -> dict:
    today, s = c.today, c.s
    open_recs = [r for r in c.snap.receivables if r.outstanding > 0]
    if not open_recs:
        msg = ("You have no customer invoices (receivables) recorded, so there is nobody to follow up with."
               if not c.snap.receivables else "All customer invoices in your records are fully paid: nobody owes you money.")
        return _reply("follow_up", c.lang, msg, "آپ کے ریکارڈ میں کوئی باقی ادھار وصولی نہیں ہے۔", [],
                      {"missing": ["receivables"]} if not c.snap.receivables else {})
    ranked = sorted(open_recs, key=lambda r: -(r.outstanding * (1 + max((today - r.due_on).days, 0) / 30)))
    top = ranked[:5]
    total = sum(r.outstanding for r in open_recs)
    customers = len({r.customer_id for r in open_recs})
    ev = [f"{r.customer_name} {r.reference or ''}: {fmt_pkr(r.outstanding)}, "
          f"{'overdue ' + str((today - r.due_on).days) + ' days' if r.due_on < today else 'due ' + r.due_on.isoformat()}"
          for r in top]
    en = (f"{customers} customer(s) owe you {fmt_pkr(total)} in total. Contact them in this order (largest and most overdue first): "
          + "; ".join(f"{i + 1}. {r.customer_name} - {fmt_pkr(r.outstanding)}" for i, r in enumerate(top)) + ".")
    if s["shortage_date"]:
        en += f" Collecting before {s['shortage_date']} matters most because that is when cash is projected to run short."
    ur = (f"{customers} گاہکوں کے ذمے کل {fmt_pkr(total)} ہیں۔ اس ترتیب سے وصولی کریں: "
          + "، ".join(f"{r.customer_name} ({fmt_pkr(r.outstanding)})" for r in top) + "۔")
    return _reply("follow_up", c.lang, en, ur, ev, {"receivable_ids": [r.id for r in top], "total_owed_paisa": total},
                  links=["/transactions?tab=receivables"])


def t_after_suppliers(c: Ctx) -> dict:
    today = c.today
    horizon_end = today + timedelta(days=14)
    due = [p for p in c.snap.payables if p.outstanding > 0 and p.due_on <= horizon_end]
    if not due:
        upcoming = payables_summary(c.snap, today, 30)
        msg = ("No supplier bills or other payables are due in the next 14 days, so there is no scheduled supplier payment to "
               "measure." + (f" {fmt_pkr(upcoming['due_within_paisa'])} falls due within 30 days." if upcoming["due_within_paisa"] else ""))
        return _reply("after_suppliers", c.lang, msg, "اگلے 14 دن میں کسی سپلائر کی کوئی ادائیگی درج نہیں۔", [],
                      {"missing": ["payables"]} if not c.snap.payables else {}, links=["/transactions?tab=payables"])
    total = sum(p.outstanding for p in due)
    last_day = max(min(max((p.due_on - today).days for p in due), 30), 1)
    bal_after = next(pt["balance_paisa"] for pt in c.forecast["points"] if pt["day"] == last_day)
    ev = [f"{p.label}: {fmt_pkr(p.outstanding)} due {p.due_on.isoformat()}" for p in due[:8]]
    ev.append(f"Projected balance on day {last_day}: {fmt_pkr(bal_after)}")
    en = (f"{len(due)} scheduled payment(s) totalling {fmt_pkr(total)} are due in the next 14 days. After the last one "
          f"(day {last_day}), the projected balance is about {fmt_pkr(bal_after)}, including expected sales and collections.")
    ur = f"اگلے 14 دن میں {fmt_pkr(total)} کی ادائیگیاں ہیں۔ آخری ادائیگی کے بعد اندازاً {fmt_pkr(bal_after)} باقی رہیں گے۔"
    data = {"total_due_paisa": total, "balance_after_paisa": bal_after}
    # Impact of paying 14 days later, on the same engine (only bills not already overdue can realistically move).
    movable = [p.id for p in due if p.due_on >= today]
    if movable:
        sim = simulate(c.snap, today, [{"type": "defer_payables", "payable_ids": movable, "defer_days": 14}])
        cmp = sim["comparison"]
        ev.append(f"If these bills were paid 14 days later: lowest balance changes by {fmt_pkr(cmp['min_balance_change_paisa'])}")
        en += (f" Paying them 14 days later (if suppliers agree) would change your lowest projected balance by "
               f"{fmt_pkr(cmp['min_balance_change_paisa'])}"
               + (f" and remove the projected shortage." if cmp["removes_shortage"] else "."))
        ur += f" اگر یہ ادائیگیاں 14 دن بعد ہوں تو سب سے کم نقدی میں {fmt_pkr(cmp['min_balance_change_paisa'])} کا فرق آئے گا۔"
        data["defer_14_days"] = cmp
    return _reply("after_suppliers", c.lang, en, ur, ev, data, links=["/forecast", "/transactions?tab=payables"])


def t_compare(c: Ctx) -> dict:
    rec = recommend(c.snap, c.today, [], 30)
    top = rec["strategies"][:2]
    if len(top) < 2:
        return _reply("compare", c.lang,
                      "There are not enough recovery options for your data to compare yet: strategies need open invoices, "
                      "upcoming bills or regular spending to work with.",
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
    return _reply("compare", c.lang, en, ur, ev, {"strategy_ids": [a["id"], b["id"]]}, links=["/recovery"])


def t_spending(c: Ctx) -> dict:
    p = period_summary(c.snap, c.today - timedelta(days=29), c.today)
    total = sum(p.expense_by_category.values())
    top = list(p.expense_by_category.items())[:4]
    if not total:
        return _reply("spending", c.lang, "No expenses are recorded in the last 30 days, so I can't show where money is going.",
                      "پچھلے 30 دن میں کوئی خرچ درج نہیں۔", [], {"missing": ["expenses"]}, links=["/transactions"])
    ev = [f"{cat}: {fmt_pkr(a)} ({a / total * 100:.0f}%)" for cat, a in top]
    en = f"In the last 30 days you spent {fmt_pkr(total)}. Biggest categories: " + "; ".join(ev) + "."
    ur = f"پچھلے 30 دن میں کل خرچ {fmt_pkr(total)} رہا۔ سب سے بڑے خرچ: " + "، ".join(ev) + "۔"
    return _reply("spending", c.lang, en, ur, ev, {"categories": dict(top)}, links=["/reports"])


def t_expense_compare(c: Ctx) -> dict:
    """Last 30 days against the 30 days before, by category (dates stated so the windows are explicit)."""
    today = c.today
    r_start, p_end = today - timedelta(days=29), today - timedelta(days=30)
    p_start = today - timedelta(days=59)
    recent, prior = period_summary(c.snap, r_start, today), period_summary(c.snap, p_start, p_end)
    windows = f"{r_start.isoformat()} to {today.isoformat()} vs {p_start.isoformat()} to {p_end.isoformat()}"
    if not recent.expenses and not prior.expenses:
        return _reply("expense_compare", c.lang, "No expenses are recorded in the last 60 days, so there is nothing to compare.",
                      "پچھلے 60 دن میں کوئی خرچ درج نہیں، اس لیے موازنہ ممکن نہیں۔", [], {"missing": ["expenses"]},
                      links=["/transactions"])
    if not prior.expenses:
        return _reply("expense_compare", c.lang,
                      f"Your records have no expenses between {p_start.isoformat()} and {p_end.isoformat()}, so I can't compare "
                      f"with the previous month. In the last 30 days you spent {fmt_pkr(recent.expenses)}.",
                      f"پچھلے مہینے ({p_start.isoformat()} تا {p_end.isoformat()}) کا کوئی خرچ درج نہیں، اس لیے موازنہ ممکن نہیں۔",
                      [f"Last 30 days expenses {fmt_pkr(recent.expenses)}"], {"missing": ["previous period expenses"]},
                      links=["/reports"])
    change = recent.expenses - prior.expenses
    pct = change / prior.expenses * 100
    cats = set(recent.expense_by_category) | set(prior.expense_by_category)
    deltas = sorted(((cat, recent.expense_by_category.get(cat, 0) - prior.expense_by_category.get(cat, 0)) for cat in cats),
                    key=lambda kv: -kv[1])
    ups = [(cat, d) for cat, d in deltas if d > 0][:3]
    downs = [(cat, d) for cat, d in reversed(deltas) if d < 0][:2]
    ev = [f"Last 30 days {fmt_pkr(recent.expenses)}", f"Previous 30 days {fmt_pkr(prior.expenses)}", f"Windows: {windows}"]
    ev += [f"{cat}: {fmt_pkr(prior.expense_by_category.get(cat, 0))} -> {fmt_pkr(recent.expense_by_category.get(cat, 0))}"
           for cat, _ in ups + downs]
    direction = "up" if change > 0 else "down" if change < 0 else "unchanged"
    en = (f"Expenses in the last 30 days were {fmt_pkr(recent.expenses)} versus {fmt_pkr(prior.expenses)} in the 30 days before"
          + (f", {direction} {fmt_pkr(abs(change))} ({abs(pct):.0f}%)." if change else ", unchanged."))
    ur = f"پچھلے 30 دن کے اخراجات {fmt_pkr(recent.expenses)} رہے جبکہ اس سے پہلے کے 30 دن میں {fmt_pkr(prior.expenses)} تھے"
    ur += (f"، یعنی {fmt_pkr(abs(change))} {'زیادہ' if change > 0 else 'کم'}۔" if change else "۔")
    asked_up = "increase" in c.concepts and "decline" not in c.concepts
    asked_down = "decline" in c.concepts and "increase" not in c.concepts
    if (asked_up and change <= 0) or (asked_down and change >= 0):
        en = f"Overall your expenses did not {'rise' if asked_up else 'fall'}. " + en
        ur = ("مجموعی طور پر آپ کے اخراجات بڑھے نہیں بلکہ کم ہوئے ہیں۔ " if asked_up
              else "مجموعی طور پر آپ کے اخراجات کم نہیں ہوئے بلکہ بڑھے ہیں۔ ") + ur
    if ups:
        en += (" Some categories did rise: " if asked_up and change <= 0 else " The biggest increases: ") + "; ".join(f"{cat} +{fmt_pkr(d)}" for cat, d in ups) + "."
        ur += " سب سے زیادہ اضافہ: " + "، ".join(f"{cat} ({fmt_pkr(d)})" for cat, d in ups) + "۔"
    if downs:
        en += " Lower: " + "; ".join(f"{cat} -{fmt_pkr(-d)}" for cat, d in downs) + "."
    return _reply("expense_compare", c.lang, en, ur, ev,
                  {"recent_paisa": recent.expenses, "prior_paisa": prior.expenses, "change_paisa": change,
                   "increases": dict(ups), "decreases": dict(downs), "windows": windows}, links=["/reports"])


def t_performance(c: Ctx) -> dict:
    today = c.today
    if re.search(r"\blast month\b|\bprevious month\b|\bpichl|پچھل|گزشتہ", c.low):
        end = today.replace(day=1) - timedelta(days=1)
        start, label = end.replace(day=1), "last month"
    elif re.search(r"\bthis month\b|\bis mahine\b|اس مہینے", c.low):
        start, end, label = today.replace(day=1), today, "this month so far"
    else:
        start, end, label = today - timedelta(days=29), today, "the last 30 days"
    p = period_summary(c.snap, start, end)
    span = f"{start.isoformat()} to {end.isoformat()}"
    if not p.revenue and not p.expenses:
        return _reply("performance", c.lang, f"No sales or expenses are recorded for {label} ({span}).",
                      f"اس مدت ({span}) میں کوئی فروخت یا خرچ درج نہیں۔", [], {"missing": ["transactions"]},
                      links=["/transactions"])
    margin = f" ({p.profit / p.revenue * 100:.0f}% of sales)" if p.revenue else ""
    ev = [f"Period {span}", f"Revenue {fmt_pkr(p.revenue)} (cash {fmt_pkr(p.cash_revenue)}, credit {fmt_pkr(p.credit_revenue)})",
          f"Expenses {fmt_pkr(p.expenses)}", f"Estimated profit {fmt_pkr(p.profit)}"]
    en = (f"For {label} ({span}): sales {fmt_pkr(p.revenue)}, expenses {fmt_pkr(p.expenses)}, estimated profit "
          f"{fmt_pkr(p.profit)}{margin}. Stock purchases count as expenses when bought, so this is an estimate.")
    if p.credit_revenue:
        en += f" {fmt_pkr(p.credit_revenue)} of those sales were on credit and are not cash yet."
    ur = (f"اس مدت ({span}) میں فروخت {fmt_pkr(p.revenue)}، اخراجات {fmt_pkr(p.expenses)} اور اندازاً منافع "
          f"{fmt_pkr(p.profit)} رہا۔")
    return _reply("performance", c.lang, en, ur, ev,
                  {"revenue_paisa": p.revenue, "expenses_paisa": p.expenses, "profit_paisa": p.profit, "period": span},
                  links=["/reports"])


def t_explain_dashboard(c: Ctx) -> dict:
    s, today = c.s, c.today
    b = account_balances(c.snap, today)
    p = period_summary(c.snap, today - timedelta(days=29), today)
    overdue = sorted([r for r in c.snap.receivables if r.outstanding and r.due_on < today], key=lambda r: -r.outstanding)
    top_overdue = (overdue[0].customer_name, overdue[0].outstanding) if overdue else None
    ev = [f"Balance {fmt_pkr(b['total'])}", f"30-day revenue {fmt_pkr(p.revenue)}", f"30-day expenses {fmt_pkr(p.expenses)}",
          f"Estimated profit {fmt_pkr(p.profit)}", f"Lowest projected {fmt_pkr(s['min_balance_paisa'])} on {s['min_balance_date']}"]
    en = (f"Today you have {fmt_pkr(b['total'])}. In the last 30 days revenue was {fmt_pkr(p.revenue)} and expenses "
          f"{fmt_pkr(p.expenses)}, so estimated profit is {fmt_pkr(p.profit)}. "
          + (f"The forecast shows cash may run short on {s['shortage_date']} (lowest {fmt_pkr(s['min_balance_paisa'])})."
             if s["shortage_date"] else f"No shortage is projected; the lowest point is {fmt_pkr(s['min_balance_paisa'])}.")
          + (f" Start by collecting {fmt_pkr(top_overdue[1])} from {top_overdue[0]}." if top_overdue else ""))
    return _reply("explain_dashboard", c.lang, en,
                  urdu_dashboard_summary(b["total"], p.revenue, p.expenses, p.profit, s, top_overdue), ev,
                  {"summary": s}, links=["/dashboard"])


def t_affordability(c: Ctx) -> dict:
    amount = c.params.get("amount_paisa")
    day = min(c.params.get("day") or 7, 30)
    if not amount:
        return _clarification(c.lang, "affordability", {"day": c.params.get("day")} if c.params.get("day") else {},
                              "How much is the payment? Tell me the amount (and when, if not next week), for example "
                              "'Rs. 50,000' or 'Can I afford Rs. 50,000 next week?'",
                              "ادائیگی کی رقم بتائیں، مثلاً '50,000 روپے' یا 'کیا میں اگلے ہفتے 50,000 روپے خرچ کر سکتا ہوں؟'",
                              ["Rs. 25,000", "Rs. 50,000", "Can I afford Rs. 1 lakh next month?"])
    s = c.s
    sim = simulate(c.snap, c.today, [{"type": "unexpected_expense", "amount_paisa": amount, "day": day,
                                      "label": "Planned payment"}])
    after = sim["scenario"]["summary"]
    ok = after["shortage_date"] is None
    ev = [f"Payment {fmt_pkr(amount)} on day {day} ({(c.today + timedelta(days=day)).isoformat()})",
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
            en += f" Note: a shortage is already projected on {s['shortage_date']} even without this payment."
    return _reply("affordability", c.lang, en,
                  urdu_affordability(amount, day, ok, after["min_balance_paisa"], after["min_balance_date"]), ev,
                  {"affordable": ok, "amount_paisa": amount, "day": day, "scenario": after}, links=["/simulator"])


def _sales_in_last_60_days(c: Ctx) -> int:
    start = c.today - timedelta(days=59)
    return sum(t.amount for t in c.snap.txs if start <= t.occurred_on <= c.today and t.kind in ("income", "credit_sale"))


def _delay_targets(c: Ctx) -> tuple[list, str]:
    """Which open invoices a 'customer pays late' scenario moves: a named customer, all of them, or the largest."""
    open_recs = sorted([r for r in c.snap.receivables if r.outstanding > 0], key=lambda r: -r.outstanding)
    if c.party and c.party[0] == "customer":
        chosen = [r for r in open_recs if r.customer_id == c.party[1]]
        return chosen, f"{c.party[2]}'s open invoices"
    if re.search(r"\bcustomers\b|\ball\b|\beveryone\b|\bsab\b|\bclients\b|گاہکوں", c.low):
        return open_recs, "all open customer invoices"
    if re.search(r"\b(a|my|one|ek|the) (customer|client|gahak)\b|\bcustomer\b", c.low) and open_recs:
        return open_recs[:1], f"your largest open invoice ({open_recs[0].customer_name}, {fmt_pkr(open_recs[0].outstanding)})"
    return open_recs[:3], "your 3 largest open customer invoices"


def t_scenario(c: Ctx, intent: str) -> dict:
    want_sales = intent in ("sales_decline", "scenario")
    want_delay = intent in ("delayed_collection", "scenario")
    adjustments, assumptions, ev, missing = [], [], [], []
    pct = c.params.get("percent")
    delay = c.params.get("delay_days")
    if want_sales:
        if pct is None:
            pct = 20
            assumptions.append("you didn't give a size, so I used a 20% drop")
        if not _sales_in_last_60_days(c):
            missing.append("sales")
        adjustments.append({"type": "sales_decline", "percent": pct, "start_day": 1, "duration_days": 30})
        ev.append(f"Sales -{pct}% for 30 days")
    targets, who = ([], "")
    if want_delay:
        if delay is None:
            delay = 30
            assumptions.append("you didn't say how late, so I used 30 days")
        targets, who = _delay_targets(c)
        if not targets:
            missing.append("receivables")
        else:
            adjustments.append({"type": "delayed_payment", "receivable_ids": [r.id for r in targets], "delay_days": delay})
            ev.append(f"{who} ({fmt_pkr(sum(r.outstanding for r in targets))}) paid {delay} days late")
    if missing and not adjustments or (missing == ["sales"] and intent == "sales_decline"):
        what = {"sales": "no sales are recorded in the last 60 days", "receivables": "no customer invoices are open"}
        en = ("I can't run that scenario on your records: " + " and ".join(what[m] for m in missing)
              + ". Add sales or customer invoices first (Transactions page or CSV import).")
        return _reply(intent, c.lang, en, "اس اندازے کے لیے ریکارڈ میں فروخت یا ادھار موجود نہیں۔", [],
                      {"missing": missing}, links=["/transactions"])
    s = c.s
    sim = simulate(c.snap, c.today, adjustments)
    cmp, after = sim["comparison"], sim["scenario"]["summary"]
    ev += [f"Baseline lowest balance {fmt_pkr(s['min_balance_paisa'])} on {s['min_balance_date']}",
           f"Scenario lowest balance {fmt_pkr(after['min_balance_paisa'])} on {after['min_balance_date']}",
           f"Balance after 30 days changes by {fmt_pkr(cmp['end_balance_change_paisa'])}"]
    parts = []
    if want_sales:
        parts.append(f"sales fall {pct}% for the next 30 days")
    if want_delay and targets:
        parts.append(f"{who} {'is' if len(targets) == 1 else 'are'} paid {delay} days late")
    en = (f"If {' and '.join(parts)}, the lowest projected balance moves from {fmt_pkr(s['min_balance_paisa'])} to "
          f"{fmt_pkr(after['min_balance_paisa'])} (on {after['min_balance_date']}) and cash after 30 days is "
          f"{fmt_pkr(abs(cmp['end_balance_change_paisa']))} {'lower' if cmp['end_balance_change_paisa'] <= 0 else 'higher'}. "
          + (f"A shortage would start on {after['shortage_date']}" + (f" (baseline: {s['shortage_date']})." if s["shortage_date"] else ".")
             if after["shortage_date"] else "No shortage is projected."))
    if want_delay and targets and not want_sales and cmp["end_balance_change_paisa"] == 0:
        en += " The money still arrives within the 30-day window, so the end balance is the same; the timing is what changes."
    if missing:
        en += " Note: " + " and ".join({"sales": "no recent sales are recorded, so a sales drop changes nothing",
                                         "receivables": "no customer invoices are open, so late payments change nothing"}[m]
                                        for m in missing) + "."
    if assumptions:
        en += " (" + "; ".join(assumptions).capitalize() + ".)"
    ur_parts = []
    if want_sales:
        ur_parts.append(f"اگلے 30 دن فروخت {pct}% کم ہو")
    if want_delay and targets:
        ur_parts.append(f"گاہک {delay} دن دیر سے ادائیگی کریں")
    ur = (f"اگر {' اور '.join(ur_parts)} تو سب سے کم نقدی {fmt_pkr(after['min_balance_paisa'])} ہو سکتی ہے، "
          f"اور 30 دن بعد نقدی میں {fmt_pkr(abs(cmp['end_balance_change_paisa']))} کا فرق ہوگا۔"
          + (f" نقدی کی کمی {after['shortage_date']} سے شروع ہو سکتی ہے۔" if after["shortage_date"] else "") + " یہ صرف اندازہ ہے۔")
    return _reply(intent, c.lang, en, ur, ev,
                  {"comparison": cmp, "scenario": after, "adjustments": adjustments, "percent": pct if want_sales else None,
                   "delay_days": delay if want_delay else None}, links=["/simulator"])


TOOLS: dict[str, Callable[[Ctx], dict | None]] = {
    "glossary": t_glossary, "balance": t_balance, "why_risk": t_why_risk, "overdue": t_overdue,
    "upcoming_expense": t_upcoming_expense, "party": t_party, "follow_up": t_follow_up,
    "after_suppliers": t_after_suppliers, "compare": t_compare, "spending": t_spending,
    "expense_compare": t_expense_compare, "performance": t_performance, "explain_dashboard": t_explain_dashboard,
    "affordability": t_affordability,
    "sales_decline": lambda c: t_scenario(c, "sales_decline"),
    "delayed_collection": lambda c: t_scenario(c, "delayed_collection"),
    "scenario": lambda c: t_scenario(c, "scenario"),
}
assert set(TOOLS) == set(TOOL_INTENTS)

NO_RECORDS_NEEDED = {"glossary"}


# ------------------------------------------------------------------------------------------ entry point

def answer(snap: Snapshot, today: date, question: str, language: str = "en",
           kind_features: frozenset[str] = frozenset(), context: dict | None = None,
           override: dict | None = None) -> dict:
    """Answer one question. `context` is the previous turn's {intent, params, pending} (echoed by the client and
    re-validated); `override` is an already-interpreted {intent, params} (e.g. from the LLM interpreter)."""
    question = question.strip()
    lang = detect_language(question, language)
    low = question.lower()
    if override and override.get("intent") in TOOL_INTENTS:
        params = {k: v for k, v in (override.get("params") or {}).items() if k in PARAM_KEYS and v is not None}
        u = Understanding(override["intent"], CONFIDENT, params)
    else:
        u = understand(question, today, context)
    if u.language_only:
        lang = "ur"
    if u.score < CONFIDENT and not u.followup and is_out_of_scope(question):
        return _reply("out_of_scope", lang,
                      "I can only answer from your FinDost records (cash, sales, expenses, customers, suppliers, "
                      "forecasts and scenarios). Your records don't contain information to answer that.",
                      "میں صرف آپ کے FinDost ریکارڈ سے جواب دے سکتا ہوں۔ اس سوال کا جواب آپ کے ریکارڈ میں موجود نہیں۔",
                      [], {}, suggestions=[EXAMPLES["balance"], EXAMPLES["why_risk"]])

    intent = u.intent
    party = _find_party(snap, low)
    if party and intent in ("unknown", "clarify", "follow_up", "spending", "balance", "overdue", "after_suppliers"):
        intent = "party"

    if intent == "clarify":
        _log_unmatched("clarify", question, lang, u)
        return _clarify(lang, u)
    if intent == "unknown":
        _log_unmatched("unknown", question, lang, u)
        return _unknown(lang, u)

    if intent not in NO_RECORDS_NEEDED and not _has_records(snap):
        what = EXAMPLES.get(intent, "that").rstrip("?").lower()
        return _reply(intent, lang,
                      f"You haven't added any transactions, customer invoices or bills yet, so I can't calculate "
                      f"\"{what}\" from your records. Add transactions or import a bank/ledger CSV and ask again.",
                      "آپ نے ابھی تک کوئی لین دین، ادھار یا بل درج نہیں کیا، اس لیے یہ حساب ممکن نہیں۔ "
                      "پہلے لین دین درج کریں یا CSV امپورٹ کریں۔",
                      [], {"missing": ["transactions", "receivables", "payables"]}, links=["/transactions", "/import"])

    c = Ctx(snap, today, question, low, lang, dict(u.params), party, u.concepts)
    try:
        result = TOOLS[intent](c)
    except Exception as exc:  # never leak internals or data; log type and intent only
        log.error("copilot tool %s failed: %s", intent, type(exc).__name__, exc_info=True)
        result = _reply("error", lang, "I couldn't calculate that just now. Your records are unchanged; please try again, "
                        "or use the Forecast and Simulator pages directly.",
                        "یہ حساب ابھی نہیں ہو سکا۔ آپ کا ریکارڈ محفوظ ہے، دوبارہ کوشش کریں۔", [], {})
    if result is None:  # glossary term not found
        return _unknown(lang, u)
    if not result.get("needs_clarification"):
        params = relevant_params(intent, u.params)
        if intent in ("sales_decline", "scenario", "delayed_collection"):
            params.update({k: result["data"][k] for k in ("percent", "delay_days") if result["data"].get(k)})
        result["context"] = {"intent": intent if intent != "party" else None, "params": params, "pending": False}
    result["followup"] = u.followup
    result["interpreted_by"] = "context" if u.followup else "rules"
    return result


def _log_unmatched(kind: str, question: str, lang: str, u: Understanding) -> None:
    """Enough to improve routing, nothing that identifies the user: no question text, amounts or names."""
    log.info("copilot %s: lang=%s chars=%d concepts=%s candidates=%s", kind, lang, len(question),
             sorted(u.concepts), [(i, round(s, 1)) for i, s in u.candidates])


CLARIFY = {
    "sales_decline": ("Do you mean a drop in your sales? Tell me by how much, for example 'What if sales drop {p}%?'",
                      "کیا آپ فروخت میں کمی کی بات کر رہے ہیں؟ بتائیں کتنی، مثلاً 'اگر فروخت {p}% کم ہو جائے؟'",
                      ["What if sales drop {p}%?", "What if customers pay 2 weeks late?"]),
    "delayed_collection": ("Do you mean customers paying you late? Tell me how late, for example 'What if customers pay 2 weeks late?'",
                           "کیا آپ گاہکوں کی دیر سے ادائیگی کی بات کر رہے ہیں؟ بتائیں کتنی دیر۔",
                           ["What if customers pay 2 weeks late?", "Which customers owe me money?"]),
    "balance": ("Do you want today's cash balance or the forecast for a later date?",
                "آج کی نقدی یا آئندہ کی پیشگوئی؟", ["How much cash do I have?", "How much cash will I have next week?"]),
    "why_risk": ("Do you want to know why your cash risk is high, or when cash could run short?",
                 "کیا آپ نقدی کے خطرے کی وجہ جاننا چاہتے ہیں؟", ["Why is my cash-flow risk high?", "When could I run out of money?"]),
    "spending": ("Do you want your biggest expense categories, or a comparison with last month?",
                 "سب سے بڑے اخراجات یا پچھلے مہینے سے موازنہ؟", ["Where am I spending the most?", "Compare my expenses with last month"]),
    "follow_up": ("Do you want the list of customers who owe you, in the order to contact them?",
                  "کیا آپ ادھار والے گاہکوں کی فہرست چاہتے ہیں؟", ["Which customers owe me money?", "Which payments are overdue?"]),
    "after_suppliers": ("Do you want to see your cash after the supplier bills due in the next 14 days?",
                        "کیا آپ اگلے 14 دن کی سپلائر ادائیگیوں کے بعد کی نقدی دیکھنا چاہتے ہیں؟",
                        ["How much cash remains after supplier payments?", "What is my biggest upcoming payment?"]),
}


def _clarify(lang: str, u: Understanding) -> dict:
    target = u.clarify_for or "unknown"
    pct = u.params.get("percent") or 10
    if target in CLARIFY:
        en, ur, sugg = CLARIFY[target]
        en, ur = en.format(p=pct), ur.format(p=pct)
        sugg = [x.format(p=pct) for x in sugg]
    else:
        en = f"Did you mean: '{EXAMPLES.get(target, EXAMPLES['explain_dashboard'])}'? Reply 'yes', or ask it another way."
        ur = "کیا آپ کا مطلب یہ تھا؟ 'ہاں' لکھیں یا سوال دوسرے الفاظ میں پوچھیں۔"
        sugg = [EXAMPLES[i] for i, _ in u.candidates if i in EXAMPLES][:3]
    params = relevant_params(target, u.params)
    return _clarification(lang, target if target in TOOL_INTENTS else None, params, en, ur, sugg)


def _unknown(lang: str, u: Understanding) -> dict:
    close = [EXAMPLES[i] for i, _ in u.candidates if i in EXAMPLES][:2]
    sugg = close + [q for q in (EXAMPLES["balance"], EXAMPLES["why_risk"], EXAMPLES["follow_up"], EXAMPLES["sales_decline"],
                                EXAMPLES["affordability"]) if q not in close]
    en = ("I couldn't match that to something I can calculate from your records. I can answer questions about "
          + CAPABILITIES_EN + ". For example: '" + sugg[0] + "'")
    ur = "یہ سوال آپ کے ریکارڈ سے نہیں ملا۔ میں ان موضوعات پر جواب دے سکتا ہوں: " + CAPABILITIES_UR + "۔"
    return _reply("unknown", lang, en, ur, [], {}, suggestions=sugg[:5])


def _clarification(lang: str, intent: str | None, params: dict, en: str, ur: str, suggestions: list[str]) -> dict:
    out = _reply("clarify", lang, en, ur, [], {"clarify_for": intent}, suggestions=suggestions)
    out["needs_clarification"] = True
    out["context"] = {"intent": intent, "params": params, "pending": True} if intent else None
    return out


def _reply(intent: str, lang: str, en: str, ur: str, evidence: list[str], data: dict, links: list[str] | None = None,
           suggestions: list[str] | None = None) -> dict:
    return {
        "intent": intent,
        "language": lang,
        "answer": isolate_ltr(ur) if lang == "ur" else en,
        "answer_en": en,
        "answer_ur": isolate_ltr(ur),
        "evidence": evidence,
        "data": data,
        "links": links or [],
        "suggestions": suggestions or [],
        "needs_clarification": False,
        "context": None,
        "grounded": True,
        "used_llm": False,
        "disclaimer": "Answers are calculated from your FinDost records and forecast assumptions. Decision support only.",
    }
