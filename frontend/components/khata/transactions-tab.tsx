"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/shared/button";
import { Input, Select } from "@/components/shared/form";
import { EmptyState, ErrorState, Notice, Skeleton } from "@/components/shared/feedback";
import { Modal } from "@/components/shared/modal";
import { api, downloadFile, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { CASH_IN, cn, formatDate, formatPKR, KIND_LABEL } from "@/lib/format";
import type { Paged, Tx } from "@/lib/types";
import { ChangeHistory } from "./change-history";
import { TransactionForm } from "./transaction-form";

export function TransactionsTab({ onChanged }: { onChanged?: () => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [kind, setKind] = useState("");
  const [account, setAccount] = useState("");
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Tx | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Tx | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setPage(1), [debounced, kind, account, category, from, to]);

  const query = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), page_size: "25" });
    if (debounced) p.set("q", debounced);
    if (kind) p.set("kind", kind);
    if (account) p.set("account", account);
    if (category) p.set("category", category);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    return p.toString();
  }, [page, debounced, kind, account, category, from, to]);
  const { data, error, loading, reload } = useApi<Paged<Tx>>(`/transactions?${query}`);
  const cats = useApi<{ used: string[] }>("/transactions/categories");

  const refresh = () => {
    reload();
    onChanged?.();
  };

  const remove = async () => {
    if (!deleting) return;
    setActionError(null);
    try {
      await api(`/transactions/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      refresh();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  const exportCsv = async () => {
    const p = new URLSearchParams(query);
    p.delete("page");
    p.delete("page_size");
    try {
      await downloadFile(`/transactions/export.csv?${p.toString()}`, "findost-ledger.csv");
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-6">
          <div className="relative col-span-2">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <Input aria-label="Search transactions" className="pl-8" placeholder="Search description or category" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All types</option>
            <option value="income,customer_payment,loan_received">Money in</option>
            <option value="expense,supplier_payment,loan_repayment,owner_withdrawal">Money out</option>
            <option value="credit_sale,credit_purchase">On credit</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {(cats.data?.used ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Input aria-label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input aria-label="To date" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <Select aria-label="Account" className="w-32" value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">All accounts</option><option value="cash">Cash</option><option value="bank">Bank</option><option value="wallet">Wallet</option>
          </Select>
          <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" /> CSV</Button>
          <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add</Button>
        </div>
      </div>
      {actionError && <Notice tone="danger">{actionError}</Notice>}
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? (
        <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : data.items.length === 0 ? (
        <EmptyState title="No transactions match" description="Add a transaction or import a CSV to get started." action={<Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Add transaction</Button>} />
      ) : (
        <div className={cn("overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900", loading && "opacity-70")}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/50">
              <tr><th className="px-3 py-2.5 font-medium">Date</th><th className="px-3 py-2.5 font-medium">Description</th><th className="px-3 py-2.5 font-medium">Type</th><th className="px-3 py-2.5 font-medium">Category</th><th className="px-3 py-2.5 font-medium">Account</th><th className="px-3 py-2.5 text-right font-medium">Amount</th><th className="px-3 py-2.5"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.items.map((t) => {
                const inflow = CASH_IN.has(t.kind);
                const neutral = t.kind.startsWith("credit") || t.kind === "transfer";
                return (
                  <tr key={t.id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">{formatDate(t.occurred_on, "long")}</td>
                    <td className="max-w-[280px] px-3 py-2">
                      <p className="truncate text-slate-800 dark:text-slate-200">{t.description || "—"}</p>
                      {(t.customer_name || t.supplier_name) && <p className="truncate text-[11px] text-slate-500">{t.customer_name ?? t.supplier_name}</p>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{KIND_LABEL[t.kind] ?? t.kind}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-600 dark:text-slate-400">{t.category}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs capitalize text-slate-500">{t.kind === "transfer" ? `${t.account} → ${t.to_account}` : t.account ?? "—"}</td>
                    <td className={cn("tabular whitespace-nowrap px-3 py-2 text-right font-medium", inflow ? "text-emerald-700 dark:text-emerald-400" : neutral ? "text-slate-500" : "text-slate-900 dark:text-slate-100")}>
                      {inflow ? "+" : neutral ? "" : "-"}{formatPKR(t.amount_paisa, { decimals: t.amount_paisa % 100 !== 0 })}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <button onClick={() => setEditing(t)} aria-label={`Edit ${t.description}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"><Pencil className="h-3.5 w-3.5" /></button>
                      <button onClick={() => setDeleting(t)} aria-label={`Delete ${t.description}`} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"><Trash2 className="h-3.5 w-3.5" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800">
            <span>{data.total} transactions · page {data.page} of {data.pages}</span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
      )}

      <Modal isOpen={adding} onClose={() => setAdding(false)} title="Add transaction" description="Recorded in your ledger immediately">
        <TransactionForm onSaved={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />
      </Modal>
      <Modal isOpen={Boolean(editing)} onClose={() => setEditing(null)} title="Edit transaction" description={editing ? KIND_LABEL[editing.kind] : undefined}>
        {editing && <TransactionForm existing={editing} onSaved={() => { setEditing(null); refresh(); }} onCancel={() => setEditing(null)} />}
        {editing && <ChangeHistory entityId={editing.id} />}
      </Modal>
      <Modal isOpen={Boolean(deleting)} onClose={() => setDeleting(null)} title="Delete transaction?" maxWidth="md">
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {deleting.description || deleting.category} · {formatPKR(deleting.amount_paisa)} on {formatDate(deleting.occurred_on, "long")}.
              {deleting.kind.startsWith("credit") && " This also removes the linked invoice/bill."}
            </p>
            {actionError && <Notice tone="danger">{actionError}</Notice>}
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" onClick={remove}>Delete</Button></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
