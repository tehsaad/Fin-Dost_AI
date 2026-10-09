"use client";

import { useState } from "react";
import { BellRing, CalendarCog, Copy, MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/shared/button";
import { Field, Input, Select } from "@/components/shared/form";
import { EmptyState, ErrorState, Notice, Skeleton, Spinner } from "@/components/shared/feedback";
import { Modal } from "@/components/shared/modal";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, formatDate, formatPKR, rupeesToPaisa, todayISO } from "@/lib/format";
import type { Receivable } from "@/lib/types";
import { PaymentModal } from "./payment-modal";

const BUCKET_STYLE: Record<string, string> = {
  current: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  "1-30": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "31-60": "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  "61-90": "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  "90+": "bg-red-600 text-white",
  settled: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
};

export function ReceivablesTab({ onChanged }: { onChanged?: () => void }) {
  const [status, setStatus] = useState("");
  const { data, error, reload } = useApi<{ items: Receivable[] }>(`/receivables${status ? `?status=${status}` : ""}`);
  const [paying, setPaying] = useState<Receivable | null>(null);
  const [reminding, setReminding] = useState<Receivable | null>(null);
  const [rescheduling, setRescheduling] = useState<Receivable | null>(null);
  const [adding, setAdding] = useState(false);

  const refresh = () => { reload(); onChanged?.(); };
  const items = data?.items ?? [];
  const open = items.filter((r) => r.status !== "settled");
  const totals = open.reduce((acc, r) => { acc.total += r.outstanding_paisa; if (r.status === "overdue") acc.overdue += r.outstanding_paisa; return acc; }, { total: 0, overdue: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-slate-500">Outstanding <strong className="tabular text-slate-900 dark:text-white">{formatPKR(totals.total)}</strong></span>
          <span className="text-slate-500">Overdue <strong className="tabular text-red-600">{formatPKR(totals.overdue)}</strong></span>
        </div>
        <div className="flex gap-2">
          <Select aria-label="Status" className="w-36" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="overdue">Overdue</option><option value="open">Not yet due</option><option value="settled">Settled</option>
          </Select>
          <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add udhaar</Button>
        </div>
      </div>
      <Notice>A credit sale is revenue when it happens, but it is <strong>not cash</strong> until the customer pays. Reminders are only drafted — you send them yourself.</Notice>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Skeleton className="h-48" /> : items.length === 0 ? (
        <EmptyState title="No customer credit recorded" description="Record a credit sale (udhaar) to track what customers owe you." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
              <tr><th className="px-3 py-2.5 font-medium">Customer</th><th className="px-3 py-2.5 font-medium">Invoice</th><th className="px-3 py-2.5 font-medium">Due</th><th className="px-3 py-2.5 font-medium">Aging</th><th className="px-3 py-2.5 text-right font-medium">Amount</th><th className="px-3 py-2.5 text-right font-medium">Outstanding</th><th className="px-3 py-2.5"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{r.customer_name}</p>
                    <p className="text-[11px] text-slate-500">{r.description}</p>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-500">{r.reference ?? "—"}<br />issued {formatDate(r.issued_on)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs">
                    {formatDate(r.due_on, "long")}
                    {r.expected_on && <p className="text-[11px] text-blue-600">expected {formatDate(r.expected_on)}</p>}
                  </td>
                  <td className="px-3 py-2.5"><span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", BUCKET_STYLE[r.aging_bucket])}>{r.status === "settled" ? "Settled" : r.days_overdue ? `${r.days_overdue}d overdue` : "Not due"}</span></td>
                  <td className="tabular px-3 py-2.5 text-right text-slate-500">{formatPKR(r.amount_paisa)}</td>
                  <td className="tabular px-3 py-2.5 text-right font-semibold text-slate-900 dark:text-white">{formatPKR(r.outstanding_paisa)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    {r.status !== "settled" && (
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" onClick={() => setPaying(r)}>Payment</Button>
                        <button onClick={() => setReminding(r)} aria-label={`Reminder for ${r.customer_name}`} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><BellRing className="h-4 w-4" /></button>
                        <button onClick={() => setRescheduling(r)} aria-label={`Set expected date for ${r.customer_name}`} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><CalendarCog className="h-4 w-4" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {paying && <PaymentModal open onClose={() => setPaying(null)} title={`Payment from ${paying.customer_name}`} outstanding={paying.outstanding_paisa}
        endpoint={`/receivables/${paying.id}/payments`} onSaved={() => { setPaying(null); refresh(); }} />}
      {reminding && <ReminderModal receivable={reminding} onClose={() => setReminding(null)} />}
      {rescheduling && <ExpectedDateModal receivable={rescheduling} onClose={() => setRescheduling(null)} onSaved={() => { setRescheduling(null); refresh(); }} />}
      <AddReceivableModal open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />
    </div>
  );
}

function ReminderModal({ receivable, onClose }: { receivable: Receivable; onClose: () => void }) {
  const [lang, setLang] = useState<"en" | "ur">("en");
  const { data, error } = useApi<{ message: string; whatsapp_url: string; note: string }>(`/receivables/${receivable.id}/reminder?lang=${lang}`);
  const [copied, setCopied] = useState(false);
  return (
    <Modal isOpen onClose={onClose} title={`Payment reminder · ${receivable.customer_name}`} description="Polite, factual and never sent automatically" maxWidth="md">
      <div className="space-y-4">
        <div className="flex gap-2">
          {(["en", "ur"] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)} className={cn("rounded px-2.5 py-1 text-xs font-medium", lang === l ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 dark:bg-slate-800")}>{l === "en" ? "English" : "اردو"}</button>
          ))}
        </div>
        {error ? <Notice tone="danger">{errorMessage(error)}</Notice> : !data ? <Skeleton className="h-24" /> : (
          <>
            <p className={cn("rounded-md bg-slate-50 p-3 text-sm dark:bg-slate-800/60", lang === "ur" && "urdu text-base")}>{data.message}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={async () => { await navigator.clipboard.writeText(data.message); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                <Copy className="h-4 w-4" /> {copied ? "Copied" : "Copy text"}
              </Button>
              <a href={data.whatsapp_url} target="_blank" rel="noopener noreferrer"><Button size="sm"><MessageCircle className="h-4 w-4" /> Open in WhatsApp</Button></a>
            </div>
            <p className="text-[11px] text-slate-500">{data.note}</p>
          </>
        )}
      </div>
    </Modal>
  );
}

function ExpectedDateModal({ receivable, onClose, onSaved }: { receivable: Receivable; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(receivable.expected_on ?? "");
  const [err, setErr] = useState<string | null>(null);
  const save = async (clear = false) => {
    try {
      await api(`/receivables/${receivable.id}`, { method: "PUT", body: { expected_on: clear ? null : date || null } });
      onSaved();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <Modal isOpen onClose={onClose} title="When do you expect this payment?" description="Used by the forecast instead of the customer's usual delay" maxWidth="sm">
      <div className="space-y-4">
        <Field label="Expected payment date" htmlFor="exp-date"><Input id="exp-date" type="date" min={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {err && <Notice tone="danger">{err}</Notice>}
        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={() => save(true)}>Use automatic estimate</Button>
          <Button onClick={() => save()} disabled={!date}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

function AddReceivableModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ customer: "", amount: "", issued: todayISO(), due: "", reference: "", description: "", recordSale: true });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const paisa = rupeesToPaisa(form.amount);
    if (!paisa || paisa <= 0) return setErr("Enter an amount greater than zero.");
    setSaving(true);
    setErr(null);
    try {
      await api("/receivables", { body: { customer_name: form.customer.trim(), amount_paisa: paisa, issued_on: form.issued,
        due_on: form.due || form.issued, reference: form.reference || undefined, description: form.description || undefined, record_sale: form.recordSale } });
      setForm({ customer: "", amount: "", issued: todayISO(), due: "", reference: "", description: "", recordSale: true });
      onSaved();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal isOpen={open} onClose={onClose} title="Add customer credit (udhaar)" maxWidth="md">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Customer" htmlFor="rc-cust"><Input id="rc-cust" required maxLength={120} value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Amount (Rs.)" htmlFor="rc-amt"><Input id="rc-amt" required inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="Date" htmlFor="rc-iss"><Input id="rc-iss" type="date" max={todayISO()} value={form.issued} onChange={(e) => setForm({ ...form, issued: e.target.value })} /></Field>
          <Field label="Due" htmlFor="rc-due"><Input id="rc-due" type="date" min={form.issued} value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reference / khata page" htmlFor="rc-ref"><Input id="rc-ref" maxLength={40} value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
          <Field label="Description" htmlFor="rc-desc"><Input id="rc-desc" maxLength={240} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
        </div>
        <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" className="mt-0.5" checked={form.recordSale} onChange={(e) => setForm({ ...form, recordSale: e.target.checked })} />
          Record as a credit sale now (untick for an old balance carried over from a paper khata)
        </label>
        {err && <Notice tone="danger">{err}</Notice>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving && <Spinner />}Save</Button></div>
      </form>
    </Modal>
  );
}
