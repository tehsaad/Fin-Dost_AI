"""Inventory and demand intelligence (kept deliberately simple and explainable).

* Quantity on hand is the sum of signed stock movements.
* Demand = average units sold per day over the last 28 days of sales movements.
* Replenishment is only suggested with at least 14 days of sales history;
  otherwise the product is marked "insufficient data".
* Nothing here creates or changes financial transactions.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta

import numpy as np

from .snapshot import Snapshot

DEMAND_WINDOW = 28
MIN_HISTORY_DAYS = 14
SAFETY_DAYS = 3
TARGET_COVER_DAYS = 14
SLOW_MOVING_DAYS = 60


def inventory_analytics(snap: Snapshot, today: date) -> dict:
    qty: dict[str, int] = defaultdict(int)
    first_sale: dict[str, date] = {}
    sold_window: dict[str, int] = defaultdict(int)
    sold_value: dict[str, int] = defaultdict(int)
    weekly: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    window_start = today - timedelta(days=DEMAND_WINDOW)
    for m in snap.movements:
        if m.occurred_on > today:
            continue
        qty[m.product_id] += m.quantity
        if m.movement_type == "sale":
            first_sale[m.product_id] = min(first_sale.get(m.product_id, m.occurred_on), m.occurred_on)
            if m.occurred_on > window_start:
                sold_window[m.product_id] += -m.quantity
                sold_value[m.product_id] += -m.quantity * m.unit_value
                weekly[m.product_id][(today - m.occurred_on).days // 7] += -m.quantity

    total_value = 0
    rows = []
    for p in snap.products:
        on_hand = max(qty.get(p.id, 0), 0)
        value = on_hand * p.unit_cost
        total_value += value
        history_days = (today - first_sale[p.id]).days if p.id in first_sale else 0
        window_days = min(DEMAND_WINDOW, history_days) if history_days else 0
        daily_demand = sold_window.get(p.id, 0) / window_days if window_days else 0.0
        weeks = [weekly[p.id].get(i, 0) for i in range(4)]
        variability = float(np.std(weeks) / np.mean(weeks)) if np.mean(weeks) > 0 else None
        days_cover = on_hand / daily_demand if daily_demand > 0 else None
        margin_pct = ((p.sale_price - p.unit_cost) / p.sale_price * 100) if p.sale_price else None
        realized_price = sold_value[p.id] / sold_window[p.id] if sold_window.get(p.id) else None
        realized_margin = ((realized_price - p.unit_cost) / realized_price * 100) if realized_price else None

        sufficient = history_days >= MIN_HISTORY_DAYS and daily_demand > 0
        reorder_qty = None
        reorder_note = "insufficient sales history (needs 14+ days) - no suggestion"
        if sufficient:
            target = daily_demand * (p.lead_time_days + TARGET_COVER_DAYS + SAFETY_DAYS)
            reorder_qty = max(int(math.ceil(target - on_hand)), 0)
            reorder_note = (f"~{daily_demand:.1f}/day x ({p.lead_time_days} lead + {TARGET_COVER_DAYS} cover "
                            f"+ {SAFETY_DAYS} safety days) - {on_hand} on hand")
        elif history_days == 0:
            reorder_note = "no sales recorded yet - no suggestion"
        low_stock = on_hand <= p.reorder_level
        slow = days_cover is not None and days_cover > SLOW_MOVING_DAYS
        if on_hand > 0 and daily_demand == 0 and history_days >= MIN_HISTORY_DAYS:
            slow = True
        rows.append({
            "id": p.id, "sku": p.sku, "name": p.name, "unit": p.unit,
            "quantity": on_hand, "reorder_level": p.reorder_level, "lead_time_days": p.lead_time_days,
            "unit_cost_paisa": p.unit_cost, "sale_price_paisa": p.sale_price,
            "stock_value_paisa": value,
            "gross_margin_pct": round(margin_pct, 1) if margin_pct is not None else None,
            "realized_margin_pct": round(realized_margin, 1) if realized_margin is not None else None,
            "daily_demand": round(daily_demand, 2),
            "demand_variability": round(variability, 2) if variability is not None else None,
            "sales_history_days": history_days,
            "days_of_cover": round(days_cover) if days_cover is not None else None,
            "low_stock": low_stock,
            "slow_moving": slow,
            "reorder_suggestion": reorder_qty,
            "reorder_note": reorder_note,
            "sufficient_data": sufficient,
        })
    for r in rows:
        r["value_share_pct"] = round(r["stock_value_paisa"] / total_value * 100, 1) if total_value else 0.0
        r["high_exposure"] = r["value_share_pct"] >= 15 and (r["slow_moving"] or (r["days_of_cover"] or 0) > 45)
    rows.sort(key=lambda r: -r["stock_value_paisa"])
    return {
        "total_value_paisa": total_value,
        "product_count": len(rows),
        "low_stock_count": sum(r["low_stock"] for r in rows),
        "slow_moving_count": sum(r["slow_moving"] for r in rows),
        "products": rows,
        "assumptions": [
            f"Demand is the average daily units sold over the last {DEMAND_WINDOW} days of recorded sales.",
            f"Reorder suggestions cover lead time + {TARGET_COVER_DAYS} days + {SAFETY_DAYS} safety days, "
            f"and are only shown with {MIN_HISTORY_DAYS}+ days of sales history.",
            f"'Slow-moving' means more than {SLOW_MOVING_DAYS} days of stock at the current sales rate.",
            "Stock value uses purchase cost. Inventory analytics never change your ledger.",
        ],
    }
