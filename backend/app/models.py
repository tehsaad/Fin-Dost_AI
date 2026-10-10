"""SQLAlchemy models.

Money is stored as integer paisa (1 PKR = 100 paisa) in BigInteger columns, so
ledger arithmetic is exact. Every financial record belongs to one business, and
every business belongs to exactly one authenticated user (``owner_id``).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def new_id() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


BUSINESS_KINDS = ("sme", "student", "household", "enterprise")
ACCOUNTS = ("cash", "bank", "wallet")

# Cash-affecting kinds carry an account. Credit kinds move no cash.
TRANSACTION_KINDS = (
    "income",            # cash sale / salary / allowance: revenue + cash in
    "expense",           # cash expense: expense + cash out
    "credit_sale",       # revenue + receivable, NO cash
    "customer_payment",  # cash in, settles a receivable, NOT revenue
    "credit_purchase",   # expense + payable, NO cash
    "supplier_payment",  # cash out, settles a payable, NOT an expense
    "loan_received",     # cash in, liability, NOT revenue
    "loan_repayment",    # cash out, reduces liability, NOT an expense
    "owner_withdrawal",  # cash out, NOT a business expense
    "transfer",          # move between accounts, no P&L effect
)


class Business(Base):
    __tablename__ = "businesses"
    __table_args__ = (
        UniqueConstraint("owner_id", name="uq_business_owner"),
        CheckConstraint(f"kind IN {BUSINESS_KINDS}", name="ck_business_kind"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(16))
    city: Mapped[str | None] = mapped_column(String(80), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="PKR")
    opening_date: Mapped[date] = mapped_column(Date)
    opening_cash_paisa: Mapped[int] = mapped_column(BigInteger, default=0)
    opening_bank_paisa: Mapped[int] = mapped_column(BigInteger, default=0)
    opening_wallet_paisa: Mapped[int] = mapped_column(BigInteger, default=0)
    cash_reserve_paisa: Mapped[int] = mapped_column(BigInteger, default=0)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    # Owner signed in anonymously ("private demo"): tighter limits, deleted after DEMO_TTL_DAYS unless upgraded.
    is_anonymous: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    demo_anchor: Mapped[date | None] = mapped_column(Date, nullable=True)
    ai_consent: Mapped[bool] = mapped_column(Boolean, default=False)
    language: Mapped[str] = mapped_column(String(5), default="en")
    recovery_weights: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Customer(Base):
    __tablename__ = "customers"
    __table_args__ = (UniqueConstraint("business_id", "name", name="uq_customer_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(String(240), nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Supplier(Base):
    __tablename__ = "suppliers"
    __table_args__ = (UniqueConstraint("business_id", "name", name="uq_supplier_name"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    category: Mapped[str | None] = mapped_column(String(60), nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Receivable(Base):
    """Money a customer owes (udhaar / invoice). Outstanding = amount - payments."""

    __tablename__ = "receivables"
    __table_args__ = (CheckConstraint("amount_paisa > 0", name="ck_receivable_amount"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    customer_id: Mapped[str] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    reference: Mapped[str | None] = mapped_column(String(40), nullable=True)
    description: Mapped[str | None] = mapped_column(String(240), nullable=True)
    issued_on: Mapped[date] = mapped_column(Date)
    due_on: Mapped[date] = mapped_column(Date)
    expected_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount_paisa: Mapped[int] = mapped_column(BigInteger)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    customer: Mapped[Customer] = relationship(lazy="joined")


class Payable(Base):
    """Money the business owes: supplier bills and scheduled obligations (rent, salaries)."""

    __tablename__ = "payables"
    __table_args__ = (CheckConstraint("amount_paisa > 0", name="ck_payable_amount"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    supplier_id: Mapped[str | None] = mapped_column(
        ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True
    )
    reference: Mapped[str | None] = mapped_column(String(40), nullable=True)
    description: Mapped[str | None] = mapped_column(String(240), nullable=True)
    category: Mapped[str] = mapped_column(String(60), default="Supplier Bill")
    issued_on: Mapped[date] = mapped_column(Date)
    due_on: Mapped[date] = mapped_column(Date)
    amount_paisa: Mapped[int] = mapped_column(BigInteger)
    is_essential: Mapped[bool] = mapped_column(Boolean, default=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    supplier: Mapped[Supplier | None] = relationship(lazy="joined")


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount_paisa > 0", name="ck_tx_amount_positive"),
        CheckConstraint(f"kind IN {TRANSACTION_KINDS}", name="ck_tx_kind"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    occurred_on: Mapped[date] = mapped_column(Date, index=True)
    kind: Mapped[str] = mapped_column(String(24))
    amount_paisa: Mapped[int] = mapped_column(BigInteger)
    account: Mapped[str | None] = mapped_column(String(10), nullable=True)
    to_account: Mapped[str | None] = mapped_column(String(10), nullable=True)
    category: Mapped[str] = mapped_column(String(60), default="Uncategorized")
    description: Mapped[str] = mapped_column(String(240), default="")
    customer_id: Mapped[str | None] = mapped_column(
        ForeignKey("customers.id", ondelete="SET NULL"), nullable=True
    )
    supplier_id: Mapped[str | None] = mapped_column(
        ForeignKey("suppliers.id", ondelete="SET NULL"), nullable=True
    )
    receivable_id: Mapped[str | None] = mapped_column(
        ForeignKey("receivables.id", ondelete="CASCADE"), nullable=True, index=True
    )
    payable_id: Mapped[str | None] = mapped_column(
        ForeignKey("payables.id", ondelete="CASCADE"), nullable=True, index=True
    )
    source: Mapped[str] = mapped_column(String(16), default="manual")
    import_batch_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("business_id", "sku", name="uq_product_sku"),
        CheckConstraint("unit_cost_paisa >= 0", name="ck_product_cost"),
        CheckConstraint("sale_price_paisa >= 0", name="ck_product_price"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    sku: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(120))
    unit: Mapped[str] = mapped_column(String(16), default="pcs")
    unit_cost_paisa: Mapped[int] = mapped_column(BigInteger, default=0)
    sale_price_paisa: Mapped[int] = mapped_column(BigInteger, default=0)
    reorder_level: Mapped[int] = mapped_column(Integer, default=0)
    lead_time_days: Mapped[int] = mapped_column(Integer, default=3)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class InventoryMovement(Base):
    """Signed stock movement: opening/purchase are positive, sale is negative."""

    __tablename__ = "inventory_movements"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    product_id: Mapped[str] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    occurred_on: Mapped[date] = mapped_column(Date)
    movement_type: Mapped[str] = mapped_column(String(16))  # opening|purchase|sale|adjustment
    quantity: Mapped[int] = mapped_column(Integer)
    unit_value_paisa: Mapped[int] = mapped_column(BigInteger, default=0)
    transaction_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    note: Mapped[str | None] = mapped_column(String(240), nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ForecastRun(Base):
    """A persisted forecast summary, one per business per day (latest inputs win)."""

    __tablename__ = "forecast_runs"
    __table_args__ = (UniqueConstraint("business_id", "run_date", name="uq_forecast_day"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    run_date: Mapped[date] = mapped_column(Date)
    input_hash: Mapped[str] = mapped_column(String(64))
    model_name: Mapped[str] = mapped_column(String(40))
    horizon_days: Mapped[int] = mapped_column(Integer)
    opening_balance_paisa: Mapped[int] = mapped_column(BigInteger)
    min_balance_paisa: Mapped[int] = mapped_column(BigInteger)
    shortage_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    summary: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RiskAlert(Base):
    """Alert state. Alerts are recomputed from data; status (acknowledged) persists."""

    __tablename__ = "risk_alerts"
    __table_args__ = (
        UniqueConstraint("business_id", "rule", "entity_key", name="uq_alert_rule_entity"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    rule: Mapped[str] = mapped_column(String(40))
    entity_key: Mapped[str] = mapped_column(String(80))
    level: Mapped[str] = mapped_column(String(10))
    score: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(14), default="open")
    first_detected_on: Mapped[date] = mapped_column(Date)
    last_detected_on: Mapped[date] = mapped_column(Date)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)


class FinancialScenario(Base):
    __tablename__ = "financial_scenarios"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(400), nullable=True)
    kind: Mapped[str] = mapped_column(String(12), default="shock")  # shock|what_if
    adjustments: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    last_result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    actions: Mapped[list["ScenarioAction"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )


class ScenarioAction(Base):
    """A recovery action chosen for a scenario."""

    __tablename__ = "scenario_actions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    scenario_id: Mapped[str] = mapped_column(
        ForeignKey("financial_scenarios.id", ondelete="CASCADE"), index=True
    )
    action_type: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(200))
    params: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(200))
    adapter: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(12), default="preview")
    rows: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    summary: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class AuditEvent(Base):
    """Append-only change history for ledger records (who changed what, before -> after)."""

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    entity_type: Mapped[str] = mapped_column(String(24))  # transaction|receivable|payable|import_batch
    entity_id: Mapped[str] = mapped_column(String(36), index=True)
    action: Mapped[str] = mapped_column(String(16))  # create|update|delete|payment|import
    actor_id: Mapped[str] = mapped_column(String(64))
    changes: Mapped[dict[str, Any]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class AiUsage(Base):
    """Per-business daily AI call counter (durable across serverless instances)."""

    __tablename__ = "ai_usage"
    __table_args__ = (UniqueConstraint("business_id", "day", "task", name="uq_ai_usage_day_task"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    business_id: Mapped[str] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )
    day: Mapped[date] = mapped_column(Date)
    task: Mapped[str] = mapped_column(String(24))
    calls: Mapped[int] = mapped_column(Integer, default=0)
