"use client";

import { useState } from "react";
import { Activity, CalendarRange, FlaskConical, Info, TrendingDown, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/app/shell";
import { Card } from "@/components/shared/card";
import { ErrorState, LevelBadge, Notice, PageSkeleton, ValueTag } from "@/components/shared/feedback";
import { BalanceChart } from "@/components/charts";
import { useApi } from "@/lib/hooks";
import { cn, formatDate, formatPKR } from "@/lib/format";
import type { Forecast } from "@/lib/types";

const SOURCE_LABEL: Record<string, string> = {
  receivable: "Customer payments (recorded invoices)",
  payable: "Bills & supplier invoices (recorded)",
  recurring_in: "Monthly income patterns",
  recurring_out: "Monthly bills detected in history",
  pipeline: "New stock on supplier credit",
  everyday_sales: "Everyday sales (model)",
  everyday_inventory: "Everyday stock buying (model)",
  everyday_operating: "Everyday running costs (model)",
  everyday_utilities: "Everyday utilities (model)",
  everyday_discretionary: "Optional spending (model)",
};

export default function ForecastPage() {
  const [horizon, setHorizon] = useState(30);
  const { data, error, loading, reload } = useApi<Forecast>(`/forecast?horizon=${horizon}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const s = data.summary;
  const m = data.model;
  const backtest = m.backtest ? Object.entries(m.backtest) : [];

  return (
    <div className={cn("space-y-6", loading && "opacity-70")}>
      <PageHeader title="Cash-flow forecast" urdu="نقدی کی پیشگوئی"
        description="Daily projected balance built from your recorded bills and invoices, detected monthly patterns and a back-tested model of everyday sales and spending."
        actions={
          <div className="flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900" role="group" aria-label="Horizon">
            {[14, 30, 60, 90].map((h) => (
              <button key={h} onClick={() => setHorizon(h)} aria-pressed={horizon === h}
                className={cn("rounded px-2.5 py-1 text-xs font-medium", horizon === h ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300")}>{h} days</button>
            ))}
          </div>
        } />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {[
          ["Today (actual)", formatPKR(s.opening_balance_paisa), "actual"],
          ["In 7 days", formatPKR(s.balance_d7_paisa), "forecast"],
          ["In 14 days", formatPKR(s.balance_d14_paisa), "forecast"],
          ["Lowest point", `${formatPKR(s.min_balance_paisa)}`, "forecast", formatDate(s.min_balance_date, "long")],
          ["Shortage date", s.shortage_date ? formatDate(s.shortage_date, "long") : "None projected", "forecast", s.days_to_shortage !== null ? `in ${s.days_to_shortage} days` : undefined],
          [`End of ${data.horizon_days} days`, formatPKR(s.balance_end_paisa), "forecast",
            s.runway_days !== null ? `runway ${s.runway_days} days` : s.runway_extrapolated_days !== null ? `≈${s.runway_extrapolated_days} days at today's average burn (extrapolated)` : `avg ${formatPKR(s.avg_daily_net_paisa, { sign: true })}/day`],
        ].map(([label, value, type, sub]) => (
          <div key={label as string} className="rounded-lg border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between"><p className="text-[11px] text-slate-500">{label}</p><ValueTag type={type as "actual" | "forecast"} /></div>
            <p className={cn("tabular mt-1 text-lg font-semibold", String(value).startsWith("-") ? "text-red-600" : "text-slate-900 dark:text-white")}>{value}</p>
            {sub && <p className="text-[11px] text-slate-500">{sub}</p>}
          </div>
        ))}
      </div>

      <Card title="Projected daily balance" subtitle={`Risk level: ${s.shortage_risk.toUpperCase()} · ${s.band_available ? (m.band?.method === "history_std" ? "shaded band = rough range (not back-tested)" : "shaded band = everyday sales/spending variation (not late customers)") : "no uncertainty band (not enough history)"} · red line = Rs. 0${s.reserve_paisa ? " · amber = your reserve" : ""}`}
        action={<LevelBadge level={s.shortage_risk} />}>
        <BalanceChart history={data.history} points={data.points} reserve={s.reserve_paisa} shortageDate={s.shortage_date} height={340} />
        {m.band && <p className="mt-2 text-[11px] text-slate-500">{m.band.note}</p>}
        <p className="mt-1 text-[11px] text-slate-500">{data.disclaimer}</p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Model & back-test" subtitle="Chosen only if it beats the simple average on held-out weeks" className="lg:col-span-1">
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2"><FlaskConical className="mt-0.5 h-4 w-4 text-brand-600" /><div><p className="font-medium text-slate-900 dark:text-slate-100">{m.label}</p><p className="text-xs text-slate-500">{m.history_days} days of history</p></div></div>
            {backtest.length > 0 ? (
              <>
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-400"><th className="py-1 font-medium">Model</th><th className="py-1 text-right font-medium">Daily error (MAE)</th></tr></thead>
                  <tbody>{backtest.map(([k, v]) => (
                    <tr key={k} className={cn(k === m.name && "font-semibold text-brand-700 dark:text-brand-400")}><td className="py-1">{v.label}{k === m.name && " ✓"}</td><td className="tabular py-1 text-right">{formatPKR(v.mae_paisa)}</td></tr>
                  ))}</tbody>
                </table>
                <p className="text-xs text-slate-600 dark:text-slate-300">Improvement over baseline: <strong>{m.improvement_pct}%</strong>{m.wape_pct !== null && m.wape_pct !== undefined && <> · weekly error ≈ <strong>{m.wape_pct}%</strong> of weekly sales</>}</p>
                <p className="text-[11px] text-slate-500">{m.method}</p>
              </>
            ) : <Notice tone="warning">Not enough history to back-test a model yet.</Notice>}
            <div className="rounded-md bg-slate-50 p-2.5 dark:bg-slate-800/60">
              <p className="text-xs font-medium">Confidence: <span className="uppercase">{data.confidence.level}</span></p>
              <ul className="mt-1 list-disc pl-4 text-[11px] text-slate-500">{data.confidence.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {data.trend.direction === "declining" ? <TrendingDown className="h-4 w-4 text-red-500" /> : data.trend.direction === "improving" ? <TrendingUp className="h-4 w-4 text-emerald-500" /> : <Activity className="h-4 w-4 text-slate-400" />}
              <span>Operating cash trend is <strong>{data.trend.direction}</strong>: last 4 weeks {formatPKR(data.trend.recent_4w_net_paisa)} vs {formatPKR(data.trend.prior_4w_net_paisa)} before.</span>
            </div>
          </div>
        </Card>

        <Card title="Where the forecast money comes from" subtitle={`Totals over ${data.horizon_days} days · in ${formatPKR(s.total_inflow_paisa)} · out ${formatPKR(s.total_outflow_paisa)}`} className="lg:col-span-2">
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {Object.entries(s.flows_by_source_paisa).filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between py-2">
                <span className="text-slate-700 dark:text-slate-300">{SOURCE_LABEL[k] ?? k}</span>
                <span className={cn("tabular font-medium", v > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-slate-900 dark:text-slate-100")}>{formatPKR(v, { sign: true })}</span>
              </li>
            ))}
          </ul>
          {data.contributors.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Largest payments before the {s.shortage_date ? "shortage" : "lowest point"}</p>
              <ul className="space-y-1.5">{data.contributors.map((c, i) => (
                <li key={i} className="flex justify-between gap-3 text-xs"><span><span className="text-slate-400">{formatDate(c.date)}</span> · {c.label} <span className="text-slate-400">({c.certainty})</span></span><span className="tabular font-medium">{formatPKR(c.amount_paisa)}</span></li>
              ))}</ul>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Assumptions" subtitle="Change your records to change these">
          <ul className="space-y-2 text-xs text-slate-600 dark:text-slate-300">{data.assumptions.map((a) => <li key={a} className="flex gap-2"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />{a}</li>)}</ul>
          {data.warnings.map((w) => <Notice key={w} tone="warning" className="mt-3">{w}</Notice>)}
          {data.pipeline && <p className="mt-3 text-[11px] text-slate-500">Supplier credit pipeline: ~{formatPKR(data.pipeline.daily_purchase_paisa * 7)}/week, paid after {data.pipeline.payment_lag_days} days (from {data.pipeline.basis_purchases} purchases).</p>}
        </Card>
        <Card title="Not counted in the base forecast" subtitle="Money that may come in, but isn't assumed">
          {data.excluded.length === 0 ? <p className="text-sm text-slate-500">Nothing excluded.</p> : (
            <ul className="space-y-2 text-xs">{data.excluded.map((e, i) => (
              <li key={i} className="flex justify-between gap-3"><span><span className="font-medium text-slate-800 dark:text-slate-200">{e.label}</span><br /><span className="text-slate-500">{e.reason}</span></span><span className="tabular font-medium">{formatPKR(e.amount_paisa)}</span></li>
            ))}</ul>
          )}
          {data.recurring.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Detected monthly patterns</p>
              <ul className="space-y-1 text-xs">{data.recurring.map((r) => (
                <li key={r.label + r.category} className="flex justify-between gap-3"><span>{r.label} · around day {r.day_of_month} · seen {r.occurrences}×{r.projected_dates.length === 0 && <span className="text-slate-400"> (already entered as a bill)</span>}</span><span className="tabular">{formatPKR(r.direction === "in" ? r.amount_paisa : -r.amount_paisa, { sign: true })}</span></li>
              ))}</ul>
            </div>
          )}
        </Card>
      </div>

      <Card title="Projected events" subtitle="Recorded = from your bills/invoices · estimated = from patterns">
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-white text-left uppercase tracking-wide text-slate-400 dark:bg-slate-900"><tr><th className="py-2 pr-2"><CalendarRange className="inline h-3.5 w-3.5" /> Date</th><th className="py-2 pr-2">Item</th><th className="py-2 pr-2">Basis</th><th className="py-2 pr-2">Note</th><th className="py-2 text-right">Amount</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.events.filter((e) => e.kind !== "pipeline").map((e, i) => (
                <tr key={i}>
                  <td className="whitespace-nowrap py-1.5 pr-2">{formatDate(e.date)} <span className="text-slate-400">(day {e.day})</span></td>
                  <td className="py-1.5 pr-2">{e.label}</td>
                  <td className="py-1.5 pr-2"><span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", e.certainty === "recorded" ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300")}>{e.certainty}</span></td>
                  <td className="py-1.5 pr-2 text-slate-500">{e.note}</td>
                  <td className={cn("tabular py-1.5 text-right font-medium", e.amount_paisa > 0 ? "text-emerald-700 dark:text-emerald-400" : "")}>{formatPKR(e.amount_paisa, { sign: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
