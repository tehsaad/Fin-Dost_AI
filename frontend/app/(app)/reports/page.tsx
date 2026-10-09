"use client";

import { Download, Printer } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/app/shell";
import { Card } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { ErrorState, LevelBadge, Notice, PageSkeleton, ValueTag } from "@/components/shared/feedback";
import { BalanceChart } from "@/components/charts";
import { downloadFile, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { formatDate, formatPKR } from "@/lib/format";
import type { Alert, Dashboard, DataQuality, Forecast, Comparison, ForecastSummary } from "@/lib/types";

interface Report {
  generated_at: string;
  business: { name: string; kind: string; city: string | null; is_demo: boolean };
  executive_summary: string[];
  kpis: Dashboard["kpis"];
  risk_indicators: Alert[];
  forecast: { history: Forecast["history"]; points: Forecast["points"]; summary: ForecastSummary; model: Forecast["model"] };
  insights: { title: string; detail: string; evidence: string[] }[];
  recommendations: { id: string; title: string; action: string; timing: string; reasoning: string; tradeoffs: string; evidence_quality: string; score: number }[];
  scenario_comparison: { id: string; name: string; comparison: Comparison; notes: string[]; min_balance_paisa: number; shortage_date: string | null }[];
  data_quality: DataQuality;
  limitations: string[];
  disclaimer: string;
}

export default function ReportsPage() {
  const { data, error, reload } = useApi<Report>("/reports/financial");
  const [err, setErr] = useState<string | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const k = data.kpis;
  const kpiRows: [string, number | string, "actual" | "estimated" | "forecast" | "index"][] = [
    ["Cash balance", k.cash_balance.value_paisa, "actual"], ["Revenue (30d)", k.revenue.value_paisa, "actual"],
    ["Expenses (30d)", k.expenses.value_paisa, "actual"], ["Estimated profit (30d)", k.net_profit.value_paisa, "estimated"],
    ["Owed to you", k.receivables.value_paisa, "actual"], ["Bills due in 14 days", k.upcoming_payables.value_paisa, "actual"],
    ["Expected cash in 7 days", k.expected_cash_7d.value_paisa, "forecast"], ["Expected cash in 14 days", k.expected_cash_14d.value_paisa, "forecast"],
    ["Health index", `${k.health.score}/100 (${k.health.label})`, "index"],
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Business insights & report" urdu="رپورٹ" description="A printable summary built entirely from your records and the forecast engine."
        actions={<>
          <Button variant="outline" onClick={() => downloadFile("/reports/financial.csv", "findost-report.csv").catch((e) => setErr(errorMessage(e)))}><Download className="h-4 w-4" /> CSV</Button>
          <Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save PDF</Button>
        </>} />
      {err && <Notice tone="danger">{err}</Notice>}

      <article className="space-y-6 rounded-xl border border-slate-200 bg-white p-6 shadow-subtle dark:border-slate-800 dark:bg-slate-900 md:p-8 print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-col justify-between gap-2 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">FinDost AI · Financial report</p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-white">{data.business.name}</h2>
            <p className="text-xs text-slate-500">{data.business.kind.toUpperCase()}{data.business.city ? ` · ${data.business.city}` : ""} · prepared {formatDate(data.generated_at, "long")}{data.business.is_demo ? " · DEMO DATA (fictional)" : ""}</p>
          </div>
          <p className="max-w-xs text-[11px] text-slate-500">{data.disclaimer}</p>
        </header>

        <section className="print-avoid">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Executive summary</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-800 dark:text-slate-200">{data.executive_summary.map((s) => <li key={s}>{s}</li>)}</ul>
        </section>

        <section className="print-avoid">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Key figures</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {kpiRows.map(([l, v, t]) => (
              <div key={l} className="rounded-md border border-slate-100 p-2.5 dark:border-slate-800">
                <div className="flex items-center justify-between"><p className="text-[11px] text-slate-500">{l}</p><ValueTag type={t} /></div>
                <p className="tabular text-base font-semibold text-slate-900 dark:text-white">{typeof v === "number" ? formatPKR(v) : v}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="print-avoid">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">30-day cash forecast</h3>
          <BalanceChart history={data.forecast.history} points={data.forecast.points} reserve={data.forecast.summary.reserve_paisa} shortageDate={data.forecast.summary.shortage_date} height={260} />
          <p className="mt-1 text-[11px] text-slate-500">Model: {data.forecast.model.label}{data.forecast.model.improvement_pct !== undefined ? ` · ${data.forecast.model.improvement_pct}% lower back-test error than a flat average` : ""}.</p>
        </section>

        <section className="print-avoid">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Key risk indicators</h3>
          {data.risk_indicators.length === 0 ? <p className="text-sm text-slate-500">No active risks.</p> : (
            <ul className="space-y-2">{data.risk_indicators.map((a) => (
              <li key={a.id} className="flex items-start gap-2 text-sm"><LevelBadge level={a.level} /><span><strong className="text-slate-900 dark:text-white">{a.title}.</strong> <span className="text-slate-600 dark:text-slate-300">{a.explanation}</span></span></li>
            ))}</ul>
          )}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Insights & evidence</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {data.insights.map((i) => (
              <div key={i.title} className="print-avoid rounded-md border border-slate-100 p-3 dark:border-slate-800">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{i.title}</p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{i.detail}</p>
                {i.evidence.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-slate-500">{i.evidence.map((e) => <li key={e}>{e}</li>)}</ul>}
              </div>
            ))}
          </div>
        </section>

        <section className="print-avoid">
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Recommended actions</h3>
          <ol className="space-y-2">{data.recommendations.map((r, i) => (
            <li key={r.id} className="text-sm"><strong className="text-slate-900 dark:text-white">{i + 1}. {r.title}</strong> <span className="text-slate-500">({r.timing}; {r.evidence_quality} evidence)</span>
              <p className="text-xs text-slate-600 dark:text-slate-300">{r.action} {r.reasoning}. Trade-off: {r.tradeoffs}</p></li>
          ))}</ol>
        </section>

        {data.scenario_comparison.length > 0 && (
          <section className="print-avoid">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Scenario comparison (simulations)</h3>
            <table className="w-full text-xs">
              <thead><tr className="text-left text-slate-400"><th className="py-1">Scenario</th><th className="py-1 text-right">Lowest balance</th><th className="py-1 text-right">vs baseline</th><th className="py-1 text-right">Shortage</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{data.scenario_comparison.map((s) => (
                <tr key={s.id}><td className="py-1">{s.name}</td><td className="tabular py-1 text-right">{formatPKR(s.min_balance_paisa)}</td><td className="tabular py-1 text-right">{formatPKR(s.comparison.min_balance_change_paisa, { sign: true })}</td><td className="py-1 text-right">{s.shortage_date ? formatDate(s.shortage_date) : "None"}</td></tr>
              ))}</tbody>
            </table>
          </section>
        )}

        <section className="grid gap-4 md:grid-cols-2 print-avoid">
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Data quality ({data.data_quality.score}/100)</h3>
            {data.data_quality.issues.length ? <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600 dark:text-slate-300">{data.data_quality.issues.map((i) => <li key={i}>{i}</li>)}</ul> : <p className="text-xs text-slate-500">No issues found.</p>}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Forecast limitations</h3>
            <ul className="list-disc space-y-0.5 pl-4 text-xs text-slate-600 dark:text-slate-300">{data.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        </section>
      </article>
      <Card className="no-print" title="Note"><p className="text-xs text-slate-500">Use your browser&apos;s print dialog and choose &quot;Save as PDF&quot; to export this report as a PDF.</p></Card>
    </div>
  );
}
