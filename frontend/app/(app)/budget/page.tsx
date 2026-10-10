"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app/shell";
import { useApp } from "@/components/app/app-provider";
import { Card } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { Field, Input } from "@/components/shared/form";
import { EmptyState, ErrorState, Notice, PageSkeleton, Spinner } from "@/components/shared/feedback";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, formatPKR, rupeesToPaisa } from "@/lib/format";

interface Line { id: string; category: string; budget_paisa: number; actual_paisa: number; variance_paisa: number; used_pct: number; status: "ok" | "near" | "over"; expected_to_date_paisa: number }
interface BudgetReport {
  month: string; from: string; to: string; days_elapsed: number; days_in_month: number; lines: Line[];
  unbudgeted: { category: string; actual_paisa: number }[]; totals: { budget_paisa: number; actual_paisa: number; variance_paisa: number };
  has_budgets: boolean; note: string; suggested_categories: string[];
}

const STATUS = { ok: "bg-emerald-500", near: "bg-amber-500", over: "bg-red-500" } as const;

export default function BudgetPage() {
  const { can, business } = useApp();
  const [month, setMonth] = useState<string>("");
  const { data, error, loading, reload } = useApi<BudgetReport>(`/budgets${month ? `?month=${month}` : ""}`);
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const personal = business.kind === "student" || business.kind === "household";

  const save = async (cat: string, rupees: string) => {
    const paisa = rupeesToPaisa(rupees);
    if (!cat.trim()) return setMsg({ tone: "danger", text: "Choose a category." });
    if (!paisa || paisa <= 0) return setMsg({ tone: "danger", text: "Enter a monthly amount above zero." });
    setBusy(true);
    setMsg(null);
    try {
      await api("/budgets", { method: "PUT", body: { category: cat.trim(), monthly_amount_paisa: paisa } });
      setCategory("");
      setAmount("");
      setMsg({ tone: "success", text: `Budget saved for ${cat.trim()}.` });
      reload();
    } catch (e) {
      setMsg({ tone: "danger", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await api(`/budgets/${id}`, { method: "DELETE" });
      reload();
    } catch (e) {
      setMsg({ tone: "danger", text: errorMessage(e) });
    }
  };

  return (
    <div className={cn("space-y-6", loading && "opacity-70")}>
      <PageHeader title={personal ? "Monthly Budget" : "Budget vs Actual"} urdu="بجٹ"
        description="Set a monthly amount per spending category and compare it with what your records show. FinDost never invents a budget."
        actions={<Input type="month" aria-label="Month" value={month || data.month} max={data.month} onChange={(e) => setMonth(e.target.value)} className="w-40" />} />

      {data.has_budgets ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[["Budgeted", data.totals.budget_paisa], ["Spent (recorded)", data.totals.actual_paisa], ["Remaining", data.totals.variance_paisa]].map(([l, v]) => (
            <div key={l as string} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="text-xs text-slate-500">{l as string} · {data.month}</p>
              <p className={cn("tabular text-xl font-semibold", (v as number) < 0 ? "text-red-600" : "text-slate-900 dark:text-white")}>{formatPKR(v as number)}</p>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No budgets yet" description={`Add a monthly amount for a category (for example ${personal ? "Groceries or Transport" : "Rent or Salaries & Wages"}) to start tracking.`} />
      )}

      {data.lines.length > 0 && (
        <Card title={`By category · ${data.from} to ${data.to}`} subtitle={`${data.days_elapsed} of ${data.days_in_month} days of the month`}>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.lines.map((l) => (
              <li key={l.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{l.category}</span>
                  <span className="tabular text-slate-600 dark:text-slate-300">{formatPKR(l.actual_paisa)} of {formatPKR(l.budget_paisa)} <span className={cn("ml-1 text-xs font-semibold", l.status === "over" ? "text-red-600" : l.status === "near" ? "text-amber-600" : "text-emerald-600")}>({l.used_pct}%)</span></span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img" aria-label={`${l.used_pct}% of budget used`}>
                  <div className={cn("h-full", STATUS[l.status])} style={{ width: `${Math.min(l.used_pct, 100)}%` }} />
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                  <span>{l.status === "over" ? `Over by ${formatPKR(-l.variance_paisa)}` : `${formatPKR(l.variance_paisa)} left`} · pace check: {formatPKR(l.expected_to_date_paisa)} expected by now</span>
                  {can("write") && <button type="button" onClick={() => remove(l.id)} aria-label={`Delete budget for ${l.category}`} className="rounded p-1 hover:bg-slate-100 dark:hover:bg-slate-800"><Trash2 className="h-3.5 w-3.5" /></button>}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] text-slate-500">{data.note}</p>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {can("write") && (
          <Card title="Set a monthly budget" subtitle="Saving an existing category updates its amount">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Category" htmlFor="b-cat">
                <Input id="b-cat" list="b-cats" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} />
                <datalist id="b-cats">{data.suggested_categories.map((c) => <option key={c} value={c} />)}</datalist>
              </Field>
              <Field label="Monthly amount (Rs.)" htmlFor="b-amt"><Input id="b-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            </div>
            <Button className="mt-3" onClick={() => save(category, amount)} disabled={busy}>{busy && <Spinner />}Save budget</Button>
            {msg && <Notice tone={msg.tone} className="mt-3">{msg.text}</Notice>}
          </Card>
        )}
        {data.unbudgeted.length > 0 && (
          <Card title="Spending without a budget" subtitle="Recorded this month">
            <ul className="space-y-1.5 text-sm">
              {data.unbudgeted.map((u) => (
                <li key={u.category} className="flex justify-between"><span>{u.category}</span><span className="tabular">{formatPKR(u.actual_paisa)}</span></li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
