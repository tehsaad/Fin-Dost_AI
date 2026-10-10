"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Boxes, CalendarClock, HeartPulse, Languages,
  Landmark, Receipt, ShieldAlert, Sparkles, Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/app/shell";
import { WorkflowPanel } from "@/components/app/workflow-panel";
import { termsFor } from "@/lib/terms";
import { useApp } from "@/components/app/app-provider";
import { Card } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { Modal } from "@/components/shared/modal";
import { ErrorState, LevelBadge, Notice, PageSkeleton, Spinner, ValueTag } from "@/components/shared/feedback";
import { BalanceChart, CategoryBars } from "@/components/charts";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { CASH_IN, cn, formatDate, formatPKR, formatScale, KIND_LABEL } from "@/lib/format";
import type { CopilotAnswer, Dashboard } from "@/lib/types";

const RANGES = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
];

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function Kpi({ label, value, sub, type, icon: Icon, tone = "neutral", href }: {
  label: string; value: string; sub?: React.ReactNode; type: "actual" | "estimated" | "forecast" | "index";
  icon: React.ElementType; tone?: "neutral" | "good" | "bad" | "warn"; href?: string;
}) {
  const tones = {
    neutral: "text-slate-500 bg-slate-100 dark:bg-slate-800",
    good: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-300",
    bad: "text-red-700 bg-red-50 dark:bg-red-950/50 dark:text-red-300",
    warn: "text-amber-700 bg-amber-50 dark:bg-amber-950/50 dark:text-amber-300",
  };
  const body = (
    <div className="h-full rounded-lg border border-slate-200 bg-white p-4 shadow-subtle transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <div className={cn("rounded-md p-1.5", tones[tone])}><Icon className="h-4 w-4" /></div>
        <ValueTag type={type} />
      </div>
      <p className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="tabular mt-0.5 text-xl font-semibold tracking-tight text-slate-900 dark:text-white">{value}</p>
      {sub && <div className="mt-1 text-[11px] leading-snug text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export default function DashboardPage() {
  const { business, has } = useApp();
  const t = termsFor(business.kind);
  const [range, setRange] = useState("30");
  const [explain, setExplain] = useState<CopilotAnswer | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  const path = useMemo(() => {
    const to = new Date();
    const local = new Date(to.getTime() - to.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    return `/dashboard?from=${shiftDate(local, -(Number(range) - 1))}&to=${local}`;
  }, [range]);
  const { data, error, loading, reload } = useApi<Dashboard>(path);

  const explainUrdu = async () => {
    setExplaining(true);
    setExplainError(null);
    try {
      setExplain(await api<CopilotAnswer>("/copilot/query", { body: { question: "Explain my dashboard in simple Urdu", language: "ur" } }));
    } catch (e) {
      setExplainError(errorMessage(e));
    } finally {
      setExplaining(false);
    }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const k = data.kpis;
  const s = data.forecast.summary;
  const risk = k.shortage_risk;

  return (
    <div className={cn("space-y-6", loading && "opacity-70 transition-opacity")}>
      <PageHeader
        title={t.dashboard}
        urdu={t.personal ? "میرا حساب" : "مالیاتی مرکز"}
        description={`Your position as of ${formatDate(data.as_of, "long")}. Every number is calculated from your records; forecasts are labelled.`}
        actions={
          <>
            <div className="flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900" role="group" aria-label="Period">
              {RANGES.map((r) => (
                <button key={r.id} onClick={() => setRange(r.id)} aria-pressed={range === r.id}
                  className={cn("rounded px-2.5 py-1 text-xs font-medium", range === r.id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300")}>
                  {r.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={explainUrdu} disabled={explaining}>
              {explaining ? <Spinner /> : <Languages className="h-4 w-4" />} اردو میں سمجھائیں
            </Button>
          </>
        }
      />

      {risk.shortage_date && (
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-gradient-to-r from-red-50 to-white p-4 dark:border-red-900/60 dark:from-red-950/40 dark:to-slate-950 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <div>
              <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                Cash may run short on {formatDate(risk.shortage_date, "long")} — in {risk.days_to_shortage} days
              </p>
              <p className="mt-0.5 text-xs text-red-800/80 dark:text-red-300/80">
                Lowest projected balance {formatPKR(risk.min_balance_paisa)} on {formatDate(risk.min_balance_date)}. This is a forecast, not a certainty.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Link href="/alerts"><Button variant="outline" size="sm">See evidence</Button></Link>
            <Link href="/recovery"><Button size="sm">{t.personal ? "Adjust spending" : "Plan recovery"} <ArrowRight className="h-3.5 w-3.5" /></Button></Link>
          </div>
        </div>
      )}

      <WorkflowPanel />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Kpi label="Cash balance (all accounts)" value={formatPKR(k.cash_balance.value_paisa)} type="actual" icon={Wallet}
          sub={<span>Cash {formatScale(k.cash_balance.accounts.cash)} · Bank {formatScale(k.cash_balance.accounts.bank)} · Wallet {formatScale(k.cash_balance.accounts.wallet)}</span>} />
        <Kpi label={`${t.income} (${range}d)`} value={formatPKR(k.revenue.value_paisa)} type="actual" icon={ArrowUpRight} tone="good"
          sub={t.personal ? undefined : `${formatPKR(k.revenue.cash_paisa)} cash · ${formatPKR(k.revenue.credit_paisa)} on credit`} />
        <Kpi label={`Expenses (${range}d)`} value={formatPKR(k.expenses.value_paisa)} type="actual" icon={ArrowDownRight} tone="warn" />
        <Kpi label={`${t.personal ? "Left over" : "Net profit"} (${range}d)`} value={formatPKR(k.net_profit.value_paisa)} type="estimated" icon={Landmark}
          tone={k.net_profit.value_paisa >= 0 ? "good" : "bad"}
          sub={t.personal ? "Income minus expenses" : k.net_profit.margin_pct !== null ? `${k.net_profit.margin_pct}% margin · stock bought counts as expense` : undefined} />
        {has("receivables") && (
          <Kpi label="Owed to you (udhaar)" value={formatPKR(k.receivables.value_paisa)} type="actual" icon={Receipt}
            tone={k.receivables.overdue_paisa ? "bad" : "neutral"} href="/transactions?tab=receivables"
            sub={k.receivables.overdue_count ? <span className="text-red-600 dark:text-red-400">{formatPKR(k.receivables.overdue_paisa)} overdue · {k.receivables.overdue_count} invoice(s)</span> : "Nothing overdue"} />
        )}
        <Kpi label="Bills due in 14 days" value={formatPKR(k.upcoming_payables.value_paisa)} type="actual" icon={CalendarClock}
          tone={k.upcoming_payables.value_paisa ? "warn" : "neutral"} href="/transactions?tab=payables"
          sub={`${k.upcoming_payables.count} payment(s)${k.upcoming_payables.overdue_paisa ? ` · ${formatPKR(k.upcoming_payables.overdue_paisa)} overdue` : ""}`} />
        {k.inventory_value && (
          <Kpi label="Inventory value" value={formatPKR(k.inventory_value.value_paisa)} type="estimated" icon={Boxes} href="/inventory" sub="Stock on hand at purchase cost" />
        )}
        <Kpi label="Expected cash in 7 days" value={formatPKR(k.expected_cash_7d.value_paisa)} type="forecast" icon={Sparkles}
          tone={k.expected_cash_7d.value_paisa < 0 ? "bad" : "neutral"}
          sub={`Range ${formatScale(k.expected_cash_7d.low_paisa)} to ${formatScale(k.expected_cash_7d.high_paisa)}`} />
        <Kpi label="Expected cash in 14 days" value={formatPKR(k.expected_cash_14d.value_paisa)} type="forecast" icon={Sparkles}
          tone={k.expected_cash_14d.value_paisa < 0 ? "bad" : "neutral"}
          sub={`Range ${formatScale(k.expected_cash_14d.low_paisa)} to ${formatScale(k.expected_cash_14d.high_paisa)}`} />
        <Kpi label="Cash-shortage risk" value={risk.level.toUpperCase()} type="forecast" icon={AlertTriangle}
          tone={risk.level === "high" ? "bad" : risk.level === "low" ? "good" : "warn"} href="/forecast"
          sub={risk.shortage_date ? `Shortage from ${formatDate(risk.shortage_date)}` : `Lowest ${formatPKR(risk.min_balance_paisa)}`} />
        <Kpi label="Financial health index" value={`${k.health.score}/100 · ${k.health.label}`} type="index" icon={HeartPulse}
          tone={k.health.score >= 75 ? "good" : k.health.score >= 55 ? "neutral" : k.health.score >= 35 ? "warn" : "bad"}
          sub="Hover the breakdown below — not a credit score" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Cash balance: actual and 30-day forecast"
          subtitle={`Solid = recorded · dashed = forecast (${data.forecast.confidence.level} confidence) · shaded = range for everyday variation`}
          action={<Link href="/forecast" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">Details</Link>}>
          <BalanceChart history={data.forecast.history} points={data.forecast.points} reserve={s.reserve_paisa} shortageDate={s.shortage_date} />
        </Card>

        <Card title="Important alerts" subtitle="Ranked by urgency (not probability)"
          action={<Link href="/alerts" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">All alerts</Link>}>
          {data.alerts.length === 0 ? (
            <p className="text-sm text-slate-500">No active alerts. Keep recording transactions to stay on top.</p>
          ) : (
            <ul className="space-y-3">
              {data.alerts.slice(0, 5).map((a) => (
                <li key={a.id}>
                  <Link href={`/alerts#${a.id}`} className="group block rounded-md border border-slate-100 p-2.5 transition hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700">
                    <div className="flex items-center justify-between gap-2"><LevelBadge level={a.level} /><span className="text-[10px] text-slate-400">severity {a.score}</span></div>
                    <p className="mt-1.5 text-sm font-medium text-slate-900 group-hover:text-brand-700 dark:text-slate-100">{a.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{a.next_step}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title={t.personal ? "Suggested adjustments" : "Recommended actions"} subtitle="Calculated against the projected shortage">
          {data.recommended_actions.length === 0 ? (
            <p className="text-sm text-slate-500">No shortage projected, so no recovery action is needed right now. Run a shock test to check resilience.</p>
          ) : (
            <ol className="space-y-3">
              {data.recommended_actions.map((r, i) => (
                <li key={r.id} className="flex gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{r.title}</p>
                    <p className="text-xs text-slate-500">{r.timing} · lowest balance {formatPKR(r.min_balance_change_paisa, { sign: true })}{r.removes_shortage ? " · removes the shortage" : ""}</p>
                  </div>
                </li>
              ))}
              <Link href="/recovery" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">Compare all options <ArrowRight className="h-3 w-3" /></Link>
            </ol>
          )}
        </Card>

        <Card title="Financial health breakdown" subtitle={k.health.note}>
          <ul className="space-y-2.5">
            {k.health.components.map((c) => (
              <li key={c.name}>
                <div className="flex justify-between text-xs"><span className="font-medium text-slate-700 dark:text-slate-300">{c.name} <span className="text-slate-400">({c.weight}%)</span></span><span className="tabular">{c.score}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={cn("h-1.5 rounded-full", c.score >= 70 ? "bg-emerald-500" : c.score >= 40 ? "bg-amber-500" : "bg-red-500")} style={{ width: `${c.score}%` }} />
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">{c.detail}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={`Where money went (${range}d)`} subtitle="Expenses by category">
          {data.expense_breakdown.length ? <CategoryBars data={data.expense_breakdown.slice(0, 6)} height={220} /> : <p className="text-sm text-slate-500">No expenses in this period.</p>}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Recent transactions"
          action={<Link href="/transactions" className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-400">Open khata</Link>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400"><th className="pb-2 font-medium">Date</th><th className="pb-2 font-medium">Description</th><th className="pb-2 font-medium">Type</th><th className="pb-2 text-right font-medium">Amount</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.recent_transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="py-2 pr-3 text-xs text-slate-500">{formatDate(t.occurred_on)}</td>
                    <td className="max-w-[260px] truncate py-2 pr-3 text-slate-800 dark:text-slate-200">{t.description || t.category}</td>
                    <td className="py-2 pr-3 text-xs text-slate-500">{KIND_LABEL[t.kind] ?? t.kind}</td>
                    <td className={cn("tabular py-2 text-right font-medium", CASH_IN.has(t.kind) ? "text-emerald-700 dark:text-emerald-400" : t.kind.startsWith("credit") || t.kind === "transfer" ? "text-slate-500" : "text-slate-900 dark:text-slate-100")}>
                      {CASH_IN.has(t.kind) ? "+" : t.kind.startsWith("credit") || t.kind === "transfer" ? "" : "-"}{formatPKR(t.amount_paisa)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Data quality" subtitle="Better records give better forecasts">
          <p className="text-3xl font-semibold tabular text-slate-900 dark:text-white">{data.data_quality.score}<span className="text-base text-slate-400">/100</span></p>
          <p className="mt-1 text-xs text-slate-500">{data.data_quality.transactions} transactions · {data.data_quality.history_days} days of history</p>
          {data.data_quality.issues.length ? (
            <ul className="mt-3 space-y-1.5">{data.data_quality.issues.map((i) => <li key={i}><Notice tone="warning">{i}</Notice></li>)}</ul>
          ) : <Notice tone="success" className="mt-3">No data-quality issues found.</Notice>}
          {business.is_demo && <Notice className="mt-3">This workspace uses synthetic, fictional demo data (no real customer records). Reset or clear it in Settings.</Notice>}
        </Card>
      </div>

      <Modal isOpen={Boolean(explain) || Boolean(explainError)} onClose={() => { setExplain(null); setExplainError(null); }} title="آپ کا ڈیش بورڈ — آسان اردو میں" description="Generated from your own numbers">
        {explainError ? <Notice tone="danger">{explainError}</Notice> : explain && (
          <div className="space-y-4">
            <p className="urdu text-lg text-slate-800 dark:text-slate-100" lang="ur">{explain.answer_ur}</p>
            <details className="rounded-md bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
              <summary className="cursor-pointer font-medium">Evidence used</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4">{explain.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
            </details>
            <p className="text-[11px] text-slate-500">{explain.disclaimer}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
