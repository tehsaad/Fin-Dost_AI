"""CSV ingestion: detect format -> map columns -> normalize -> validate -> preview.

The pipeline is adapter-based so new sources (a specific bank's statement, a
JazzCash/Easypaisa export, accounting software) can be added by registering
another adapter with its header synonyms and defaults, without touching the
normalization, validation or import steps.

Nothing is written to the ledger until the user confirms a preview.
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from ..money import parse_amount
from .categories import categorize

MAX_ROWS = 5000
MAX_COLUMNS = 40
MAX_CELL = 500

FIELDS = ("date", "amount", "debit", "credit", "type", "description", "category", "account", "party",
          "due_date", "reference")
SYNONYMS: dict[str, tuple[str, ...]] = {
    "date": ("date", "transaction date", "txn date", "value date", "posting date", "tarikh", "booking date"),
    "amount": ("amount", "amount (pkr)", "amount pkr", "rs", "rupees", "raqam", "value", "net amount"),
    "debit": ("debit", "withdrawal", "withdrawals", "dr", "paid out", "money out", "debit amount"),
    "credit": ("credit", "deposit", "deposits", "cr", "paid in", "money in", "credit amount"),
    "type": ("type", "transaction type", "txn type", "kind", "in/out", "direction"),
    "description": ("description", "narration", "details", "particulars", "remarks", "memo", "note", "tafseel"),
    "category": ("category", "head", "expense head", "account head"),
    "account": ("account", "payment method", "method", "mode", "channel", "wallet"),
    "party": ("party", "customer", "supplier", "name", "counterparty", "customer/supplier", "vendor"),
    "due_date": ("due date", "due", "due_date", "payment due"),
    "reference": ("reference", "ref", "ref no", "invoice", "invoice no", "cheque no", "transaction id", "txn id"),
}

TYPE_MAP = {
    "in": "income", "income": "income", "credit": "income", "cr": "income", "sale": "income", "sales": "income",
    "receipt": "income", "received": "income", "deposit": "income",
    "out": "expense", "expense": "expense", "debit": "expense", "dr": "expense", "purchase": "expense",
    "payment": "expense", "paid": "expense", "withdrawal": "expense",
    "credit sale": "credit_sale", "credit_sale": "credit_sale", "udhaar": "credit_sale", "udhar": "credit_sale",
    "credit purchase": "credit_purchase", "credit_purchase": "credit_purchase",
    "customer payment": "customer_payment", "customer_payment": "customer_payment",
    "supplier payment": "supplier_payment", "supplier_payment": "supplier_payment",
}
ACCOUNT_MAP = {
    "cash": "cash", "naqd": "cash", "bank": "bank", "cheque": "bank", "card": "bank", "ibft": "bank", "raast": "bank",
    "wallet": "wallet", "jazzcash": "wallet", "easypaisa": "wallet", "sadapay": "wallet", "nayapay": "wallet",
    "mobile wallet": "wallet",
}


@dataclass(frozen=True)
class Adapter:
    name: str
    label: str
    required: tuple[str, ...]
    default_account: str


ADAPTERS = [
    Adapter("findost_template", "FinDost template", ("date", "type", "amount"), "cash"),
    Adapter("bank_statement", "Bank statement (debit/credit columns)", ("date", "debit", "credit"), "bank"),
    Adapter("generic", "Generic (date + signed amount)", ("date", "amount"), "cash"),
]


class IngestionError(ValueError):
    pass


def _norm_header(h: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[_\-]+", " ", h.strip().lower())).strip()


def suggest_mapping(headers: list[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    normalized = {_norm_header(h): h for h in headers}
    for f in FIELDS:
        for syn in SYNONYMS[f]:
            if syn in normalized and normalized[syn] not in mapping.values():
                mapping[f] = normalized[syn]
                break
    if "amount" not in mapping:  # partial matches like "Amount (Rs.)"
        for norm, original in normalized.items():
            if "amount" in norm and original not in mapping.values():
                mapping["amount"] = original
                break
    return mapping


def detect_adapter(mapping: dict[str, str]) -> Adapter:
    for adapter in ADAPTERS:
        if all(f in mapping for f in adapter.required):
            return adapter
    raise IngestionError("Could not find a date column and an amount (or debit/credit) column. "
                         "Map the columns manually or use the FinDost template.")


def read_csv(content: bytes) -> tuple[list[str], list[list[str]]]:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:  # pragma: no cover - latin-1 always decodes
        raise IngestionError("Could not read the file encoding")
    if "\x00" in text:
        raise IngestionError("This does not look like a text CSV file")
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    rows: list[list[str]] = []
    headers: list[str] | None = None
    for raw in reader:
        if not any(c.strip() for c in raw):
            continue
        if len(raw) > MAX_COLUMNS:
            raise IngestionError(f"Too many columns (max {MAX_COLUMNS})")
        cells = [c.strip()[:MAX_CELL] for c in raw]
        if headers is None:
            headers = cells
            continue
        rows.append(cells)
        if len(rows) > MAX_ROWS:
            raise IngestionError(f"Too many rows (max {MAX_ROWS} per file)")
    if not headers:
        raise IngestionError("The file is empty")
    if len(set(h.lower() for h in headers)) != len(headers):
        raise IngestionError("Column names must be unique")
    return headers, rows


# --------------------------------------------------------------------------- dates

_ISO = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})")
_NUMERIC = re.compile(r"^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$")
_TEXT_FORMATS = ("%d %b %Y", "%d-%b-%Y", "%d-%b-%y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y", "%d %b %y", "%d/%b/%Y")


def infer_day_first(values: list[str]) -> bool:
    """Column-level check: any first part > 12 means day-first; any second part > 12 means month-first.
    Defaults to day-first, the Pakistani convention."""
    for v in values:
        m = _NUMERIC.match(v.strip())
        if not m:
            continue
        a, b = int(m.group(1)), int(m.group(2))
        if a > 12 >= b:
            return True
        if b > 12 >= a:
            return False
    return True


def parse_date(raw: str, day_first: bool = True) -> date | None:
    text = raw.strip()
    if not text:
        return None
    m = _ISO.match(text)
    if m:  # ISO is always year-month-day; never swapped
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    m = _NUMERIC.match(text)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if y < 100:
            y += 2000
        day, month = (a, b) if day_first else (b, a)
        try:
            return date(y, month, day)
        except ValueError:
            return None
    for fmt in _TEXT_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


# --------------------------------------------------------------------------- normalize

def norm_desc(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", text.lower())).strip()


def dedupe_key(occurred_on: date, amount_paisa: int, direction: str, description: str) -> str:
    raw = f"{occurred_on.isoformat()}|{amount_paisa}|{direction}|{norm_desc(description)[:60]}"
    return hashlib.sha1(raw.encode()).hexdigest()


@dataclass
class PreviewRow:
    row_number: int
    raw: dict[str, str]
    status: str = "accepted"  # accepted | rejected | duplicate
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    date: str | None = None
    kind: str | None = None
    amount_paisa: int | None = None
    account: str | None = None
    category: str | None = None
    category_reason: str | None = None
    description: str = ""
    party: str | None = None
    due_date: str | None = None
    reference: str | None = None
    dedupe_key: str | None = None

    def to_dict(self) -> dict:
        return self.__dict__.copy()


def build_preview(headers: list[str], rows: list[list[str]], today: date, existing_keys: set[str],
                  history: list[tuple[str, str]], mapping: dict[str, str] | None = None) -> dict:
    mapping = {k: v for k, v in (mapping or suggest_mapping(headers)).items() if v in headers}
    adapter = detect_adapter(mapping)
    idx = {f: headers.index(col) for f, col in mapping.items()}

    def cell(row: list[str], f: str) -> str:
        i = idx.get(f)
        return row[i].strip() if i is not None and i < len(row) else ""

    day_first = infer_day_first([cell(r, "date") for r in rows] + [cell(r, "due_date") for r in rows])
    seen: set[str] = set()
    out: list[PreviewRow] = []
    for n, row in enumerate(rows, start=2):  # row 1 is the header
        pr = PreviewRow(row_number=n, raw={h: (row[i] if i < len(row) else "") for i, h in enumerate(headers)})
        d = parse_date(cell(row, "date"), day_first)
        if d is None:
            pr.reasons.append(f"invalid or missing date '{cell(row, 'date')}'")
        elif d > today + timedelta(days=1):
            pr.reasons.append(f"date {d.isoformat()} is in the future")
        elif d < today - timedelta(days=3 * 365):
            pr.reasons.append(f"date {d.isoformat()} is more than 3 years old")
        else:
            pr.date = d.isoformat()

        kind = None
        amount = None
        if adapter.name == "bank_statement":
            debit, credit = parse_amount(cell(row, "debit")), parse_amount(cell(row, "credit"))
            if debit and credit:
                pr.reasons.append("both debit and credit are filled")
            elif debit:
                kind, amount = "expense", abs(debit)
            elif credit:
                kind, amount = "income", abs(credit)
            else:
                pr.reasons.append("no debit or credit amount")
        else:
            amount_raw = cell(row, "amount")
            parsed = parse_amount(amount_raw)
            if parsed is None:
                pr.reasons.append(f"invalid or missing amount '{amount_raw}'")
            elif parsed == 0:
                pr.reasons.append("amount is zero")
            else:
                type_raw = cell(row, "type").lower()
                if type_raw:
                    kind = TYPE_MAP.get(type_raw)
                    if kind is None:
                        pr.reasons.append(f"unknown type '{cell(row, 'type')}' (use in/out, income/expense, credit sale...)")
                else:
                    kind = "income" if parsed > 0 else "expense"
                    pr.warnings.append("direction taken from the amount's sign")
                amount = abs(parsed)
        if amount is not None and amount > 10**13:
            pr.reasons.append("amount is unrealistically large")
            amount = None
        pr.kind, pr.amount_paisa = kind, amount

        pr.description = cell(row, "description")[:240]
        pr.party = cell(row, "party")[:120] or None
        pr.reference = cell(row, "reference")[:40] or None
        acct_raw = cell(row, "account").lower()
        pr.account = ACCOUNT_MAP.get(acct_raw, adapter.default_account if not acct_raw else None)
        if acct_raw and pr.account is None:
            pr.account = adapter.default_account
            pr.warnings.append(f"unknown account '{acct_raw}', using {adapter.default_account}")

        if kind in ("credit_sale", "credit_purchase", "customer_payment", "supplier_payment") and not pr.party:
            pr.reasons.append(f"{kind.replace('_', ' ')} needs a customer/supplier name in the party column")
        if kind in ("credit_sale", "credit_purchase") and pr.date:
            due = parse_date(cell(row, "due_date"), day_first) if cell(row, "due_date") else None
            if due is None:
                due = date.fromisoformat(pr.date) + timedelta(days=30)
                pr.warnings.append("no due date - assumed 30 days")
            pr.due_date = due.isoformat()

        if kind:
            direction = "in" if kind in ("income", "credit_sale", "customer_payment") else "out"
            given = cell(row, "category")
            if given:
                pr.category, pr.category_reason = given[:60], "from file"
            else:
                cat, reason, _conf = categorize(f"{pr.description} {pr.party or ''}", direction, history)
                pr.category, pr.category_reason = cat, f"auto: {reason}"

        if pr.reasons:
            pr.status = "rejected"
        else:
            key = dedupe_key(date.fromisoformat(pr.date), amount, kind, pr.description)
            pr.dedupe_key = key
            if key in existing_keys:
                pr.status = "duplicate"
                pr.reasons.append("already in your ledger")
            elif key in seen:
                pr.status = "duplicate"
                pr.reasons.append("repeated earlier in this file")
            seen.add(key)
        out.append(pr)

    rows_out = [r.to_dict() for r in out]
    return {
        "adapter": adapter.name,
        "adapter_label": adapter.label,
        "mapping": mapping,
        "headers": headers,
        "day_first": day_first,
        "rows": rows_out,
        "summary": summarize(rows_out),
    }


def summarize(rows: list[dict]) -> dict:
    accepted = [r for r in rows if r["status"] == "accepted"]
    dates = sorted(r["date"] for r in accepted if r["date"])
    return {
        "total_rows": len(rows),
        "accepted": len(accepted),
        "rejected": sum(r["status"] == "rejected" for r in rows),
        "duplicates": sum(r["status"] == "duplicate" for r in rows),
        "corrected": sum(1 for r in rows if r.get("corrected")),
        "date_from": dates[0] if dates else None,
        "date_to": dates[-1] if dates else None,
        "cash_in_paisa": sum(r["amount_paisa"] for r in accepted if r["kind"] in ("income", "customer_payment")),
        "cash_out_paisa": sum(r["amount_paisa"] for r in accepted if r["kind"] in ("expense", "supplier_payment")),
        "auto_categorized": sum(1 for r in accepted if (r.get("category_reason") or "").startswith("auto")),
    }


# --------------------------------------------------------------------------- user corrections

TX_KINDS = ("income", "expense", "credit_sale", "customer_payment", "credit_purchase", "supplier_payment",
            "loan_received", "loan_repayment", "owner_withdrawal")
PARTY_KINDS = ("credit_sale", "credit_purchase", "customer_payment", "supplier_payment")
CORRECTABLE = ("date", "kind", "amount_paisa", "category", "description", "party", "account", "due_date")


def correct_row(row: dict, changes: dict, today: date, existing_keys: set[str], earlier_keys: set[str]) -> dict:
    """Apply a user's correction to a preview row and validate it again from scratch.

    The row keeps its original parsed values under ``original`` so the import stays traceable.
    """
    new = dict(row)
    if not new.get("corrected"):
        new["original"] = {k: row.get(k) for k in CORRECTABLE}
    for k, v in changes.items():
        if k in CORRECTABLE:
            new[k] = v
    new["corrected"] = True
    reasons: list[str] = []
    try:
        d = date.fromisoformat(new["date"]) if new.get("date") else None
    except (TypeError, ValueError):
        d = None
    if d is None:
        reasons.append("date is missing or not YYYY-MM-DD")
    elif d > today + timedelta(days=1):
        reasons.append(f"date {d.isoformat()} is in the future")
    elif d < today - timedelta(days=3 * 365):
        reasons.append(f"date {d.isoformat()} is more than 3 years old")
    amount = new.get("amount_paisa")
    if not isinstance(amount, int) or isinstance(amount, bool) or not (0 < amount <= 10**13):
        reasons.append("amount must be a positive whole number of paisa")
    if new.get("kind") not in TX_KINDS:
        reasons.append("choose a valid type")
    if new.get("kind") in PARTY_KINDS and not (new.get("party") or "").strip():
        reasons.append(f"{str(new.get('kind')).replace('_', ' ')} needs a customer/supplier name")
    if new.get("account") not in (None, "cash", "bank", "wallet"):
        reasons.append("account must be cash, bank or wallet")
    new["description"] = (new.get("description") or "")[:240]
    new["category"] = (new.get("category") or "Uncategorized")[:60]
    new["party"] = ((new.get("party") or "").strip()[:120]) or None
    if new.get("kind") in ("credit_sale", "credit_purchase") and d is not None:
        try:
            due = date.fromisoformat(new["due_date"]) if new.get("due_date") else d + timedelta(days=30)
        except (TypeError, ValueError):
            due = None
            reasons.append("due date is not YYYY-MM-DD")
        if due is not None and due < d:
            reasons.append("due date is before the transaction date")
        new["due_date"] = due.isoformat() if due else None
    else:
        new["due_date"] = None
    new["category_reason"] = "corrected by you"
    new["warnings"] = [w for w in row.get("warnings", []) if not w.startswith("direction taken")]
    new["reasons"] = reasons
    new["dedupe_key"] = None
    if reasons:
        new["status"] = "rejected"
    else:
        key = dedupe_key(d, amount, new["kind"], new["description"])
        new["dedupe_key"] = key
        if key in existing_keys:
            new["status"], new["reasons"] = "duplicate", ["already in your ledger"]
        elif key in earlier_keys:
            new["status"], new["reasons"] = "duplicate", ["repeated earlier in this file"]
        else:
            new["status"] = "accepted"
    return new


# --------------------------------------------------------------------------- settlement matching

class Settler:
    """Matches imported payments to open invoices/bills, tracking what is left on each one.

    Used for the preview (to warn before import) and for the import itself, so one invoice can
    never be settled twice by several payments in the same file.
    """

    def __init__(self, receivables, payables):
        self.recs = [[r.id, r.customer_id, r.due_on, r.outstanding] for r in sorted(receivables, key=lambda r: r.due_on)
                     if r.outstanding > 0]
        self.pays = [[p.id, p.supplier_id, p.due_on, p.outstanding] for p in sorted(payables, key=lambda p: p.due_on)
                     if p.outstanding > 0]

    def add_receivable(self, rec_id: str, customer_id: str, due_on: date, amount: int) -> None:
        self.recs.append([rec_id, customer_id, due_on, amount])
        self.recs.sort(key=lambda r: r[2])

    def add_payable(self, pay_id: str, supplier_id: str | None, due_on: date, amount: int) -> None:
        self.pays.append([pay_id, supplier_id, due_on, amount])
        self.pays.sort(key=lambda p: p[2])

    @staticmethod
    def _take(items: list, party_id: str | None, amount: int) -> str | None:
        for it in items:
            if party_id is not None and it[1] == party_id and it[3] >= amount:
                it[3] -= amount
                return it[0]
        return None

    def match_receivable(self, customer_id: str | None, amount: int) -> str | None:
        return self._take(self.recs, customer_id, amount)

    def match_payable(self, supplier_id: str | None, amount: int) -> str | None:
        return self._take(self.pays, supplier_id, amount)


def annotate_settlements(rows: list[dict], receivables, payables, customers: dict[str, str],
                         suppliers: dict[str, str]) -> None:
    """Dry-run the import's matching and tell the user what each payment row will settle."""
    cust_by_name = {name.lower(): cid for cid, name in customers.items()}
    sup_by_name = {name.lower(): sid for sid, name in suppliers.items()}
    settler = Settler(receivables, payables)
    for r in rows:
        r["settles"] = None
        if r["status"] != "accepted" or r["kind"] not in PARTY_KINDS:
            continue
        party = (r.get("party") or "").lower()
        if r["kind"] == "credit_sale":
            cid = cust_by_name.setdefault(party, f"new:{party}")
            settler.add_receivable(f"row:{r['row_number']}", cid, date.fromisoformat(r["due_date"]), r["amount_paisa"])
        elif r["kind"] == "credit_purchase":
            sid = sup_by_name.setdefault(party, f"new:{party}")
            settler.add_payable(f"row:{r['row_number']}", sid, date.fromisoformat(r["due_date"]), r["amount_paisa"])
        elif r["kind"] == "customer_payment":
            hit = settler.match_receivable(cust_by_name.get(party), r["amount_paisa"])
            r["settles"] = ({"type": "receivable", "id": hit} if hit else
                            {"type": None, "note": f"No open invoice for {r['party']} covers this amount: it will be "
                                                   "recorded as income (revenue). Edit the row if that is wrong."})
        else:
            hit = settler.match_payable(sup_by_name.get(party), r["amount_paisa"])
            r["settles"] = ({"type": "payable", "id": hit} if hit else
                            {"type": None, "note": f"No open bill for {r['party']} covers this amount: it will be "
                                                   "recorded as an expense. Edit the row if that is wrong."})


TEMPLATES = {
    "findost-template.csv": (
        "date,type,amount,category,description,account,party,due_date,reference\n"
        "2026-10-01,in,45000,Sales,Counter cash sales,cash,,,\n"
        "2026-10-01,out,12500,Utilities,LESCO electricity bill,bank,,,\n"
        "2026-10-02,credit sale,18000,Sales,Ration on credit,,Model School Canteen,2026-10-30,INV-101\n"
        "2026-10-03,credit purchase,40000,Inventory Purchase,Stock on credit,,Lahore Unilever Distributor,2026-10-17,BILL-55\n"
        "2026-10-04,out,3500,,Loader rickshaw from mandi,cash,,,\n"
    ),
    "bank-statement-sample.csv": (
        "Date,Narration,Debit,Credit,Balance\n"
        "01/10/2026,IBFT from Rehman Hostel Mess,,26000,154000\n"
        "02/10/2026,LESCO bill payment,28700,,125300\n"
        "03/10/2026,Raast transfer - Lahore Unilever Distributor,46000,,79300\n"
        "05/10/2026,Cash deposit,,60000,139300\n"
        "07/10/2026,PTCL internet,3499,,135801\n"
    ),
    "messy-sample.csv": (
        "Tarikh,Tafseel,Raqam,Type,Method\n"
        "15/09/2026,Counter sales,\"Rs. 38,500\",in,cash\n"
        "15/09/2026,Counter sales,\"Rs. 38,500\",in,cash\n"
        "16/09/2026,Akbari mandi maal,(42000),,cash\n"
        "31/09/2026,Invalid date row,1200,out,cash\n"
        "17/09/2026,Missing amount,,out,cash\n"
        "18/09/2026,Easypaisa QR settlement,12750.50,in,easypaisa\n"
        "19/09/2026,Petrol bike,1800,out,jazzcash\n"
    ),
}
