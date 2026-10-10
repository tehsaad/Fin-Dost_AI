"""Shared helpers for routers: snapshot loading, forecast persistence, lookups."""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import FEATURES
from ..config import today as get_today
from ..errors import ApiError, not_found
from ..models import Business, Customer, ForecastRun, Supplier
from ..services.forecast import input_hash, run_forecast
from ..services.snapshot import Snapshot, load_snapshot


def context(db: Session, business: Business) -> tuple[Snapshot, date]:
    return load_snapshot(db, business), get_today()


def features(business: Business) -> frozenset[str]:
    return FEATURES.get(business.kind, frozenset())


def forecast_and_store(db: Session, business: Business, snap: Snapshot, today: date, horizon: int = 30) -> dict:
    result = run_forecast(snap, today, horizon)
    if horizon == 30:
        h = input_hash(snap, today)
        run = db.scalar(select(ForecastRun).where(ForecastRun.business_id == business.id, ForecastRun.run_date == today))
        s = result["summary"]
        if run is None or run.input_hash != h:
            if run is None:
                run = ForecastRun(business_id=business.id, run_date=today)
                db.add(run)
            run.input_hash = h
            run.model_name = result["model"].get("name", "none")
            run.horizon_days = horizon
            run.opening_balance_paisa = s["opening_balance_paisa"]
            run.min_balance_paisa = s["min_balance_paisa"]
            run.shortage_date = date.fromisoformat(s["shortage_date"]) if s["shortage_date"] else None
            run.summary = {k: v for k, v in s.items() if k != "flows_by_source_paisa"}
            db.commit()
    return result


def check_capacity(db: Session, business: Business, adding: int = 1) -> None:
    """Private demo workspaces have a transaction cap so anonymous visitors cannot grow the database unbounded."""
    if not business.is_anonymous:
        return
    from sqlalchemy import func

    from ..config import get_settings
    from ..models import Transaction

    cap = get_settings().anon_max_transactions
    count = db.scalar(select(func.count()).select_from(Transaction).where(Transaction.business_id == business.id)) or 0
    if count + adding > cap:
        raise ApiError(403, "demo_limit", f"Private demo workspaces hold up to {cap:,} transactions. "
                                          "Create a free account in Settings to keep adding records.")


def get_or_create_customer(db: Session, business: Business, customer_id: str | None, name: str | None) -> Customer:
    if customer_id:
        c = db.get(Customer, customer_id)
        if c is None or c.business_id != business.id:
            raise not_found("Customer")
        return c
    if not name:
        raise ApiError(422, "validation_error", "A customer name or customer_id is required")
    c = db.scalar(select(Customer).where(Customer.business_id == business.id, Customer.name == name))
    if c is None:
        c = Customer(business_id=business.id, name=name)
        db.add(c)
        db.flush()
    return c


def get_or_create_supplier(db: Session, business: Business, supplier_id: str | None, name: str | None,
                           category: str | None = None) -> Supplier | None:
    if supplier_id:
        s = db.get(Supplier, supplier_id)
        if s is None or s.business_id != business.id:
            raise not_found("Supplier")
        return s
    if not name:
        return None
    s = db.scalar(select(Supplier).where(Supplier.business_id == business.id, Supplier.name == name))
    if s is None:
        s = Supplier(business_id=business.id, name=name, category=category)
        db.add(s)
        db.flush()
    return s


def owned(db: Session, model, obj_id: str, business: Business, what: str, lock: bool = False):
    """Load a record of this business or 404. ``lock`` takes a row lock (Postgres) so concurrent
    payments against the same invoice are serialised."""
    # "of" keeps FOR UPDATE off the eagerly outer-joined customer/supplier tables (Postgres rejects that).
    obj = (db.get(model, obj_id, with_for_update={"of": model}, populate_existing=True) if lock
           else db.get(model, obj_id))
    if obj is None or getattr(obj, "business_id", None) != business.id:
        raise not_found(what)
    return obj


def csv_safe(value):
    """Neutralise spreadsheet formula injection in exported text cells."""
    if isinstance(value, str) and value and value[0] in "=+-@\t\r":
        return "'" + value
    return value
