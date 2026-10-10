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
from ..schemas import ImportConfirmIn, RowCorrectionIn
from ..services import ai, audit
from ..services.ai import tasks as ai_tasks
from ..services.categories import categorize
from ..services.ingestion import (TEMPLATES, IngestionError, Settler, annotate_settlements, build_preview, correct_row,
                                  dedupe_key, read_csv, summarize)
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
    annotate_settlements(result["rows"], snap.receivables, snap.payables, snap.customers, snap.suppliers)
    batch = ImportBatch(business_id=business.id, filename=name, adapter=result["adapter"], status="preview",
                        rows=result["rows"], summary=result["summary"])
    db.add(batch)
    db.commit()
    return {"batch_id": batch.id, "filename": name, **result}


MAX_RECEIPT_BYTES = 4 * 1024 * 1024  # Vercel request bodies are capped at 4.5 MB
_MAGIC = {"image/jpeg": (b"\xff\xd8\xff",), "image/png": (b"\x89PNG",), "application/pdf": (b"%PDF",), "image/webp": (b"RIFF",)}


@router.post("/import/receipt")
async def receipt(file: UploadFile = File(...), business: Business = Depends(require_feature("import")),
                  db: Session = Depends(get_db)):
    """Read a receipt/invoice photo or PDF with AI into a preview row. Nothing is saved to the ledger:
    the user reviews (and can correct) the row, then confirms it like any CSV import."""
    if not business.ai_consent:
        raise ApiError(403, "ai_consent_required",
                       "Turn on AI assistance in Settings first: the document is sent to Google Gemini to be read.")
    if not ai.status()["tasks"]["extract_receipt"]["available"]:
        raise ApiError(503, "ai_unavailable", "Receipt reading is not configured on this server. CSV import still works.")
    mime = (file.content_type or "").lower()
    if mime not in ai_tasks.ALLOWED_MIME:
        raise ApiError(415, "unsupported_file", "Upload a JPG, PNG or WEBP photo, or a PDF")
    content = await file.read(MAX_RECEIPT_BYTES + 1)
    if len(content) > MAX_RECEIPT_BYTES:
        raise ApiError(413, "file_too_large", "File is larger than 4 MB. Take a smaller photo.")
    if not content.startswith(_MAGIC[mime]) or (mime == "image/webp" and content[8:12] != b"WEBP"):
        raise ApiError(415, "unsupported_file", "The file content does not match its type")
    snap, today = context(db, business)
    ai.consume_quota(db, business, "extract_receipt", today)
    try:
        prop = ai_tasks.extract_receipt(content, mime, today)
    except ai.AIError as exc:
        status = 429 if exc.code == "rate_limited" else 502
        raise ApiError(status, f"ai_{exc.code}", f"Could not read the document: {exc}. You can enter it manually.")
    kind = "income" if prop["direction"] == "money_in" else "expense"
    description = " ".join(x for x in [prop["merchant"], prop["document_type"]] if x)[:240]
    history = [(t.description, t.category) for t in snap.txs if t.source != "demo"][-300:]
    category, reason, _ = categorize(" ".join([description] + [li["description"] for li in prop["line_items"]]),
                                     "in" if kind == "income" else "out", history)
    row = {"row_number": 1, "raw": {}, "status": "rejected" if prop["problems"] else "accepted",
           "reasons": list(prop["problems"]), "warnings": prop["warnings"], "date": prop["date"], "kind": kind,
           "amount_paisa": prop["amount_paisa"], "account": "cash", "category": category,
           "category_reason": f"auto: {reason}", "description": description, "party": None, "due_date": None,
           "reference": None, "dedupe_key": None, "ai_extracted": True, "confidence": prop["confidence"]}
    if row["status"] == "accepted":
        key = dedupe_key(date.fromisoformat(row["date"]), row["amount_paisa"], kind, description)
        row["dedupe_key"] = key
        if key in {dedupe_key(t.occurred_on, t.amount, t.kind, t.description) for t in snap.txs}:
            row["status"], row["reasons"] = "duplicate", ["already in your ledger"]
    name = (file.filename or "receipt")[:200]
    batch = ImportBatch(business_id=business.id, filename=name, adapter="receipt_ai", status="preview",
                        rows=[row], summary=summarize([row]))
    db.add(batch)
    db.commit()
    return {"batch_id": batch.id, "filename": name, "adapter": "receipt_ai",
            "adapter_label": f"Receipt read by AI ({prop['provider']})", "mapping": {}, "headers": [], "day_first": True,
            "rows": [row], "summary": batch.summary, "extraction": prop}


@router.put("/import/batches/{batch_id}/rows/{row_number}")
def correct_import_row(batch_id: str, row_number: int, body: RowCorrectionIn,
                       business: Business = Depends(require_feature("import")), db: Session = Depends(get_db)):
    """Fix a parsed row before importing. The row is validated again; nothing is saved to the ledger yet."""
    batch = owned(db, ImportBatch, batch_id, business, "Import batch")
    if batch.status != "preview":
        raise ApiError(409, "already_processed", f"This import was already {batch.status}")
    rows = [dict(r) for r in batch.rows]
    pos = next((i for i, r in enumerate(rows) if r["row_number"] == row_number), None)
    if pos is None:
        raise ApiError(404, "not_found", "Row not found in this import")
    changes = body.model_dump(exclude_unset=True)
    for k in ("date", "due_date"):
        if changes.get(k) is not None:
            changes[k] = changes[k].isoformat()
    snap, today = context(db, business)
    existing = {dedupe_key(t.occurred_on, t.amount, t.kind, t.description) for t in snap.txs}
    earlier = {r["dedupe_key"] for r in rows[:pos] if r.get("dedupe_key") and r["status"] != "rejected"}
    rows[pos] = correct_row(rows[pos], changes, today, existing, earlier)
    annotate_settlements(rows, snap.receivables, snap.payables, snap.customers, snap.suppliers)
    batch.rows = rows
    batch.summary = {**batch.summary, **summarize(rows)}
    db.commit()
    return {"row": rows[pos], "summary": batch.summary, "rows": rows}


@router.post("/import/confirm")
def confirm(body: ImportConfirmIn, business: Business = Depends(require_feature("import")), db: Session = Depends(get_db)):
    batch = owned(db, ImportBatch, body.batch_id, business, "Import batch")
    if batch.status != "preview":
        raise ApiError(409, "already_processed", f"This import was already {batch.status}")
    snap, _ = context(db, business)
    existing = {dedupe_key(t.occurred_on, t.amount, t.kind, t.description) for t in snap.txs}
    excluded, forced = set(body.exclude_rows), set(body.include_duplicates)
    imported = skipped_dup = skipped_user = rejected = unmatched = 0
    created: list[str] = []
    has_receivables = "receivables" in FEATURES[business.kind]
    settler = Settler(snap.receivables, snap.payables)
    for row in batch.rows:
        if row["status"] == "rejected":
            rejected += 1
            continue
        if row["row_number"] in excluded:
            skipped_user += 1
            continue
        is_dup = row["status"] == "duplicate" or row["dedupe_key"] in existing
        if is_dup and row["row_number"] not in forced:
            skipped_dup += 1
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
                due = date.fromisoformat(row["due_date"])
                rec = Receivable(business_id=business.id, customer_id=cust.id, reference=row.get("reference"),
                                 description=row["description"] or None, issued_on=when, due_on=due,
                                 amount_paisa=row["amount_paisa"])
                db.add(rec)
                db.flush()
                tx.receivable_id = rec.id
                settler.add_receivable(rec.id, cust.id, due, row["amount_paisa"])
            else:
                hit = settler.match_receivable(cust.id, row["amount_paisa"])
                if hit:
                    tx.receivable_id = hit
                else:  # no open invoice covers it: recorded as income, as the preview warned
                    tx.kind = "income"
                    unmatched += 1
                tx.account = row["account"] or "cash"
        elif kind in ("credit_purchase", "supplier_payment"):
            sup = get_or_create_supplier(db, business, None, row["party"], row["category"])
            tx.supplier_id = sup.id if sup else None
            if kind == "credit_purchase":
                due = date.fromisoformat(row["due_date"])
                pay = Payable(business_id=business.id, supplier_id=tx.supplier_id, reference=row.get("reference"),
                              description=row["description"] or None, category=row["category"] or "Supplier Bill",
                              issued_on=when, due_on=due, amount_paisa=row["amount_paisa"])
                db.add(pay)
                db.flush()
                tx.payable_id = pay.id
                settler.add_payable(pay.id, tx.supplier_id, due, row["amount_paisa"])
            else:
                hit = settler.match_payable(tx.supplier_id, row["amount_paisa"])
                if hit:
                    tx.payable_id = hit
                else:
                    tx.kind = "expense"
                    unmatched += 1
                tx.account = row["account"] or "cash"
        else:
            tx.account = row["account"] or "cash"
        db.add(tx)
        db.flush()
        created.append(tx.id)
        existing.add(row["dedupe_key"])
        imported += 1
    counts = {"imported": imported, "skipped_duplicates": skipped_dup, "skipped_by_user": skipped_user,
              "rejected": rejected, "unmatched_payments": unmatched,
              "duplicates_included": len(forced & {r["row_number"] for r in batch.rows if r["status"] == "duplicate"})}
    batch.status = "confirmed"
    batch.summary = {**batch.summary, **counts}
    audit.record(db, business, "import_batch", batch.id, "import",
                 extra={"filename": batch.filename, **counts, "transaction_ids": created[:500]})
    db.commit()  # one database transaction: either every row above is saved or none is
    return {"batch_id": batch.id, **counts}


@router.get("/import/batches")
def batches(business: Business = Depends(require_feature("import")), db: Session = Depends(get_db)):
    rows = db.scalars(select(ImportBatch).where(ImportBatch.business_id == business.id)
                      .order_by(ImportBatch.created_at.desc()).limit(20)).all()
    return {"items": [{"id": b.id, "filename": b.filename, "status": b.status, "adapter": b.adapter,
                       "summary": b.summary, "created_at": b.created_at.isoformat()} for b in rows]}
