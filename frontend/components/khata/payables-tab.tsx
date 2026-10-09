"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/shared/button";
import { Field, Input, Select } from "@/components/shared/form";
import { EmptyState, ErrorState, Notice, Skeleton, Spinner } from "@/components/shared/feedback";
import { Modal } from "@/components/shared/modal";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, formatDate, formatPKR, rupeesToPaisa, todayISO } from "@/lib/format";
import type { Payable } from "@/lib/types";
import { PaymentModal } from "./payment-modal";

const BILL_CATEGORIES = ["Inventory Purchase", "Raw Material", "Rent", "Utilities", "Salaries & Wages", "Education", "Taxes & Fees",
  "Committee (ROSCA)", "Medical", "Repairs & Maintenance", "Supplier Bill", "Miscellaneous"];

export function PayablesTab({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useApi<{ items: Payable[] }>(`/payables${status ? `?status=${status}` : ""}`);
  const [paying, setPaying] = useState<Payable | null>(null);
  const [adding, setAdding] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const refresh = () => { reload(); onChanged?.(); };
  const items = data?.items ?? [];
  const due14 = items.filter((p) => p.status !== "paid" && p.days_to_due <= 14).reduce((a, p) => a + p.outstanding_paisa, 0);

  const remove = async (p: Payable) => {
    setActionErr(null);
    try {
      await api(`/payables/${p.id}`, { method: "DELETE" });
      refresh();
    } catch (e) {
      setActionErr(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm text-slate-500">Due in the next 14 days <strong className="tabular text-slate-900 dark:text-white">{formatPKR(due14)}</strong></span>
        <div className="flex gap-2">
          <Select aria-label="Status" className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="open">Open</option><option value="overdue">Overdue</option><option value="paid">Paid</option>
          </Select>
          <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add bill</Button>
        </div>
      </div>
      {actionErr && <Notice tone="danger">{actionErr}</Notice>}
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Skeleton className="h-48" /> : items.length === 0 ? (
        <EmptyState title="No bills or supplier credit" description="Add upcoming bills (rent, school fees, supplier invoices) so the forecast can plan for them." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
              <tr><th className="px-3 py-2.5 font-medium">Payee</th><th className="px-3 py-2.5 font-medium">Category</th><th className="px-3 py-2.5 font-medium">Due</th><th className="px-3 py-2.5 text-right font-medium">Amount</th><th className="px-3 py-2.5 text-right font-medium">Outstanding</th><th className="px-3 py-2.5"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{p.supplier_name ?? p.description ?? p.category}</p>
                    <p className="text-[11px] text-slate-500">{p.reference}{p.supplier_name && p.description ? ` · ${p.description}` : ""}{!p.is_essential ? " · non-essential" : ""}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{p.category}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                    {formatDate(p.due_on, "long")}
                    <p className={cn("text-[11px]", p.status === "overdue" ? "text-red-600" : p.days_to_due <= 7 && p.status !== "paid" ? "text-amber-600" : "text-slate-400")}>
                      {p.status === "paid" ? "Paid" : p.status === "overdue" ? `${-p.days_to_due}d overdue` : `in ${p.days_to_due} days`}
                    </p>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-slate-500">{formatPKR(p.amount_paisa)}</td>
                  <td className="tabular px-3 py-2.5 text-right font-semibold text-slate-900 dark:text-white">{formatPKR(p.outstanding_paisa)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    {p.status !== "paid" && <Button size="sm" variant="outline" onClick={() => setPaying(p)}>Pay</Button>}
                    {p.paid_paisa === 0 && <button onClick={() => remove(p)} aria-label="Delete bill" className="ml-1 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"><Trash2 className="h-4 w-4" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paying && <PaymentModal open onClose={() => setPaying(null)} title={`Pay ${paying.supplier_name ?? paying.category}`} outstanding={paying.outstanding_paisa}
        endpoint={`/payables/${paying.id}/payments`} onSaved={() => { setPaying(null); refresh(); }} />}
      <AddPayableModal open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />
    </div>
  );
}

function AddPayableModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ supplier: "", category: "Supplier Bill", amount: "", issued: todayISO(), due: "", reference: "", description: "", essential: true, purchase: false });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const paisa = rupeesToPaisa(f.amount);
    if (!paisa || paisa <= 0) return setErr("Enter an amount greater than zero.");
    if (!f.due) return setErr("Choose a due date.");
    setSaving(true);
    setErr(null);
    try {
      await api("/payables", { body: { supplier_name: f.supplier.trim() || undefined, category: f.category, amount_paisa: paisa, issued_on: f.issued,
        due_on: f.due, reference: f.reference || undefined, description: f.description || undefined, is_essential: f.essential, record_purchase: f.purchase } });
      setF({ supplier: "", category: "Supplier Bill", amount: "", issued: todayISO(), due: "", reference: "", description: "", essential: true, purchase: false });
      onSaved();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal isOpen={open} onClose={onClose} title="Add a bill or supplier credit" description="Scheduled payments feed straight into the forecast" maxWidth="md">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pay to (optional)" htmlFor="pb-sup"><Input id="pb-sup" maxLength={120} value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} placeholder="e.g. LESCO, landlord" /></Field>
          <Field label="Category" htmlFor="pb-cat"><Select id="pb-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{BILL_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Amount (Rs.)" htmlFor="pb-amt"><Input id="pb-amt" required inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Bill date" htmlFor="pb-iss"><Input id="pb-iss" type="date" value={f.issued} onChange={(e) => setF({ ...f, issued: e.target.value })} /></Field>
          <Field label="Due date" htmlFor="pb-due"><Input id="pb-due" type="date" required min={f.issued} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reference" htmlFor="pb-ref"><Input id="pb-ref" maxLength={40} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label="Description" htmlFor="pb-desc"><Input id="pb-desc" maxLength={240} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" className="mt-0.5" checked={f.essential} onChange={(e) => setF({ ...f, essential: e.target.checked })} /> Essential (rent, salaries, stock) — non-essential bills can be postponed in recovery plans</label>
        <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300"><input type="checkbox" className="mt-0.5" checked={f.purchase} onChange={(e) => setF({ ...f, purchase: e.target.checked })} /> This is goods bought on credit — also record the purchase as an expense now</label>
        {err && <Notice tone="danger">{err}</Notice>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving && <Spinner />}Save bill</Button></div>
      </form>
    </Modal>
  );
}
