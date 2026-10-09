"""Curated Urdu templates and a plain-language glossary (Module L).

Figures are inserted exactly as computed ("Rs. 12,500", Western digits) so
translation can never change their meaning.
"""
from __future__ import annotations

from ..money import fmt_pkr

GLOSSARY = [
    {
        "term": "Cash flow", "urdu": "نقدی کا بہاؤ",
        "simple": "Money coming in (sales, payments received) and going out (purchases, bills) over time.",
        "urdu_simple": "وقت کے ساتھ آنے والی رقم (فروخت، وصولیاں) اور جانے والی رقم (خریداری، بل)۔",
    },
    {
        "term": "Profit", "urdu": "منافع",
        "simple": "Sales minus costs. You can be profitable and still run out of cash if customers pay late.",
        "urdu_simple": "فروخت میں سے اخراجات نکال کر جو بچے۔ منافع کے باوجود اگر گاہک دیر سے ادائیگی کریں تو نقدی ختم ہو سکتی ہے۔",
    },
    {
        "term": "Receivable (udhaar given)", "urdu": "وصولی (دیا ہوا ادھار)",
        "simple": "Money customers owe you for goods they took on credit. It is yours, but it is not cash yet.",
        "urdu_simple": "وہ رقم جو گاہکوں نے ادھار مال لے کر آپ کو دینی ہے۔ یہ آپ کی ہے مگر ابھی نقد نہیں۔",
    },
    {
        "term": "Payable", "urdu": "واجب الادا رقم",
        "simple": "Money you owe suppliers, landlords or others, with a due date.",
        "urdu_simple": "وہ رقم جو آپ نے سپلائر، مالک مکان یا کسی اور کو ایک مقررہ تاریخ تک دینی ہے۔",
    },
    {
        "term": "Cash reserve", "urdu": "محفوظ رقم",
        "simple": "A minimum amount you want to always keep for emergencies.",
        "urdu_simple": "وہ کم از کم رقم جو آپ ہنگامی حالات کے لیے ہمیشہ پاس رکھنا چاہتے ہیں۔",
    },
    {
        "term": "Forecast", "urdu": "پیشگوئی (اندازہ)",
        "simple": "An estimate of future cash based on your records and stated assumptions. Not a guarantee.",
        "urdu_simple": "آپ کے ریکارڈ اور بتائے گئے مفروضوں کی بنیاد پر آئندہ نقدی کا اندازہ۔ یہ ضمانت نہیں۔",
    },
    {
        "term": "Cash shortage", "urdu": "نقدی کی کمی",
        "simple": "A day when projected cash falls below zero, so bills could not all be paid.",
        "urdu_simple": "وہ دن جب اندازے کے مطابق نقدی صفر سے کم ہو جائے اور سارے بل ادا نہ ہو سکیں۔",
    },
    {
        "term": "Risk", "urdu": "خطرہ",
        "simple": "Something that could hurt your cash position. FinDost ranks risks by urgency, not probability.",
        "urdu_simple": "کوئی بات جو آپ کی نقدی کو نقصان پہنچا سکے۔ FinDost خطرات کو فوری اہمیت کے لحاظ سے ترتیب دیتا ہے، امکان کے لحاظ سے نہیں۔",
    },
]


def urdu_dashboard_summary(balance: int, revenue: int, expenses: int, profit: int, summary: dict,
                           top_overdue: tuple[str, int] | None) -> str:
    lines = [
        f"آج آپ کے پاس کل نقد رقم {fmt_pkr(balance)} ہے۔",
        f"پچھلے 30 دن میں آمدنی {fmt_pkr(revenue)} اور اخراجات {fmt_pkr(expenses)} رہے، "
        f"یعنی اندازاً منافع {fmt_pkr(profit)} ہے۔",
    ]
    if summary.get("shortage_date"):
        lines.append(
            f"پیشگوئی کے مطابق {summary['shortage_date']} کو نقدی ختم ہو سکتی ہے۔ "
            f"سب سے کم سطح {fmt_pkr(summary['min_balance_paisa'])} ہوگی ({summary['min_balance_date']})۔"
        )
    else:
        lines.append(
            f"اگلے دنوں میں نقدی کی کمی کا اندازہ نہیں ہے۔ سب سے کم سطح {fmt_pkr(summary['min_balance_paisa'])} ہوگی۔"
        )
    if top_overdue:
        lines.append(f"سب سے پہلے {top_overdue[0]} سے {fmt_pkr(top_overdue[1])} کی وصولی کی کوشش کریں۔")
    lines.append("یہ اندازے آپ کے ریکارڈ پر مبنی ہیں، ضمانت نہیں۔")
    return " ".join(lines)


def urdu_shortage_reason(summary: dict, contributors: list[dict]) -> str:
    if not summary.get("shortage_date"):
        return (f"فی الحال نقدی کی کمی کا خطرہ کم ہے۔ سب سے کم متوقع رقم {fmt_pkr(summary['min_balance_paisa'])} "
                f"({summary['min_balance_date']}) ہے۔")
    items = "، ".join(f"{c['label']} ({fmt_pkr(-c['amount_paisa'])})" for c in contributors[:3])
    return (f"خطرہ اس لیے زیادہ ہے کہ {summary['shortage_date']} سے پہلے بڑی ادائیگیاں آ رہی ہیں: {items}۔ "
            f"اس دوران آنے والی رقم کم ہے، اس لیے نقدی {fmt_pkr(summary['min_balance_paisa'])} تک گر سکتی ہے۔")


def urdu_affordability(amount: int, day: int, ok: bool, min_after: int, min_date: str) -> str:
    if ok:
        return (f"جی ہاں، {day} دن بعد {fmt_pkr(amount)} کی خریداری کے بعد بھی سب سے کم نقدی "
                f"{fmt_pkr(min_after)} ({min_date}) رہنے کا اندازہ ہے۔")
    return (f"احتیاط کریں: {fmt_pkr(amount)} خرچ کرنے سے نقدی {fmt_pkr(min_after)} ({min_date}) تک گر سکتی ہے، "
            f"یعنی کمی ہو جائے گی۔")
