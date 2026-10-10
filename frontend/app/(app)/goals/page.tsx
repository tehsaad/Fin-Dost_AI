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
import { cn, formatDate, formatPKR, rupeesToPaisa } from "@/lib/format";

interface Goal {
  id: string; name: string; target_paisa: number; saved_paisa: number; remaining_paisa: number; target_date: string; days_left: number;
  progress_pct: number; monthly_needed_paisa: number; avg_monthly_net_paisa: number; status: "on_track" | "at_risk" | "reached" | "overdue"; note: string; basis: string;
}
const STATUS_LABEL = { on_track: "On track", at_risk: "At risk", reached: "Reached", overdue: "Date passed" } as const;

export default function GoalsPage() {
  const { can } = useApp();
  const { data, error, reload } = useApi<{ items: Goal[] }>("/goals");
  const [f, setF] = useState({ name: "", target: "", saved: "0", date: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;

  const create = async () => {
    const target = rupeesToPaisa(f.target);
    const saved = rupeesToPaisa(f.saved || "0");
    if (!f.name.trim() || !target || target <= 0 || saved === null || !f.date) return setMsg("Fill in a name, a target above zero, what you have saved and a date.");
    setBusy(true);
    setMsg(null);
    try {
      await api("/goals", { body: { name: f.name.trim(), target_paisa: target, saved_paisa: saved, target_date: f.date } });
      setF({ name: "", target: "", saved: "0", date: "" });
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const updateSaved = async (g: Goal, value: string) => {
    const saved = rupeesToPaisa(value);
    if (saved === null || saved < 0) return;
    await api(`/goals/${g.id}`, { method: "PUT", body: { saved_paisa: saved } }).then(reload).catch((e) => setMsg(errorMessage(e)));
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Savings Goals" urdu="بچت کے اہداف" description="Set a target and date; FinDost works out the monthly amount needed and compares it with what your records show you usually keep." />
      {data.items.length === 0 ? (
        <EmptyState title="No savings goals yet" description="Add a goal such as a laptop, school fees or an emergency fund." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.items.map((g) => (
            <Card key={g.id} title={g.name} subtitle={`By ${formatDate(g.target_date, "long")} · ${STATUS_LABEL[g.status]}`}
              action={can("write") ? <button type="button" aria-label={`Delete ${g.name}`} onClick={() => api(`/goals/${g.id}`, { method: "DELETE" }).then(reload).catch((e) => setMsg(errorMessage(e)))} className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><Trash2 className="h-4 w-4" /></button> : undefined}>
              <p className="tabular text-lg font-semibold text-slate-900 dark:text-white">{formatPKR(g.saved_paisa)} <span className="text-sm font-normal text-slate-500">of {formatPKR(g.target_paisa)}</span></p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="img" aria-label={`${g.progress_pct}% saved`}>
                <div className={cn("h-full", g.status === "at_risk" ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${g.progress_pct}%` }} />
              </div>
              <p className="mt-2 text-sm">Needed: <strong className="tabular">{formatPKR(g.monthly_needed_paisa)}</strong> a month</p>
              <p className={cn("mt-1 text-xs", g.status === "at_risk" ? "text-amber-700 dark:text-amber-300" : "text-slate-600 dark:text-slate-300")}>{g.note}</p>
              {can("write") && (
                <label className="mt-3 flex items-center gap-2 text-xs text-slate-500">Saved so far (Rs.)
                  <Input inputMode="decimal" defaultValue={String(g.saved_paisa / 100)} className="w-32 py-1 text-xs" onBlur={(e) => updateSaved(g, e.target.value)} aria-label={`Saved so far for ${g.name}`} />
                </label>
              )}
              <p className="mt-2 text-[10px] text-slate-400">{g.basis}</p>
            </Card>
          ))}
        </div>
      )}
      {can("write") && (
        <Card title="Add a goal">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Name" htmlFor="g-name"><Input id="g-name" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Target (Rs.)" htmlFor="g-target"><Input id="g-target" inputMode="decimal" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></Field>
            <Field label="Already saved (Rs.)" htmlFor="g-saved"><Input id="g-saved" inputMode="decimal" value={f.saved} onChange={(e) => setF({ ...f, saved: e.target.value })} /></Field>
            <Field label="Target date" htmlFor="g-date"><Input id="g-date" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          </div>
          <Button className="mt-3" onClick={create} disabled={busy}>{busy && <Spinner />}Add goal</Button>
          {msg && <Notice tone="danger" className="mt-3">{msg}</Notice>}
        </Card>
      )}
    </div>
  );
}
