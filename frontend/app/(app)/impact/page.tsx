"use client";

import { BarChart3, FlaskConical, Globe2, Lightbulb, Target, Timer } from "lucide-react";
import { Bar, BarChart, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/app/shell";
import { Card } from "@/components/shared/card";
import { ErrorState, Notice, PageSkeleton } from "@/components/shared/feedback";
import { useApi } from "@/lib/hooks";
import { formatDate, formatPKR } from "@/lib/format";

interface Metrics { accuracy: number; precision: number; recall: number; f1: number; false_positive_rate: number; confusion: { tp: number; fp: number; tn: number; fn: number } }
interface Impact {
  measured: {
    benchmark: {
      businesses_evaluated: number; labelled_shortages: number; labelled_shortage_rate_pct: number; shortages_identified: number;
      model: Metrics; naive_baseline: Metrics; avg_warning_lead_days: number | null; median_abs_error_day14_paisa: number;
      naive_median_abs_error_day14_paisa: number; definitions: Record<string, string>; version: string; generated_at: string | null;
      average_baseline_median_abs_error_day14_paisa: number; band_coverage_day14_pct: number;
      band_coverage_day14_with_invoices_pct: number; band_coverage_day14_without_invoices_pct: number;
      config: { seed: number; n: number; history_days: number; horizon_days: number };
      recovery_scenarios_evaluated: number; avg_min_balance_gain_paisa: number; method: string; limitations: string;
    };
    your_business: {
      forecast_model: string; backtest_improvement_vs_baseline_pct: number | null; backtest_weekly_error_pct: number | null;
      data_quality: { score: number; history_days: number; transactions: number; issues: string[] };
      shortage_projected: string | null; warning_lead_days: number | null; first_warning_recorded_on: string | null;
      alerts_generated: number; scenarios_saved: number; recovery_options_evaluated: number; best_plan_min_balance_gain_paisa: number | null;
    };
  };
  hypothetical: { pathway: string[]; caveat: string };
  sdg_targets: { target: string; goal: string; text: string; link: string }[];
}

const SDG_COLORS: Record<string, string> = { "1": "#E5243B", "8": "#A21942", "9": "#FD6925", "10": "#DD1367" };

export default function ImpactPage() {
  const { data, error, reload } = useApi<Impact>("/impact");
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const b = data.measured.benchmark;
  const y = data.measured.your_business;
  const chart = (["accuracy", "precision", "recall", "f1", "false_positive_rate"] as const).map((k) => ({ metric: k === "false_positive_rate" ? "FALSE ALARMS" : k.toUpperCase(), FinDost: b.model[k], "Naive rule": b.naive_baseline[k] }));

  return (
    <div className="space-y-6">
      <PageHeader title="SDG Impact Center" urdu="پائیدار ترقی کے اثرات" description="What we can measure today (technical performance) is kept separate from what we hope happens in the real world (hypothetical impact)." />

      <section className="space-y-4">
        <div className="flex items-center gap-2"><FlaskConical className="h-5 w-5 text-brand-600" /><h2 className="text-lg font-semibold text-slate-900 dark:text-white">Measured: technical performance</h2></div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Simulated businesses evaluated", String(b.businesses_evaluated), BarChart3],
            ["Labelled shortages caught", `${b.shortages_identified} / ${b.labelled_shortages}`, Target],
            ["Avg. warning lead time", b.avg_warning_lead_days !== null ? `${b.avg_warning_lead_days} days` : "—", Timer],
            ["Recovery scenarios evaluated", String(b.recovery_scenarios_evaluated), Lightbulb],
          ].map(([l, v, I]) => { const Icon = I as React.ElementType; return (
            <div key={l as string} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <Icon className="h-4 w-4 text-brand-600" /><p className="mt-2 text-xs text-slate-500">{l as string}</p><p className="tabular text-2xl font-semibold text-slate-900 dark:text-white">{v as string}</p>
            </div>
          ); })}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2" title="Shortage detection on held-out synthetic businesses" subtitle={`${b.labelled_shortage_rate_pct}% of cases had a real (labelled) shortage within 14 days`}>
            <div className="h-64" role="img" aria-label="Detection metrics: FinDost vs naive rule">
              <ResponsiveContainer>
                <BarChart data={chart} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <XAxis dataKey="metric" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="FinDost" fill="#059669" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Naive rule" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">{b.method}</p>
          </Card>
          <Card title="Confusion matrix (FinDost)" subtitle="Predicted vs labelled shortage">
            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              {[["Caught (TP)", b.model.confusion.tp, "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"], ["False alarm (FP)", b.model.confusion.fp, "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"],
                ["Missed (FN)", b.model.confusion.fn, "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300"], ["Correctly calm (TN)", b.model.confusion.tn, "bg-slate-50 text-slate-700 dark:bg-slate-800 dark:text-slate-300"]].map(([l, v, c]) => (
                <div key={l as string} className={`rounded-md p-3 ${c}`}><p className="tabular text-2xl font-semibold">{v as number}</p><p>{l as string}</p></div>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">Median balance error at day 14: <strong className="tabular">{formatPKR(b.median_abs_error_day14_paisa)}</strong> (naive bills-only baseline {formatPKR(b.naive_median_abs_error_day14_paisa)}, historical-average baseline {formatPKR(b.average_baseline_median_abs_error_day14_paisa)}). The forecast band contained the real day-14 balance for <strong>{b.band_coverage_day14_pct}%</strong> of businesses — {b.band_coverage_day14_without_invoices_pct}% without open invoices but only {b.band_coverage_day14_with_invoices_pct}% with them, because it does not model late customer payments. False alarms: <strong>{b.model.false_positive_rate}%</strong> of no-shortage businesses (naive rule {b.naive_baseline.false_positive_rate}%). Average improvement of the lowest balance from the best recovery plan: <strong className="tabular">{formatPKR(b.avg_min_balance_gain_paisa)}</strong>.</p>
          </Card>
        </div>
        <Notice tone="warning">{b.limitations}</Notice>
        <details className="rounded-lg border border-slate-200 bg-white p-4 text-xs dark:border-slate-800 dark:bg-slate-900">
          <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">How these numbers are defined ({b.version}{b.generated_at ? `, generated ${formatDate(b.generated_at.slice(0, 10), "long")}` : ""}, seed {b.config.seed})</summary>
          <dl className="mt-3 grid gap-2 md:grid-cols-2">
            {Object.entries(b.definitions).map(([k, v]) => (
              <div key={k}><dt className="font-semibold capitalize text-slate-700 dark:text-slate-300">{k.replace(/_/g, " ")}</dt><dd className="text-slate-600 dark:text-slate-400">{v}</dd></div>
            ))}
          </dl>
        </details>

        <Card title="Your business (measured from your own data)">
          <div className="grid gap-4 text-sm md:grid-cols-3">
            <div><p className="text-xs text-slate-500">Forecast model</p><p className="font-medium">{y.forecast_model}</p>
              <p className="text-xs text-slate-500">{y.backtest_improvement_vs_baseline_pct !== null ? `${y.backtest_improvement_vs_baseline_pct}% lower back-test error than a flat average` : "Not enough history to back-test"}{y.backtest_weekly_error_pct !== null && ` · weekly error ≈ ${y.backtest_weekly_error_pct}%`}</p></div>
            <div><p className="text-xs text-slate-500">Early warning</p><p className="font-medium">{y.shortage_projected ? `Shortage projected ${formatDate(y.shortage_projected, "long")}` : "No shortage projected"}</p>
              <p className="text-xs text-slate-500">{y.warning_lead_days !== null ? `${y.warning_lead_days} days of warning` : ""}{y.first_warning_recorded_on && ` · first recorded ${formatDate(y.first_warning_recorded_on)}`}</p></div>
            <div><p className="text-xs text-slate-500">Activity</p><p className="font-medium">{y.alerts_generated} alerts · {y.scenarios_saved} scenarios · {y.recovery_options_evaluated} recovery options</p>
              <p className="text-xs text-slate-500">{y.best_plan_min_balance_gain_paisa !== null ? `Best plan raises the lowest balance by ${formatPKR(y.best_plan_min_balance_gain_paisa)}` : ""}</p></div>
            <div className="md:col-span-3"><p className="text-xs text-slate-500">Data completeness: <strong>{y.data_quality.score}/100</strong> · {y.data_quality.transactions} transactions over {y.data_quality.history_days} days</p></div>
          </div>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2"><Lightbulb className="h-5 w-5 text-amber-500" /><h2 className="text-lg font-semibold text-slate-900 dark:text-white">Hypothetical: how this could help</h2></div>
        <Card>
          <ol className="space-y-2">{data.hypothetical.pathway.map((p, i) => (
            <li key={p} className="flex gap-3 text-sm"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{i + 1}</span><span className="text-slate-700 dark:text-slate-300">{p}</span></li>
          ))}</ol>
          <Notice tone="warning" className="mt-4">{data.hypothetical.caveat}</Notice>
        </Card>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-blue-600" /><h2 className="text-lg font-semibold text-slate-900 dark:text-white">UN SDG targets this work relates to</h2></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.sdg_targets.map((t) => {
            const goal = t.target.split(".")[0];
            return (
              <div key={t.target} className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center gap-2 px-4 py-2 text-white" style={{ background: SDG_COLORS[goal] ?? "#334155" }}>
                  <span className="text-lg font-bold">{t.target}</span><span className="text-xs opacity-90">{t.goal}</span>
                </div>
                <div className="space-y-2 p-4 text-xs">
                  <p className="text-slate-500"><strong className="text-slate-700 dark:text-slate-300">Target: </strong>{t.text}</p>
                  <p className="text-slate-700 dark:text-slate-300"><strong>FinDost&apos;s link: </strong>{t.link}</p>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-slate-500">Software alone does not achieve an SDG target. These links describe where FinDost could contribute if adopted and evaluated in practice.</p>
      </section>
    </div>
  );
}
