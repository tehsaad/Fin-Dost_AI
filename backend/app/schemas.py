"""Request schemas (validated by Pydantic; invalid input returns 422 with field details)."""
from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Kind = Literal["sme", "student", "household", "enterprise"]
Account = Literal["cash", "bank", "wallet"]
TxKind = Literal["income", "expense", "credit_sale", "customer_payment", "credit_purchase", "supplier_payment",
                 "loan_received", "loan_repayment", "owner_withdrawal", "transfer"]
MAX_PAISA = 10**13  # Rs. 100 billion - sanity bound


class _Base(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")


class OnboardingIn(_Base):
    kind: Kind
    business_name: str = Field(min_length=1, max_length=120)
    city: str | None = Field(default=None, max_length=80)
    load_demo: bool = True


class BusinessUpdate(_Base):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    city: str | None = Field(default=None, max_length=80)
    cash_reserve_paisa: int | None = Field(default=None, ge=0, le=MAX_PAISA)
    opening_cash_paisa: int | None = Field(default=None, ge=-MAX_PAISA, le=MAX_PAISA)
    opening_bank_paisa: int | None = Field(default=None, ge=-MAX_PAISA, le=MAX_PAISA)
    opening_wallet_paisa: int | None = Field(default=None, ge=-MAX_PAISA, le=MAX_PAISA)
    opening_date: date | None = None
    ai_consent: bool | None = None
    language: Literal["en", "ur"] | None = None
    recovery_weights: dict[str, float] | None = None

    @field_validator("recovery_weights")
    @classmethod
    def _weights(cls, v: dict[str, float] | None):
        if v is None:
            return v
        allowed = {"liquidity", "feasibility", "cost", "risk"}
        if set(v) - allowed:
            raise ValueError(f"weights must be among {sorted(allowed)}")
        if any(x < 0 or x > 10 for x in v.values()):
            raise ValueError("weights must be between 0 and 10")
        return v


class TransactionIn(_Base):
    occurred_on: date
    kind: TxKind
    amount_paisa: int = Field(gt=0, le=MAX_PAISA)
    account: Account | None = None
    to_account: Account | None = None
    category: str = Field(default="", max_length=60)
    description: str = Field(default="", max_length=240)
    customer_id: str | None = None
    customer_name: str | None = Field(default=None, max_length=120)
    supplier_id: str | None = None
    supplier_name: str | None = Field(default=None, max_length=120)
    receivable_id: str | None = None
    payable_id: str | None = None
    due_on: date | None = None
    reference: str | None = Field(default=None, max_length=40)


class TransactionUpdate(_Base):
    occurred_on: date | None = None
    amount_paisa: int | None = Field(default=None, gt=0, le=MAX_PAISA)
    account: Account | None = None
    to_account: Account | None = None
    category: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=240)


class PaymentIn(_Base):
    amount_paisa: int = Field(gt=0, le=MAX_PAISA)
    occurred_on: date | None = None
    account: Account = "cash"
    note: str | None = Field(default=None, max_length=200)


class ReceivableIn(_Base):
    customer_id: str | None = None
    customer_name: str | None = Field(default=None, max_length=120)
    amount_paisa: int = Field(gt=0, le=MAX_PAISA)
    issued_on: date
    due_on: date
    reference: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=240)
    record_sale: bool = True


class ReceivableUpdate(_Base):
    due_on: date | None = None
    expected_on: date | None = None
    description: str | None = Field(default=None, max_length=240)


class PayableIn(_Base):
    supplier_id: str | None = None
    supplier_name: str | None = Field(default=None, max_length=120)
    category: str = Field(default="Supplier Bill", min_length=1, max_length=60)
    amount_paisa: int = Field(gt=0, le=MAX_PAISA)
    issued_on: date
    due_on: date
    reference: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=240)
    is_essential: bool = True
    record_purchase: bool = False


class PayableUpdate(_Base):
    due_on: date | None = None
    is_essential: bool | None = None
    description: str | None = Field(default=None, max_length=240)


class CustomerIn(_Base):
    name: str = Field(min_length=1, max_length=120)
    notes: str | None = Field(default=None, max_length=240)


class SupplierIn(_Base):
    name: str = Field(min_length=1, max_length=120)
    category: str | None = Field(default=None, max_length=60)


class Adjustments(_Base):
    adjustments: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    horizon: int = Field(default=30, ge=7, le=90)


class ScenarioIn(_Base):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=400)
    kind: Literal["shock", "what_if"] = "shock"
    adjustments: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    actions: list[dict[str, Any]] = Field(default_factory=list, max_length=10)


class CompareScenariosIn(_Base):
    scenario_ids: list[str] = Field(min_length=2, max_length=4)
    horizon: int = Field(default=30, ge=7, le=90)


class RecoveryIn(_Base):
    scenario_id: str | None = None
    adjustments: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    weights: dict[str, float] | None = None
    horizon: int = Field(default=30, ge=7, le=90)


class StrategySpec(_Base):
    id: str = Field(min_length=1, max_length=60)
    label: str | None = Field(default=None, max_length=200)
    adjustments: list[dict[str, Any]] = Field(default_factory=list, max_length=10)


class RecoveryCompareIn(_Base):
    scenario_id: str | None = None
    adjustments: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    strategies: list[StrategySpec] = Field(min_length=1, max_length=6)
    horizon: int = Field(default=30, ge=7, le=90)


class ProductIn(_Base):
    sku: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    unit: str = Field(default="pcs", max_length=16)
    unit_cost_paisa: int = Field(ge=0, le=MAX_PAISA)
    sale_price_paisa: int = Field(ge=0, le=MAX_PAISA)
    reorder_level: int = Field(default=0, ge=0, le=10**7)
    lead_time_days: int = Field(default=3, ge=0, le=180)
    opening_quantity: int = Field(default=0, ge=0, le=10**7)


class ProductUpdate(_Base):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    unit: str | None = Field(default=None, max_length=16)
    unit_cost_paisa: int | None = Field(default=None, ge=0, le=MAX_PAISA)
    sale_price_paisa: int | None = Field(default=None, ge=0, le=MAX_PAISA)
    reorder_level: int | None = Field(default=None, ge=0, le=10**7)
    lead_time_days: int | None = Field(default=None, ge=0, le=180)


class MovementIn(_Base):
    product_id: str
    movement_type: Literal["purchase", "sale", "adjustment"]
    quantity: int = Field(ge=-10**7, le=10**7)
    unit_value_paisa: int | None = Field(default=None, ge=0, le=MAX_PAISA)
    occurred_on: date | None = None
    note: str | None = Field(default=None, max_length=240)
    record_in_ledger: bool = False
    account: Account = "cash"

    @field_validator("quantity")
    @classmethod
    def _nonzero(cls, v: int):
        if v == 0:
            raise ValueError("quantity cannot be zero")
        return v


class CopilotIn(_Base):
    question: str = Field(min_length=1, max_length=500)
    language: Literal["en", "ur"] | None = None
    use_llm: bool = True


class ImportConfirmIn(_Base):
    batch_id: str
    exclude_rows: list[int] = Field(default_factory=list, max_length=5000)
