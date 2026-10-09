"""CSV import wizard: preview (validate, normalize, categorize, dedupe) then confirm."""
from __future__ import annotations

import json
from datetime import date

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import FEATURES, require_feature
from ..config import get_settings
from ..db import get_db
from ..errors import ApiError
from ..models import Business, ImportBatch, Payable, Receivable, Transaction
from ..schemas import ImportConfirmIn
from ..services.ingestion import TEMPLATES, IngestionError, build_preview, dedupe_key, read_csv
from .common import context, get_or_create_customer, get_or_create_supplier, owned

router = APIRouter(tags=["import"])

ALLOWED_TYPES = {"text/csv", "application/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream", ""}


@router.get("/import/templates/{name}")
def template(name: str):
    if name not in TEMPLATES:
        raise ApiError(404, "not_found", "Template not found")
    return Response(TEMPLATES[name], media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.post("/import/preview")
async def preview(file: UploadFile = File(...), mapping: str | None = Form(default=None),
                  business: Business = Depends(require_feature("import")), db: Session = Depends(get_db)):
    name = (file.filename or "upload.csv")[:200]
    if not name.lower().endswith(".csv"):
        raise ApiError(415, "unsupported_file", "Only .csv files are supported (export Excel sheets as CSV)")
    if (file.content_type or "") not in ALLOWED_TYPES:
        raise ApiError(415, "unsupported_file", f"Unexpected file type {file.content_type}")
    limit = get_settings().max_upload_bytes
    content = await file.read(limit + 1)
    if len(content) > limit:
        raise ApiError(413, "file_too_large", f"File is larger than {limit // 1024} KB")
    try:
        mapping_dict = json.loads(mapping) if mapping else None
        if mapping_dict is not None and not isinstance(mapping_dict, dict):
            raise ValueError
    except ValueError:
        raise ApiError(422, "validation_error", "mapping must be a JSON object of field -> column")
    snap, today = context(db, business)
    existing = {dedupe_key(t.occurred_on, t.amount, t.kind, t.description) for t in snap.txs}
    history = [(t.description, t.category) for t in snap.txs if t.source != "demo"][-300:]
    try:
        headers, rows = read_csv(content)
        result = build_preview(headers, rows, today, existing, history, mapping_dict)
    except IngestionError as exc:
        raise ApiError(422, "invalid_csv", str(exc))
    batch = ImportBatch(business_id=business.id, filename=name, adapter=result["adapter"], status="preview",
                        rows=result["rows"], summary=result["summary"])
    db.add(batch)
    db.commit()
    return {"batch_id": batch.id, "filename": name, **result}


@router.post("/import/confirm")
def confirm(body: ImportConfirmIn, business: Business = Depends(require_feature("import")), db: Session = Depends(get_db)):
    batch = owned(db, ImportBatch, body.batch_id, business, "Import batch")
    if batch.status != "preview":
        raise ApiError(409, "already_processed", f"This import was already {batch.status}")
    snap, _ = context(db, business)
    existing = {dedupe_key(t.occurred_on, t.amount, t.kind, t.description) for t in snap.txs}
    excluded = set(body.exclude_rows)
    imported = skipped_dup = skipped_user = rejected = 0
    has_receivables = "receivables" in FEATURES[business.kind]
    for row in batch.rows:
        if row["status"] == "rejected":
            rejected += 1
            continue
        if row["status"] == "duplicate" or row["dedupe_key"] in existing:
            skipped_dup += 1
            continue
        if row["row_number"] in excluded:
            skipped_user += 1
            continue
        kind = row["kind"]
        when = date.fromisoformat(row["date"])
        tx = Transaction(business_id=business.id, occurred_on=when, kind=kind, amount_paisa=row["amount_paisa"],
                         category=row["category"] or "Uncategorized", description=row["description"] or "",
                         source="import", import_batch_id=batch.id, dedupe_key=row["dedupe_key"])
        if kind in ("credit_sale", "customer_payment"):
            if not has_receivables:
                rejected += 1
                continue
            cust = get_or_create_customer(db, business, None, row["party"])
            tx.customer_id = cust.id
            if kind == "credit_sale":
                rec = Receivable(business_id=business.id, customer_id=cust.id, reference=row.get("reference"),
                                 description=row["description"] or None, issued_on=when,
                                 due_on=date.fromisoformat(row["due_date"]), amount_paisa=row["amount_paisa"])
                db.add(rec)
                db.flush()
                tx.receivable_id = rec.id
            else:
                # apply to the customer's oldest open receivable if one exists, else record as income
                open_rec = next((r for r in snap.receivables if r.customer_id == cust.id and r.outstanding >= row["amount_paisa"]), None)
                if open_rec:
                    tx.receivable_id = open_rec.id
                else:
                    tx.kind = "income"
                tx.account = row["account"] or "cash"
        elif kind in ("credit_purchase", "supplier_payment"):
            sup = get_or_create_supplier(db, business, None, row["party"], row["category"])
            tx.supplier_id = sup.id if sup else None
            if kind == "credit_purchase":
                pay = Payable(business_id=business.id, supplier_id=tx.supplier_id, reference=row.get("reference"),
                              description=row["description"] or None, category=row["category"] or "Supplier Bill",
                              issued_on=when, due_on=date.fromisoformat(row["due_date"]), amount_paisa=row["amount_paisa"])
                db.add(pay)
                db.flush()
                tx.payable_id = pay.id
            else:
                open_pay = next((p for p in snap.payables if p.supplier_id == tx.supplier_id and p.outstanding >= row["amount_paisa"]), None)
                if open_pay:
                    tx.payable_id = open_pay.id
                else:
                    tx.kind = "expense"
                tx.account = row["account"] or "cash"
        else:
            tx.account = row["account"] or "cash"
        db.add(tx)
        existing.add(row["dedupe_key"])
        imported += 1
    batch.status = "confirmed"
    batch.summary = {**batch.summary, "imported": imported, "skipped_duplicates": skipped_dup,
                     "skipped_by_user": skipped_user, "rejected": rejected}
    db.commit()
    return {"batch_id": batch.id, "imported": imported, "skipped_duplicates": skipped_dup,
            "skipped_by_user": skipped_user, "rejected": rejected}


@router.get("/import/batches")
def batches(business: Business = Depends(require_feature("import")), db: Session = Depends(get_db)):
    rows = db.scalars(select(ImportBatch).where(ImportBatch.business_id == business.id)
                      .order_by(ImportBatch.created_at.desc()).limit(20)).all()
    return {"items": [{"id": b.id, "filename": b.filename, "status": b.status, "adapter": b.adapter,
                       "summary": b.summary, "created_at": b.created_at.isoformat()} for b in rows]}
