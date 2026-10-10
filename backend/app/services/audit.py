"""Ledger change history. Each event stores only the fields that changed (before -> after)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from ..models import AuditEvent, Business

TRACKED = {
    "transaction": ("occurred_on", "kind", "amount_paisa", "account", "to_account", "category", "description",
                    "customer_id", "supplier_id", "receivable_id", "payable_id", "source"),
    "receivable": ("customer_id", "reference", "description", "issued_on", "due_on", "expected_on", "amount_paisa"),
    "payable": ("supplier_id", "reference", "description", "category", "issued_on", "due_on", "amount_paisa",
                "is_essential"),
}


def _plain(value: Any) -> Any:
    return value.isoformat() if isinstance(value, (date, datetime)) else value


def snapshot(entity_type: str, obj: Any) -> dict[str, Any]:
    return {f: _plain(getattr(obj, f)) for f in TRACKED[entity_type]}


def record(db: Session, business: Business, entity_type: str, entity_id: str, action: str,
           before: dict[str, Any] | None = None, after: dict[str, Any] | None = None,
           extra: dict[str, Any] | None = None) -> None:
    before, after = before or {}, after or {}
    if action == "update":
        changed = {k: {"from": before.get(k), "to": after.get(k)} for k in after if before.get(k) != after.get(k)}
        if not changed:
            return
        changes: dict[str, Any] = {"fields": changed}
    elif action == "delete":
        changes = {"before": before}
    else:
        changes = {"after": after} if after else {}
    if extra:
        changes.update(extra)
    db.add(AuditEvent(business_id=business.id, entity_type=entity_type, entity_id=entity_id, action=action,
                      actor_id=business.owner_id, changes=changes))

