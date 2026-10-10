"use client";

import { useState } from "react";
import { Modal } from "@/components/shared/modal";
import { Button } from "@/components/shared/button";
import { Field, Input, Select } from "@/components/shared/form";
import { Notice, Spinner } from "@/components/shared/feedback";
import { api, errorMessage } from "@/lib/api";
import { KIND_LABEL, rupeesToPaisa } from "@/lib/format";

export interface ImportRow {
  row_number: number;
  status: "accepted" | "rejected" | "duplicate";
  reasons: string[];
  warnings: string[];
  date: string | null;
  kind: string | null;
  amount_paisa: number | null;
  account: string | null;
  category: string | null;
  category_reason: string | null;
  description: string;
  party: string | null;
  due_date: string | null;
  corrected?: boolean;
  settles?: { type: "receivable" | "payable" | null; id?: string; note?: string } | null;
}

export interface ImportSummary {
  total_rows: number; accepted: number; rejected: number; duplicates: number; corrected?: number;
  date_from: string | null; date_to: string | null; cash_in_paisa: number; cash_out_paisa: number; auto_categorized: number;
}

const KINDS = ["income", "expense", "credit_sale", "customer_payment", "credit_purchase", "supplier_payment",
  "loan_received", "loan_repayment", "owner_withdrawal"];
const PARTY_KINDS = new Set(["credit_sale", "credit_purchase", "customer_payment", "supplier_payment"]);

/** Correct one parsed CSV row. The server validates it again; nothing reaches the ledger until the import is confirmed. */
export function RowEditor({ batchId, row, onClose, onSaved }: {
  batchId: string; row: ImportRow; onClose: () => void; onSaved: (rows: ImportRow[], summary: ImportSummary) => void;
}) {
  const [f, setF] = useState({
    date: row.date ?? "", kind: row.kind ?? "expense", amount: row.amount_paisa !== null ? String(row.amount_paisa / 100) : "",
    category: row.category ?? "", description: row.description, party: row.party ?? "", account: row.account ?? "cash",
    due_date: row.due_date ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    const amount = rupeesToPaisa(f.amount);
    if (!f.date) return setError("Enter a date.");
    if (amount === null || amount <= 0) return setError("Enter an amount above zero.");
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { date: f.date, kind: f.kind, amount_paisa: amount, category: f.category || "Uncategorized",
        description: f.description, party: f.party || null, account: f.account };
      if (f.kind === "credit_sale" || f.kind === "credit_purchase") body.due_date = f.due_date || null;
      const res = await api<{ rows: ImportRow[]; summary: ImportSummary }>(`/import/batches/${batchId}/rows/${row.row_number}`, { method: "PUT", body });
      onSaved(res.rows, res.summary);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Correct row ${row.row_number}`} description="FinDost checks the row again after you save. It is only added to your khata when you confirm the import." maxWidth="lg">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date" htmlFor="ir-date"><Input id="ir-date" type="date" value={f.date} onChange={set("date")} /></Field>
        <Field label="Type" htmlFor="ir-kind">
          <Select id="ir-kind" value={f.kind} onChange={set("kind")}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}</Select>
        </Field>
        <Field label="Amount (Rs.)" htmlFor="ir-amount"><Input id="ir-amount" inputMode="decimal" value={f.amount} onChange={set("amount")} /></Field>
        <Field label="Account" htmlFor="ir-account">
          <Select id="ir-account" value={f.account} onChange={set("account")}><option value="cash">Cash</option><option value="bank">Bank</option><option value="wallet">Wallet</option></Select>
        </Field>
        <Field label="Category" htmlFor="ir-category"><Input id="ir-category" value={f.category} onChange={set("category")} maxLength={60} /></Field>
        <Field label={PARTY_KINDS.has(f.kind) ? "Customer / supplier *" : "Customer / supplier"} htmlFor="ir-party"><Input id="ir-party" value={f.party} onChange={set("party")} maxLength={120} /></Field>
        <Field label="Description" htmlFor="ir-desc" className="sm:col-span-2"><Input id="ir-desc" value={f.description} onChange={set("description")} maxLength={240} /></Field>
        {(f.kind === "credit_sale" || f.kind === "credit_purchase") && (
          <Field label="Due date" hint="Empty = 30 days after the date" htmlFor="ir-due"><Input id="ir-due" type="date" value={f.due_date} onChange={set("due_date")} /></Field>
        )}
      </div>
      {row.reasons.length > 0 && <Notice tone="warning" className="mt-3">Problems found: {row.reasons.join("; ")}</Notice>}
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{busy && <Spinner />}Save correction</Button>
      </div>
    </Modal>
  );
}
