"""An in-memory, read-only view of one business's financial data.

The calculation engines (ledger, forecast, risk, simulation, recovery,
inventory) are pure functions over a Snapshot, so they are reproducible and can
be unit-tested without a database.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    Business,
    Customer,
    InventoryMovement,
    Payable,
    Product,
    Receivable,
    Supplier,
    Transaction,
)


@dataclass(frozen=True)
class Tx:
    id: str
    occurred_on: date
    kind: str
    amount: int
    account: str | None = None
    to_account: str | None = None
    category: str = "Uncategorized"
    description: str = ""
    customer_id: str | None = None
    supplier_id: str | None = None
    receivable_id: str | None = None
    payable_id: str | None = None
    source: str = "manual"


@dataclass
class Rec:
    id: str
    customer_id: str
    customer_name: str
    issued_on: date
    due_on: date
    amount: int
    reference: str | None = None
    description: str | None = None
    expected_on: date | None = None
    payments: list[tuple[date, int]] = field(default_factory=list)

    @property
    def paid(self) -> int:
        return sum(a for _, a in self.payments)

    @property
    def outstanding(self) -> int:
        return max(self.amount - self.paid, 0)


@dataclass
class Pay:
    id: str
    supplier_id: str | None
    supplier_name: str | None
    category: str
    issued_on: date
    due_on: date
    amount: int
    reference: str | None = None
    description: str | None = None
    is_essential: bool = True
    payments: list[tuple[date, int]] = field(default_factory=list)

    @property
    def paid(self) -> int:
        return sum(a for _, a in self.payments)

    @property
    def outstanding(self) -> int:
        return max(self.amount - self.paid, 0)

    @property
    def label(self) -> str:
        who = self.supplier_name or self.description or self.category
        return f"{who} ({self.reference})" if self.reference else who


@dataclass(frozen=True)
class Prod:
    id: str
    sku: str
    name: str
    unit: str
    unit_cost: int
    sale_price: int
    reorder_level: int
    lead_time_days: int


@dataclass(frozen=True)
class Move:
    id: str
    product_id: str
    occurred_on: date
    movement_type: str
    quantity: int
    unit_value: int


@dataclass
class Snapshot:
    business_id: str
    kind: str
    name: str
    opening_date: date
    opening: dict[str, int]
    reserve: int
    txs: list[Tx] = field(default_factory=list)
    receivables: list[Rec] = field(default_factory=list)
    payables: list[Pay] = field(default_factory=list)
    products: list[Prod] = field(default_factory=list)
    movements: list[Move] = field(default_factory=list)
    customers: dict[str, str] = field(default_factory=dict)
    suppliers: dict[str, str] = field(default_factory=dict)

    def tx_by_id(self) -> dict[str, Tx]:
        return {t.id: t for t in self.txs}


def load_snapshot(db: Session, business: Business) -> Snapshot:
    bid = business.id
    customers = {c.id: c.name for c in db.scalars(select(Customer).where(Customer.business_id == bid))}
    suppliers = {s.id: s.name for s in db.scalars(select(Supplier).where(Supplier.business_id == bid))}
    tx_rows = db.scalars(
        select(Transaction).where(Transaction.business_id == bid).order_by(Transaction.occurred_on, Transaction.created_at)
    ).all()
    txs = [
        Tx(
            id=t.id, occurred_on=t.occurred_on, kind=t.kind, amount=int(t.amount_paisa),
            account=t.account, to_account=t.to_account, category=t.category, description=t.description,
            customer_id=t.customer_id, supplier_id=t.supplier_id, receivable_id=t.receivable_id,
            payable_id=t.payable_id, source=t.source,
        )
        for t in tx_rows
    ]
    rec_payments: dict[str, list[tuple[date, int]]] = defaultdict(list)
    pay_payments: dict[str, list[tuple[date, int]]] = defaultdict(list)
    for t in txs:
        if t.kind == "customer_payment" and t.receivable_id:
            rec_payments[t.receivable_id].append((t.occurred_on, t.amount))
        elif t.kind == "supplier_payment" and t.payable_id:
            pay_payments[t.payable_id].append((t.occurred_on, t.amount))

    receivables = [
        Rec(
            id=r.id, customer_id=r.customer_id, customer_name=customers.get(r.customer_id, "Customer"),
            issued_on=r.issued_on, due_on=r.due_on, amount=int(r.amount_paisa), reference=r.reference,
            description=r.description, expected_on=r.expected_on, payments=sorted(rec_payments.get(r.id, [])),
        )
        for r in db.scalars(select(Receivable).where(Receivable.business_id == bid).order_by(Receivable.due_on))
    ]
    payables = [
        Pay(
            id=p.id, supplier_id=p.supplier_id,
            supplier_name=suppliers.get(p.supplier_id) if p.supplier_id else None,
            category=p.category, issued_on=p.issued_on, due_on=p.due_on, amount=int(p.amount_paisa),
            reference=p.reference, description=p.description, is_essential=p.is_essential,
            payments=sorted(pay_payments.get(p.id, [])),
        )
        for p in db.scalars(select(Payable).where(Payable.business_id == bid).order_by(Payable.due_on))
    ]
    products = [
        Prod(id=p.id, sku=p.sku, name=p.name, unit=p.unit, unit_cost=int(p.unit_cost_paisa),
             sale_price=int(p.sale_price_paisa), reorder_level=p.reorder_level, lead_time_days=p.lead_time_days)
        for p in db.scalars(select(Product).where(Product.business_id == bid).order_by(Product.name))
    ]
    movements = [
        Move(id=m.id, product_id=m.product_id, occurred_on=m.occurred_on, movement_type=m.movement_type,
             quantity=m.quantity, unit_value=int(m.unit_value_paisa))
        for m in db.scalars(
            select(InventoryMovement).where(InventoryMovement.business_id == bid).order_by(InventoryMovement.occurred_on)
        )
    ]
    return Snapshot(
        business_id=bid, kind=business.kind, name=business.name, opening_date=business.opening_date,
        opening={"cash": int(business.opening_cash_paisa), "bank": int(business.opening_bank_paisa),
                 "wallet": int(business.opening_wallet_paisa)},
        reserve=int(business.cash_reserve_paisa), txs=txs, receivables=receivables, payables=payables,
        products=products, movements=movements, customers=customers, suppliers=suppliers,
    )
