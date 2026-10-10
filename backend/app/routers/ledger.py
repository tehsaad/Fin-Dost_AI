"""Digital Khata: transactions, customers, suppliers, receivables, payables."""
from __future__ import annotations

import csv
import io
from datetime import date, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..auth import get_business, require_feature
from ..config import today as get_today
from ..db import get_db
from ..errors import ApiError, not_found
from ..models import AuditEvent, Business, Customer, Payable, Receivable, Supplier, Transaction
from ..money import fmt_pkr
from ..schemas import (
    CustomerIn,
    PayableIn,
    PayableUpdate,
    PaymentIn,
    ReceivableIn,
    ReceivableUpdate,
    SupplierIn,
    TransactionIn,
    TransactionUpdate,
)
from ..services import audit
from ..services.categories import EXPENSE_CATEGORIES, INCOME_CATEGORIES, categorize
from ..services.i18n import isolate_ltr
from ..services.ingestion import dedupe_key
from ..services.ledger import account_balances, payable_view, receivable_view
from .common import check_capacity, context, csv_safe, get_or_create_customer, get_or_create_supplier, owned

router = APIRouter(tags=["ledger"])

CASH_KINDS = {"income", "expense", "loan_received", "loan_repayment", "owner_withdrawal", "customer_payment",
              "supplier_payment"}


def tx_dict(t: Transaction, customers: dict[str, str] | None = None, suppliers: dict[str, str] | None = None) -> dict:
    return {
        "id": t.id, "occurred_on": t.occurred_on.isoformat(), "kind": t.kind, "amount_paisa": t.amount_paisa,
        "account": t.account, "to_account": t.to_account, "category": t.category, "description": t.description,
        "customer_id": t.customer_id, "customer_name": (customers or {}).get(t.customer_id) if t.customer_id else None,
        "supplier_id": t.supplier_id, "supplier_name": (suppliers or {}).get(t.supplier_id) if t.supplier_id else None,
        "receivable_id": t.receivable_id, "payable_id": t.payable_id, "source": t.source, "is_demo": t.is_demo,
    }


def _names(db: Session, business: Business) -> tuple[dict[str, str], dict[str, str]]:
    customers = dict(db.execute(select(Customer.id, Customer.name).where(Customer.business_id == business.id)).all())
    suppliers = dict(db.execute(select(Supplier.id, Supplier.name).where(Supplier.business_id == business.id)).all())
    return customers, suppliers


def _check_date(d: date) -> None:
    if d > get_today() + timedelta(days=1):
        raise ApiError(422, "validation_error", "Transaction date cannot be in the future")


def _filtered(business: Business, date_from, date_to, kind, category, customer_id, supplier_id, account, q):
    stmt = select(Transaction).where(Transaction.business_id == business.id)
    if date_from:
        stmt = stmt.where(Transaction.occurred_on >= date_from)
    if date_to:
        stmt = stmt.where(Transaction.occurred_on <= date_to)
    if kind:
        stmt = stmt.where(Transaction.kind.in_([k.strip() for k in kind.split(",") if k.strip()]))
    if category:
        stmt = stmt.where(Transaction.category == category)
    if customer_id:
        stmt = stmt.where(Transaction.customer_id == customer_id)
    if supplier_id:
        stmt = stmt.where(Transaction.supplier_id == supplier_id)
    if account:
        stmt = stmt.where(or_(Transaction.account == account, Transaction.to_account == account))
    if q:
        like = f"%{q.strip()[:60]}%"
        stmt = stmt.where(or_(Transaction.description.ilike(like), Transaction.category.ilike(like)))
    return stmt


@router.get("/transactions")
def list_transactions(
    date_from: date | None = Query(default=None, alias="from"),
    date_to: date | None = Query(default=None, alias="to"),
    kind: str | None = None, category: str | None = None, customer_id: str | None = None,
    supplier_id: str | None = None, account: str | None = None, q: str | None = None,
    page: int = Query(default=1, ge=1), page_size: int = Query(default=50, ge=1, le=200),
    business: Business = Depends(require_feature("ledger")), db: Session = Depends(get_db),
):
    stmt = _filtered(business, date_from, date_to, kind, category, customer_id, supplier_id, account, q)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(Transaction.occurred_on.desc(), Transaction.created_at.desc())
                      .offset((page - 1) * page_size).limit(page_size)).all()
    customers, suppliers = _names(db, business)
    return {"items": [tx_dict(t, customers, suppliers) for t in rows], "total": total, "page": page,
            "page_size": page_size, "pages": max((total + page_size - 1) // page_size, 1)}


@router.get("/transactions/export.csv")
def export_transactions(
    date_from: date | None = Query(default=None, alias="from"),
    date_to: date | None = Query(default=None, alias="to"),
    kind: str | None = None, category: str | None = None, customer_id: str | None = None,
    supplier_id: str | None = None, account: str | None = None, q: str | None = None,
    business: Business = Depends(require_feature("ledger")), db: Session = Depends(get_db),
):
    stmt = _filtered(business, date_from, date_to, kind, category, customer_id, supplier_id, account, q)
    rows = db.scalars(stmt.order_by(Transaction.occurred_on, Transaction.created_at)).all()
    customers, suppliers = _names(db, business)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "type", "amount_pkr", "account", "to_account", "category", "description", "customer",
                "supplier", "source"])
    for t in rows:
        w.writerow([t.occurred_on.isoformat(), t.kind, f"{t.amount_paisa / 100:.2f}", t.account or "", t.to_account or "",
                    csv_safe(t.category), csv_safe(t.description), csv_safe(customers.get(t.customer_id, "")),
                    csv_safe(suppliers.get(t.supplier_id, "")), t.source])
    buf.seek(0)
    filename = f"findost-ledger-{get_today().isoformat()}.csv"
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/transactions/categories")
def categories(business: Business = Depends(get_business), db: Session = Depends(get_db)):
    used = db.scalars(select(Transaction.category).where(Transaction.business_id == business.id).distinct()).all()
    return {"income": INCOME_CATEGORIES, "expense": EXPENSE_CATEGORIES, "used": sorted(set(used))}


@router.get("/transactions/{tx_id}")
def get_transaction(tx_id: str, business: Business = Depends(require_feature("ledger")), db: Session = Depends(get_db)):
    customers, suppliers = _names(db, business)
    return tx_dict(owned(db, Transaction, tx_id, business, "Transaction"), customers, suppliers)


@router.post("/transactions", status_code=201)
def create_transaction(body: TransactionIn, business: Business = Depends(require_feature("ledger")),
                       db: Session = Depends(get_db)):
    _check_date(body.occurred_on)
    check_capacity(db, business)
    kind = body.kind
    direction = "in" if kind in ("income", "credit_sale", "customer_payment", "loan_received") else "out"
    category = body.category
    if not category:
        if kind in ("customer_payment",):
            category = "Customer payment"
        elif kind == "transfer":
            category = "Transfer"
        elif kind in ("loan_received", "loan_repayment"):
            category = "Loan"
        elif kind == "owner_withdrawal":
            category = "Owner drawings"
        else:
            history = [(t.description, t.category) for t in db.scalars(
                select(Transaction).where(Transaction.business_id == business.id, Transaction.source != "demo")
                .order_by(Transaction.created_at.desc()).limit(300))]
            category = categorize(body.description, direction, history)[0]
    tx = Transaction(business_id=business.id, occurred_on=body.occurred_on, kind=kind, amount_paisa=body.amount_paisa,
                     category=category, description=body.description, source="manual")
    extra: dict = {}

    if kind in CASH_KINDS:
        tx.account = body.account or "cash"
    if kind == "transfer":
        if not body.account or not body.to_account or body.account == body.to_account:
            raise ApiError(422, "validation_error", "A transfer needs two different accounts")
        tx.account, tx.to_account = body.account, body.to_account
    if kind in ("income", "expense") and (body.customer_id or body.customer_name):
        tx.customer_id = get_or_create_customer(db, business, body.customer_id, body.customer_name).id
    if kind in ("income", "expense") and (body.supplier_id or body.supplier_name):
        sup = get_or_create_supplier(db, business, body.supplier_id, body.supplier_name)
        tx.supplier_id = sup.id if sup else None

    if kind == "credit_sale":
        cust = get_or_create_customer(db, business, body.customer_id, body.customer_name)
        due = body.due_on or body.occurred_on + timedelta(days=30)
        if due < body.occurred_on:
            raise ApiError(422, "validation_error", "Due date cannot be before the sale date")
        rec = Receivable(business_id=business.id, customer_id=cust.id, reference=body.reference,
                         description=body.description or None, issued_on=body.occurred_on, due_on=due,
                         amount_paisa=body.amount_paisa)
        db.add(rec)
        db.flush()
        tx.customer_id, tx.receivable_id = cust.id, rec.id
        extra["receivable_id"] = rec.id
    elif kind == "credit_purchase":
        sup = get_or_create_supplier(db, business, body.supplier_id, body.supplier_name)
        due = body.due_on or body.occurred_on + timedelta(days=14)
        if due < body.occurred_on:
            raise ApiError(422, "validation_error", "Due date cannot be before the purchase date")
        pay = Payable(business_id=business.id, supplier_id=sup.id if sup else None, reference=body.reference,
                      description=body.description or None, category=category, issued_on=body.occurred_on,
                      due_on=due, amount_paisa=body.amount_paisa)
        db.add(pay)
        db.flush()
        tx.supplier_id, tx.payable_id = (sup.id if sup else None), pay.id
        extra["payable_id"] = pay.id
    elif kind == "customer_payment":
        if not body.receivable_id:
            raise ApiError(422, "validation_error", "A customer payment must reference a receivable (receivable_id)")
        rec = owned(db, Receivable, body.receivable_id, business, "Receivable", lock=True)
        _check_outstanding(db, rec.amount_paisa, Transaction.receivable_id == rec.id, "customer_payment", body.amount_paisa)
        tx.receivable_id, tx.customer_id = rec.id, rec.customer_id
    elif kind == "supplier_payment":
        if not body.payable_id:
            raise ApiError(422, "validation_error", "A supplier payment must reference a payable (payable_id)")
        pay = owned(db, Payable, body.payable_id, business, "Payable", lock=True)
        _check_outstanding(db, pay.amount_paisa, Transaction.payable_id == pay.id, "supplier_payment", body.amount_paisa)
        tx.payable_id, tx.supplier_id = pay.id, pay.supplier_id

    tx.dedupe_key = dedupe_key(tx.occurred_on, tx.amount_paisa, kind, tx.description)
    db.add(tx)
    db.flush()
    audit.record(db, business, "transaction", tx.id, "create", after=audit.snapshot("transaction", tx))
    db.commit()
    customers, suppliers = _names(db, business)
    return {**tx_dict(tx, customers, suppliers), **extra}


def _paid(db: Session, link_clause, kind: str, exclude_id: str | None = None) -> int:
    stmt = select(func.coalesce(func.sum(Transaction.amount_paisa), 0)).where(link_clause, Transaction.kind == kind)
    if exclude_id:
        stmt = stmt.where(Transaction.id != exclude_id)
    return int(db.scalar(stmt) or 0)


def _check_outstanding(db: Session, amount: int, link_clause, kind: str, new_payment: int,
                       exclude_id: str | None = None) -> None:
    outstanding = amount - _paid(db, link_clause, kind, exclude_id)
    if new_payment > outstanding:
        raise ApiError(422, "overpayment", f"Payment of {fmt_pkr(new_payment)} exceeds the outstanding {fmt_pkr(outstanding)}")


@router.put("/transactions/{tx_id}")
def update_transaction(tx_id: str, body: TransactionUpdate, business: Business = Depends(require_feature("ledger")),
                       db: Session = Depends(get_db)):
    tx = owned(db, Transaction, tx_id, business, "Transaction")
    before = audit.snapshot("transaction", tx)
    data = body.model_dump(exclude_unset=True)
    linked: Receivable | Payable | None = None
    if tx.kind == "credit_sale" and tx.receivable_id:
        linked = owned(db, Receivable, tx.receivable_id, business, "Receivable", lock=True)
    elif tx.kind == "credit_purchase" and tx.payable_id:
        linked = owned(db, Payable, tx.payable_id, business, "Payable", lock=True)
    elif tx.kind == "customer_payment" and tx.receivable_id:
        owned(db, Receivable, tx.receivable_id, business, "Receivable", lock=True)
    elif tx.kind == "supplier_payment" and tx.payable_id:
        owned(db, Payable, tx.payable_id, business, "Payable", lock=True)
    linked_type = "receivable" if isinstance(linked, Receivable) else "payable"
    linked_before = audit.snapshot(linked_type, linked) if linked is not None else None
    if "occurred_on" in data:
        _check_date(data["occurred_on"])
        if linked is not None:
            # The invoice/bill is dated by its sale/purchase: keep them in step.
            if linked.due_on < data["occurred_on"]:
                raise ApiError(422, "validation_error",
                               f"The due date ({linked.due_on.isoformat()}) would be before the new date. "
                               "Change the due date first.")
            linked.issued_on = data["occurred_on"]
    if "amount_paisa" in data:
        new_amount = data["amount_paisa"]
        if tx.kind == "credit_sale" and tx.receivable_id:
            rec = db.get(Receivable, tx.receivable_id)
            paid = _paid(db, Transaction.receivable_id == rec.id, "customer_payment")
            if new_amount < paid:
                raise ApiError(422, "validation_error", f"Amount cannot be below the {fmt_pkr(paid)} already paid")
            rec.amount_paisa = new_amount
        elif tx.kind == "credit_purchase" and tx.payable_id:
            pay = db.get(Payable, tx.payable_id)
            paid = _paid(db, Transaction.payable_id == pay.id, "supplier_payment")
            if new_amount < paid:
                raise ApiError(422, "validation_error", f"Amount cannot be below the {fmt_pkr(paid)} already paid")
            pay.amount_paisa = new_amount
        elif tx.kind == "customer_payment" and tx.receivable_id:
            rec = db.get(Receivable, tx.receivable_id)
            _check_outstanding(db, rec.amount_paisa, Transaction.receivable_id == rec.id, "customer_payment", new_amount, tx.id)
        elif tx.kind == "supplier_payment" and tx.payable_id:
            pay = db.get(Payable, tx.payable_id)
            _check_outstanding(db, pay.amount_paisa, Transaction.payable_id == pay.id, "supplier_payment", new_amount, tx.id)
    if tx.kind == "transfer":
        acct, to_acct = data.get("account", tx.account), data.get("to_account", tx.to_account)
        if not acct or not to_acct or acct == to_acct:
            raise ApiError(422, "validation_error", "A transfer needs two different accounts")
    elif "to_account" in data:
        data.pop("to_account")
    if tx.kind in ("credit_sale", "credit_purchase"):
        data.pop("account", None)
    for key, value in data.items():
        setattr(tx, key, value)
    if tx.source == "demo":
        tx.source = "edited"
    tx.dedupe_key = dedupe_key(tx.occurred_on, tx.amount_paisa, tx.kind, tx.description)
    audit.record(db, business, "transaction", tx.id, "update", before=before, after=audit.snapshot("transaction", tx))
    if linked is not None:
        audit.record(db, business, linked_type, linked.id, "update", before=linked_before,
                     after=audit.snapshot(linked_type, linked), extra={"via_transaction": tx.id})
    db.commit()
    customers, suppliers = _names(db, business)
    return tx_dict(tx, customers, suppliers)


@router.delete("/transactions/{tx_id}", status_code=204)
def delete_transaction(tx_id: str, business: Business = Depends(require_feature("ledger")), db: Session = Depends(get_db)):
    tx = owned(db, Transaction, tx_id, business, "Transaction")
    audit.record(db, business, "transaction", tx.id, "delete", before=audit.snapshot("transaction", tx))
    if tx.kind == "credit_sale" and tx.receivable_id:
        if _paid(db, Transaction.receivable_id == tx.receivable_id, "customer_payment"):
            raise ApiError(409, "has_payments", "This credit sale has payments recorded. Delete the payments first.")
        rec = db.get(Receivable, tx.receivable_id)
        audit.record(db, business, "receivable", rec.id, "delete", before=audit.snapshot("receivable", rec),
                     extra={"via_transaction": tx.id})
        db.delete(rec)  # cascades to this transaction
    elif tx.kind == "credit_purchase" and tx.payable_id:
        if _paid(db, Transaction.payable_id == tx.payable_id, "supplier_payment"):
            raise ApiError(409, "has_payments", "This purchase has payments recorded. Delete the payments first.")
        pay = db.get(Payable, tx.payable_id)
        audit.record(db, business, "payable", pay.id, "delete", before=audit.snapshot("payable", pay),
                     extra={"via_transaction": tx.id})
        db.delete(pay)
    else:
        db.delete(tx)
    db.commit()


# ------------------------------------------------------------------ customers & suppliers

@router.get("/customers")
def list_customers(business: Business = Depends(require_feature("ledger")), db: Session = Depends(get_db)):
    snap, today = context(db, business)
    owed: dict[str, int] = {}
    for r in snap.receivables:
        owed[r.customer_id] = owed.get(r.customer_id, 0) + r.outstanding
    return {"items": [{"id": cid, "name": name, "outstanding_paisa": owed.get(cid, 0)}
                      for cid, name in sorted(snap.customers.items(), key=lambda kv: kv[1])]}


@router.post("/customers", status_code=201)
def create_customer(body: CustomerIn, business: Business = Depends(require_feature("ledger")), db: Session = Depends(get_db)):
    if db.scalar(select(Customer).where(Customer.business_id == business.id, Customer.name == body.name)):
        raise ApiError(409, "duplicate", "A customer with this name already exists")
    c = Customer(business_id=business.id, name=body.name, notes=body.notes)
    db.add(c)
    db.commit()
    return {"id": c.id, "name": c.name}


@router.get("/suppliers")
def list_suppliers(business: Business = Depends(require_feature("ledger")), db: Session = Depends(get_db)):
    snap, _ = context(db, business)
    owed: dict[str, int] = {}
    for p in snap.payables:
        if p.supplier_id:
            owed[p.supplier_id] = owed.get(p.supplier_id, 0) + p.outstanding
    return {"items": [{"id": sid, "name": name, "outstanding_paisa": owed.get(sid, 0)}
                      for sid, name in sorted(snap.suppliers.items(), key=lambda kv: kv[1])]}


@router.post("/suppliers", status_code=201)
def create_supplier(body: SupplierIn, business: Business = Depends(require_feature("ledger")), db: Session = Depends(get_db)):
    if db.scalar(select(Supplier).where(Supplier.business_id == business.id, Supplier.name == body.name)):
        raise ApiError(409, "duplicate", "A supplier with this name already exists")
    s = Supplier(business_id=business.id, name=body.name, category=body.category)
    db.add(s)
    db.commit()
    return {"id": s.id, "name": s.name}


# ------------------------------------------------------------------ receivables

@router.get("/receivables")
def list_receivables(status: str | None = None, business: Business = Depends(require_feature("receivables")),
                     db: Session = Depends(get_db)):
    snap, today = context(db, business)
    items = [receivable_view(r, today) for r in snap.receivables]
    if status:
        items = [i for i in items if i["status"] == status]
    items.sort(key=lambda i: (i["status"] == "settled", -i["days_overdue"], i["due_on"]))
    return {"items": items}


@router.post("/receivables", status_code=201)
def create_receivable(body: ReceivableIn, business: Business = Depends(require_feature("receivables")),
                      db: Session = Depends(get_db)):
    if body.due_on < body.issued_on:
        raise ApiError(422, "validation_error", "Due date cannot be before the issue date")
    _check_date(body.issued_on)
    cust = get_or_create_customer(db, business, body.customer_id, body.customer_name)
    rec = Receivable(business_id=business.id, customer_id=cust.id, reference=body.reference,
                     description=body.description, issued_on=body.issued_on, due_on=body.due_on,
                     amount_paisa=body.amount_paisa)
    db.add(rec)
    db.flush()
    audit.record(db, business, "receivable", rec.id, "create", after=audit.snapshot("receivable", rec))
    if body.record_sale:
        sale = Transaction(business_id=business.id, occurred_on=body.issued_on, kind="credit_sale",
                           amount_paisa=body.amount_paisa, category="Sales",
                           description=body.description or f"Credit sale - {cust.name}", customer_id=cust.id,
                           receivable_id=rec.id, source="manual")
        db.add(sale)
        db.flush()
        audit.record(db, business, "transaction", sale.id, "create", after=audit.snapshot("transaction", sale))
    db.commit()
    snap, today = context(db, business)
    return next(receivable_view(r, today) for r in snap.receivables if r.id == rec.id)


@router.put("/receivables/{rec_id}")
def update_receivable(rec_id: str, body: ReceivableUpdate, business: Business = Depends(require_feature("receivables")),
                      db: Session = Depends(get_db)):
    rec = owned(db, Receivable, rec_id, business, "Receivable")
    before = audit.snapshot("receivable", rec)
    data = body.model_dump(exclude_unset=True)
    if "due_on" in data and data["due_on"] < rec.issued_on:
        raise ApiError(422, "validation_error", "Due date cannot be before the issue date")
    for k, v in data.items():
        setattr(rec, k, v)
    audit.record(db, business, "receivable", rec.id, "update", before=before, after=audit.snapshot("receivable", rec))
    db.commit()
    snap, today = context(db, business)
    return next(receivable_view(r, today) for r in snap.receivables if r.id == rec.id)


@router.post("/receivables/{rec_id}/payments", status_code=201)
def record_receivable_payment(rec_id: str, body: PaymentIn, business: Business = Depends(require_feature("receivables")),
                              db: Session = Depends(get_db)):
    rec = owned(db, Receivable, rec_id, business, "Receivable", lock=True)
    when = body.occurred_on or get_today()
    _check_date(when)
    _check_outstanding(db, rec.amount_paisa, Transaction.receivable_id == rec.id, "customer_payment", body.amount_paisa)
    cust = db.get(Customer, rec.customer_id)
    desc = f"Payment from {cust.name}" + (f" ({rec.reference})" if rec.reference else "") + (f" - {body.note}" if body.note else "")
    tx = Transaction(business_id=business.id, occurred_on=when, kind="customer_payment", amount_paisa=body.amount_paisa,
                     account=body.account, category="Customer payment", description=desc[:240],
                     customer_id=rec.customer_id, receivable_id=rec.id, source="manual")
    tx.dedupe_key = dedupe_key(when, body.amount_paisa, "customer_payment", desc)
    db.add(tx)
    db.flush()
    audit.record(db, business, "transaction", tx.id, "payment", after=audit.snapshot("transaction", tx),
                 extra={"receivable_id": rec.id})
    db.commit()
    snap, today = context(db, business)
    return {"receivable": next(receivable_view(r, today) for r in snap.receivables if r.id == rec.id),
            "transaction_id": tx.id, "balance": account_balances(snap, today)}


@router.get("/receivables/{rec_id}/reminder")
def receivable_reminder(rec_id: str, lang: str = "en", business: Business = Depends(require_feature("receivables")),
                        db: Session = Depends(get_db)):
    snap, today = context(db, business)
    rec = next((r for r in snap.receivables if r.id == rec_id), None)
    if rec is None:
        raise not_found("Receivable")
    if rec.outstanding == 0:
        raise ApiError(409, "settled", "This invoice is already fully paid")
    ref = f" ({rec.reference})" if rec.reference else ""
    if lang == "ur":
        text = (f"السلام علیکم {rec.customer_name}، {business.name} کی طرف سے یاد دہانی: آپ کے ذمے {fmt_pkr(rec.outstanding)}{ref} "
                f"کی ادائیگی {rec.due_on.isoformat()} کو واجب تھی۔ براہ کرم سہولت کے مطابق ادائیگی کر دیں۔ جزاک اللہ۔")
        text = isolate_ltr(text)
    else:
        overdue = (today - rec.due_on).days
        when = f"was due on {rec.due_on.isoformat()}" if overdue > 0 else f"is due on {rec.due_on.isoformat()}"
        text = (f"Assalam-o-Alaikum {rec.customer_name}, a gentle reminder from {business.name}: the payment of "
                f"{fmt_pkr(rec.outstanding)}{ref} {when}. Kindly arrange it at your convenience. JazakAllah.")
    return {"message": text, "whatsapp_url": f"https://wa.me/?text={quote(text)}",
            "note": "FinDost never sends messages itself - you choose the contact in WhatsApp."}


# ------------------------------------------------------------------ payables

@router.get("/payables")
def list_payables(status: str | None = None, business: Business = Depends(require_feature("payables")),
                  db: Session = Depends(get_db)):
    snap, today = context(db, business)
    items = [payable_view(p, today) for p in snap.payables]
    if status:
        items = [i for i in items if i["status"] == status]
    items.sort(key=lambda i: (i["status"] == "paid", i["due_on"]))
    return {"items": items}


@router.post("/payables", status_code=201)
def create_payable(body: PayableIn, business: Business = Depends(require_feature("payables")), db: Session = Depends(get_db)):
    if body.due_on < body.issued_on:
        raise ApiError(422, "validation_error", "Due date cannot be before the issue date")
    sup = get_or_create_supplier(db, business, body.supplier_id, body.supplier_name, body.category)
    pay = Payable(business_id=business.id, supplier_id=sup.id if sup else None, reference=body.reference,
                  description=body.description, category=body.category, issued_on=body.issued_on, due_on=body.due_on,
                  amount_paisa=body.amount_paisa, is_essential=body.is_essential)
    db.add(pay)
    db.flush()
    audit.record(db, business, "payable", pay.id, "create", after=audit.snapshot("payable", pay))
    if body.record_purchase:
        _check_date(body.issued_on)
        purchase = Transaction(business_id=business.id, occurred_on=body.issued_on, kind="credit_purchase",
                               amount_paisa=body.amount_paisa, category=body.category,
                               description=body.description or f"Purchase on credit - {sup.name if sup else body.category}",
                               supplier_id=sup.id if sup else None, payable_id=pay.id, source="manual")
        db.add(purchase)
        db.flush()
        audit.record(db, business, "transaction", purchase.id, "create", after=audit.snapshot("transaction", purchase))
    db.commit()
    snap, today = context(db, business)
    return next(payable_view(p, today) for p in snap.payables if p.id == pay.id)


@router.put("/payables/{pay_id}")
def update_payable(pay_id: str, body: PayableUpdate, business: Business = Depends(require_feature("payables")),
                   db: Session = Depends(get_db)):
    pay = owned(db, Payable, pay_id, business, "Payable")
    before = audit.snapshot("payable", pay)
    data = body.model_dump(exclude_unset=True)
    if "due_on" in data and data["due_on"] < pay.issued_on:
        raise ApiError(422, "validation_error", "Due date cannot be before the issue date")
    for k, v in data.items():
        setattr(pay, k, v)
    audit.record(db, business, "payable", pay.id, "update", before=before, after=audit.snapshot("payable", pay))
    db.commit()
    snap, today = context(db, business)
    return next(payable_view(p, today) for p in snap.payables if p.id == pay.id)


@router.delete("/payables/{pay_id}", status_code=204)
def delete_payable(pay_id: str, business: Business = Depends(require_feature("payables")), db: Session = Depends(get_db)):
    pay = owned(db, Payable, pay_id, business, "Payable")
    if _paid(db, Transaction.payable_id == pay.id, "supplier_payment"):
        raise ApiError(409, "has_payments", "This bill has payments recorded. Delete the payments first.")
    audit.record(db, business, "payable", pay.id, "delete", before=audit.snapshot("payable", pay))
    db.delete(pay)
    db.commit()


@router.post("/payables/{pay_id}/payments", status_code=201)
def record_payable_payment(pay_id: str, body: PaymentIn, business: Business = Depends(require_feature("payables")),
                           db: Session = Depends(get_db)):
    pay = owned(db, Payable, pay_id, business, "Payable", lock=True)
    when = body.occurred_on or get_today()
    _check_date(when)
    _check_outstanding(db, pay.amount_paisa, Transaction.payable_id == pay.id, "supplier_payment", body.amount_paisa)
    who = db.get(Supplier, pay.supplier_id).name if pay.supplier_id else (pay.description or pay.category)
    desc = f"Payment to {who}" + (f" ({pay.reference})" if pay.reference else "") + (f" - {body.note}" if body.note else "")
    tx = Transaction(business_id=business.id, occurred_on=when, kind="supplier_payment", amount_paisa=body.amount_paisa,
                     account=body.account, category=pay.category, description=desc[:240], supplier_id=pay.supplier_id,
                     payable_id=pay.id, source="manual")
    tx.dedupe_key = dedupe_key(when, body.amount_paisa, "supplier_payment", desc)
    db.add(tx)
    db.flush()
    audit.record(db, business, "transaction", tx.id, "payment", after=audit.snapshot("transaction", tx),
                 extra={"payable_id": pay.id})
    db.commit()
    snap, today = context(db, business)
    return {"payable": next(payable_view(p, today) for p in snap.payables if p.id == pay.id),
            "transaction_id": tx.id, "balance": account_balances(snap, today)}


# ------------------------------------------------------------------ change history

@router.get("/audit")
def audit_history(entity_id: str | None = None, entity_type: str | None = None,
                  limit: int = Query(default=50, ge=1, le=200),
                  business: Business = Depends(require_feature("ledger")), db: Session = Depends(get_db)):
    stmt = select(AuditEvent).where(AuditEvent.business_id == business.id)
    if entity_id:
        stmt = stmt.where(AuditEvent.entity_id == entity_id)
    if entity_type:
        stmt = stmt.where(AuditEvent.entity_type == entity_type)
    rows = db.scalars(stmt.order_by(AuditEvent.created_at.desc()).limit(limit)).all()
    return {"items": [{"id": e.id, "entity_type": e.entity_type, "entity_id": e.entity_id, "action": e.action,
                       "changes": e.changes, "at": e.created_at.isoformat()} for e in rows]}
