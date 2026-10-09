"""Inventory and demand intelligence (SME and Enterprise accounts)."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..auth import require_feature
from ..config import today as get_today
from ..db import get_db
from ..errors import ApiError
from ..models import Business, InventoryMovement, Product, Transaction
from ..schemas import MovementIn, ProductIn, ProductUpdate
from ..services.ingestion import dedupe_key
from ..services.inventory import inventory_analytics
from .common import context, owned

router = APIRouter(tags=["inventory"])


@router.get("/inventory")
def inventory(business: Business = Depends(require_feature("inventory")), db: Session = Depends(get_db)):
    snap, today = context(db, business)
    data = inventory_analytics(snap, today)
    recent = db.scalars(select(InventoryMovement).where(InventoryMovement.business_id == business.id)
                        .order_by(InventoryMovement.occurred_on.desc(), InventoryMovement.created_at.desc()).limit(15)).all()
    names = {p.id: p.name for p in snap.products}
    data["recent_movements"] = [{"id": m.id, "product": names.get(m.product_id), "date": m.occurred_on.isoformat(),
                                 "type": m.movement_type, "quantity": m.quantity, "unit_value_paisa": m.unit_value_paisa,
                                 "note": m.note} for m in recent]
    return data


@router.post("/inventory/products", status_code=201)
def create_product(body: ProductIn, business: Business = Depends(require_feature("inventory")),
                   db: Session = Depends(get_db)):
    if db.scalar(select(Product).where(Product.business_id == business.id, Product.sku == body.sku)):
        raise ApiError(409, "duplicate", f"SKU {body.sku} already exists")
    p = Product(business_id=business.id, sku=body.sku, name=body.name, unit=body.unit or "pcs",
                unit_cost_paisa=body.unit_cost_paisa, sale_price_paisa=body.sale_price_paisa,
                reorder_level=body.reorder_level, lead_time_days=body.lead_time_days)
    db.add(p)
    db.flush()
    if body.opening_quantity:
        db.add(InventoryMovement(business_id=business.id, product_id=p.id, occurred_on=get_today(),
                                 movement_type="opening", quantity=body.opening_quantity,
                                 unit_value_paisa=body.unit_cost_paisa, note="Opening stock"))
    db.commit()
    return {"id": p.id, "sku": p.sku, "name": p.name}


@router.put("/inventory/products/{product_id}")
def update_product(product_id: str, body: ProductUpdate, business: Business = Depends(require_feature("inventory")),
                   db: Session = Depends(get_db)):
    p = owned(db, Product, product_id, business, "Product")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(p, k, v)
    db.commit()
    return {"id": p.id, "sku": p.sku, "name": p.name}


@router.delete("/inventory/products/{product_id}", status_code=204)
def delete_product(product_id: str, business: Business = Depends(require_feature("inventory")),
                   db: Session = Depends(get_db)):
    db.delete(owned(db, Product, product_id, business, "Product"))
    db.commit()


@router.post("/inventory/movements", status_code=201)
def record_movement(body: MovementIn, business: Business = Depends(require_feature("inventory")),
                    db: Session = Depends(get_db)):
    p = owned(db, Product, body.product_id, business, "Product")
    when = body.occurred_on or get_today()
    qty = abs(body.quantity)
    signed = qty if body.movement_type == "purchase" else -qty if body.movement_type == "sale" else body.quantity
    on_hand = int(db.scalar(select(func.coalesce(func.sum(InventoryMovement.quantity), 0))
                            .where(InventoryMovement.product_id == p.id)) or 0)
    if on_hand + signed < 0:
        raise ApiError(422, "insufficient_stock", f"Only {on_hand} {p.unit} of {p.name} in stock")
    unit_value = body.unit_value_paisa if body.unit_value_paisa is not None else (
        p.sale_price_paisa if body.movement_type == "sale" else p.unit_cost_paisa)
    tx_id = None
    # Stock movements never change the ledger silently; only when the user asks explicitly.
    if body.record_in_ledger and body.movement_type in ("purchase", "sale"):
        kind = "income" if body.movement_type == "sale" else "expense"
        desc = f"{'Sale' if kind == 'income' else 'Stock purchase'}: {qty} {p.unit} {p.name}"
        tx = Transaction(business_id=business.id, occurred_on=when, kind=kind, amount_paisa=max(qty * unit_value, 1),
                         account=body.account, category="Sales" if kind == "income" else "Inventory Purchase",
                         description=desc, source="manual")
        tx.dedupe_key = dedupe_key(when, tx.amount_paisa, kind, desc)
        db.add(tx)
        db.flush()
        tx_id = tx.id
    m = InventoryMovement(business_id=business.id, product_id=p.id, occurred_on=when, movement_type=body.movement_type,
                          quantity=signed, unit_value_paisa=unit_value, note=body.note, transaction_id=tx_id)
    db.add(m)
    db.commit()
    return {"id": m.id, "quantity_on_hand": on_hand + signed, "transaction_id": tx_id}
