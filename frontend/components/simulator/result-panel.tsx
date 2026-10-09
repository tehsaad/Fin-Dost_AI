"use client";

import { FlaskConical } from "lucide-react";
import { Card } from "@/components/shared/card";
import { Notice, Spinner } from "@/components/shared/feedback";
import { CompareChart } from "@/components/charts";
import { cn, formatDate, formatPKR } from "@/lib/format";
import type { SimResult } from "@/lib/types";

export function ResultPanel({ result, running, title = "Simulation result" }: { result: SimResult | null; running: boolean; title?: string }) {
  if (!result) {
    return (
      <Card title={title}>
        <div className="flex h-64 items-center justify-center gap-2 text-sm text-slate-500">{running ? <><Spinner /> Calculating…</> : "Add a shock or change a decision to see its effect."}</div>
      </Card>
    );
  }
  const b = result.baseline.summary;
  const s = result.scenario.summary;
  const c = result.comparison;
  const metrics: [string, string, string?][] = [
    ["Lowest balance", formatPKR(s.min_balance_paisa), `${formatPKR(c.min_balance_change_paisa, { sign: true })} vs baseline`],
    ["Cash shortage?", s.shortage_date ? `Yes, from ${formatDate(s.shortage_date, "long")}` : "No",
      b.shortage_date ? `Baseline: ${formatDate(b.shortage_date)}` : "Baseline: none"],
    ["Balance in 14 days", formatPKR(s.balance_d14_paisa), `${formatPKR(c.balance_d14_change_paisa, { sign: true })} vs baseline`],
    ["Extra pressure by end", formatPKR(c.additional_pressure_paisa), `End balance ${formatPKR(s.balance_end_paisa)}`],
    ["Days below zero", String(c.scenario_days_negative), `Baseline ${c.baseline_days_negative}`],
    ["Largest shortfall", formatPKR(c.scenario_max_shortfall_paisa), `Baseline ${formatPKR(c.baseline_max_shortfall_paisa)}`],
  ];
  return (
    <Card title={<span className="flex items-center gap-2">{title} <span className="rounded bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300">Simulation</span></span>}
      subtitle={result.disclaimer} action={running ? <Spinner /> : <FlaskConical className="h-4 w-4 text-fuchsia-600" />}>
      <div className={cn("space-y-4", running && "opacity-60")}>
        <CompareChart series={[
          { id: "baseline", label: "Baseline forecast", points: result.baseline.points },
          { id: "scenario", label: "With changes", points: result.scenario.points },
        ]} reserve={b.reserve_paisa} />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {metrics.map(([l, v, sub]) => (
            <div key={l} className="rounded-md bg-slate-50 p-2.5 dark:bg-slate-800/50">
              <p className="text-[11px] text-slate-500">{l}</p>
              <p className={cn("tabular text-sm font-semibold", v.startsWith("-") || v.startsWith("Yes") ? "text-red-600" : "text-slate-900 dark:text-white")}>{v}</p>
              {sub && <p className="text-[10px] text-slate-400">{sub}</p>}
            </div>
          ))}
        </div>
        {c.creates_shortage && <Notice tone="danger">These changes create a cash shortage that the baseline does not have.</Notice>}
        {c.removes_shortage && <Notice tone="success">These changes remove the projected shortage.</Notice>}
        {result.notes.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600 dark:text-slate-300">{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        )}
      </div>
    </Card>
  );
}
