"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, ChevronDown, Info, Layers, Save, Scale, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/app/shell";
import { useApp } from "@/components/app/app-provider";
import { termsFor } from "@/lib/terms";
import { ProposeAction } from "@/components/app/propose-action";
import { Card } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { Select } from "@/components/shared/form";
import { EmptyState, Notice, PageSkeleton, Spinner } from "@/components/shared/feedback";
import { CompareChart } from "@/components/charts";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, formatDate, formatPKR } from "@/lib/format";
import type { Adjustment, Recovery, Scenario, Strategy } from "@/lib/types";

const CONTEXTS: { id: string; label: string; adjustments: Adjustment[] }[] = [
  { id: "baseline", label: "Current forecast (no shock)", adjustments: [] },
  { id: "sales20", label: "Sales fall 20% for 3 weeks", adjustments: [{ type: "sales_decline", percent: 20, start_day: 1, duration_days: 21 }] },
  { id: "late30", label: "Top 3 customers pay 30 days late", adjustments: [{ type: "delayed_payment", top_n: 3, delay_days: 30 }] },
  { id: "supplier15", label: "Supplier prices +15%", adjustments: [{ type: "supplier_price_increase", percent: 15 }] },
];
const WEIGHT_LABELS: Record<string, string> = { liquidity: "Liquidity gain", feasibility: "Feasibility", cost: "Low cost", risk: "Low risk" };

function Pct({ v }: { v: number }) {
  return <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${Math.round(v * 100)}%` }} /></div>;
}

function StrategyCard({ s, rank, selected, onSelect }: { s: Strategy; rank: number; selected: boolean; onSelect: (v: boolean) => void }) {
  const [open, setOpen] = useState(rank === 1);
  const c = s.comparison;
  return (
    <div className={cn("rounded-lg border bg-white shadow-subtle dark:bg-slate-900", selected ? "border-brand-500 ring-1 ring-brand-500/40" : "border-slate-200 dark:border-slate-800")}>
      <div className="flex items-start gap-3 p-4">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", rank === 1 ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300")}>{rank}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{s.title}</p>
            {c.removes_shortage && <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Removes shortage</span>}
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", s.evidence_quality === "high" ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300")}>{s.evidence_quality} evidence</span>
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{s.numerical_reasoning}.</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span>Lowest balance <strong className="tabular text-slate-800 dark:text-slate-200">{formatPKR(s.result.min_balance_paisa)}</strong></span>
            <span>Change <strong className="tabular text-emerald-700 dark:text-emerald-400">{formatPKR(c.min_balance_change_paisa, { sign: true })}</strong></span>
            <span>Timing <strong>{s.timing}</strong></span>
            {s.cost_paisa > 0 && <span>Cost <strong className="tabular">{formatPKR(s.cost_paisa)}</strong></span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="tabular text-lg font-semibold text-slate-900 dark:text-white">{s.score}</span>
          <label className="flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} /> compare</label>
        </div>
      </div>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between border-t border-slate-100 px-4 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40">
        Details, trade-offs and assumptions <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="grid gap-4 border-t border-slate-100 p-4 text-xs dark:border-slate-800 md:grid-cols-2">
          <div className="space-y-2">
            <p><span className="font-semibold text-slate-700 dark:text-slate-200">Problem: </span>{s.problem}</p>
            <p><span className="font-semibold text-slate-700 dark:text-slate-200">Action: </span>{s.action}</p>
            <p><span className="font-semibold text-slate-700 dark:text-slate-200">Trade-offs: </span>{s.tradeoffs}</p>
            <p><span className="font-semibold text-slate-700 dark:text-slate-200">Feasibility: </span>{Math.round(s.feasibility * 100)}% — {s.feasibility_reason}</p>
            <div>
              <p className="font-semibold text-slate-700 dark:text-slate-200">Assumptions</p>
              <ul className="list-disc pl-4 text-slate-500">{s.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
            <div>
              <p className="font-semibold text-slate-700 dark:text-slate-200">Evidence</p>
              <ul className="list-disc pl-4 text-slate-500">{s.evidence.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
            <ProposeAction title={s.title} description={`${s.problem} ${s.action}`} sourceType="recovery" sourceRef={s.id}
              adjustments={s.adjustments as unknown as Record<string, unknown>[]} />
          </div>
          <div className="space-y-2">
            <p className="font-semibold text-slate-700 dark:text-slate-200">Score breakdown (0–1, weighted by your priorities)</p>
            {Object.entries(s.score_parts).map(([k, v]) => (
              <div key={k}><div className="flex justify-between text-[11px]"><span>{WEIGHT_LABELS[k] ?? k}</span><span className="tabular">{v.toFixed(2)}</span></div><Pct v={v} /></div>
            ))}
            <p className="pt-2 text-[11px] text-slate-500">Shortage {c.scenario_shortage_date ? `still from ${formatDate(c.scenario_shortage_date)}` : "removed"} · days below zero {c.scenario_days_negative} (was {c.baseline_days_negative}).</p>
          </div>
        </div>
      )}
    </div>
  );
}

function RecoveryInner() {
  const { business } = useApp();
  const params = useSearchParams();
  const scenarios = useApi<{ items: Scenario[] }>("/scenarios");
  const [context, setContext] = useState<string>(params.get("scenario") ? `saved:${params.get("scenario")}` : "baseline");
  const [weights, setWeights] = useState<Record<string, number>>(business.recovery_weights);
  const [data, setData] = useState<Recovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const seq = useRef(0);

  const body = useMemo(() => {
    if (context.startsWith("saved:")) return { scenario_id: context.slice(6), weights };
    return { adjustments: CONTEXTS.find((c) => c.id === context)?.adjustments ?? [], weights };
  }, [context, weights]);

  useEffect(() => {
    const id = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api<Recovery>("/recovery/recommendations", { body });
        if (id === seq.current) {
          setData(r);
          setError(null);
          setSelected((prev) => (prev.length ? prev.filter((x) => r.strategies.some((s) => s.id === x)) : r.strategies.slice(0, 2).map((s) => s.id)));
        }
      } catch (e) {
        if (id === seq.current) setError(errorMessage(e));
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [body]);

  const saveWeights = async () => {
    await api("/business", { method: "PUT", body: { recovery_weights: weights } }).catch(() => undefined);
    setSaveMsg("Priorities saved as your default.");
  };

  const savePlan = async () => {
    if (!data) return;
    const chosen = data.strategies.filter((s) => selected.includes(s.id));
    try {
      await api("/scenarios", { body: {
        name: `Recovery plan: ${chosen.map((c) => c.title).join(" + ").slice(0, 100)}`,
        kind: "shock",
        adjustments: data.scenario.adjustments,
        actions: chosen.flatMap((c) => c.adjustments.map((a) => ({ ...a, label: c.title }))),
      } });
      setSaveMsg("Plan saved. Compare it with other scenarios on the Simulator page.");
      scenarios.reload();
    } catch (e) {
      setSaveMsg(errorMessage(e));
    }
  };

  if (!data && loading) return <PageSkeleton />;
  const chosen = data?.strategies.filter((s) => selected.includes(s.id)) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={termsFor(business.kind).recovery} urdu="بحالی کی حکمت عملی"
        description={termsFor(business.kind).recoveryDescription} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Situation to fix" subtitle="Baseline, a quick shock or a saved scenario">
          <Select aria-label="Scenario context" value={context} onChange={(e) => setContext(e.target.value)}>
            {CONTEXTS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            {(scenarios.data?.items ?? []).map((s) => <option key={s.id} value={`saved:${s.id}`}>Saved: {s.name}</option>)}
          </Select>
          {data && (
            <div className="mt-4 space-y-1 text-xs">
              <p className="flex justify-between"><span className="text-slate-500">Lowest balance</span><strong className={cn("tabular", data.scenario.summary.min_balance_paisa < 0 && "text-red-600")}>{formatPKR(data.scenario.summary.min_balance_paisa)}</strong></p>
              <p className="flex justify-between"><span className="text-slate-500">Shortage</span><strong>{data.scenario.summary.shortage_date ? `from ${formatDate(data.scenario.summary.shortage_date, "long")}` : "none"}</strong></p>
              <p className="flex justify-between"><span className="text-slate-500">Without any shock</span><span className="tabular">{formatPKR(data.baseline.summary.min_balance_paisa)}</span></p>
            </div>
          )}
        </Card>
        <Card title="Your priorities" subtitle="Ranking weights (normalised)" className="lg:col-span-2"
          action={<Button size="sm" variant="ghost" onClick={saveWeights}><Scale className="h-4 w-4" /> Save as default</Button>}>
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.keys(WEIGHT_LABELS).map((k) => (
              <div key={k}>
                <div className="flex justify-between text-xs"><span className="font-medium text-slate-700 dark:text-slate-300">{WEIGHT_LABELS[k]}</span><span className="tabular">{(weights[k] ?? 0).toFixed(2)}</span></div>
                <input type="range" min={0} max={1} step={0.05} value={weights[k] ?? 0} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} className="w-full accent-brand-600" aria-label={WEIGHT_LABELS[k]} />
              </div>
            ))}
          </div>
          {saveMsg && <Notice className="mt-3">{saveMsg}</Notice>}
        </Card>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {data && (
        <>
          {data.strategies.length === 0 ? (
            <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="No recovery options generated" description="There are no overdue invoices, upcoming supplier bills, discretionary costs or slow stock to act on in this situation." />
          ) : (
            <div className={cn("grid gap-6 xl:grid-cols-5", loading && "opacity-70")}>
              <div className="space-y-3 xl:col-span-3">
                {data.strategies.map((s, i) => (
                  <StrategyCard key={s.id} s={s} rank={i + 1} selected={selected.includes(s.id)} onSelect={(v) => setSelected(v ? [...selected, s.id] : selected.filter((x) => x !== s.id))} />
                ))}
              </div>
              <div className="space-y-4 xl:col-span-2">
                <Card title="Side-by-side comparison" subtitle={`${chosen.length} option(s) selected`} action={loading && <Spinner />}>
                  <CompareChart reserve={data.scenario.summary.reserve_paisa} height={260} series={[
                    { id: "scenario", label: "Situation", points: data.scenario.points },
                    ...chosen.map((s) => ({ id: s.id, label: s.title.slice(0, 28), points: s.points })),
                    ...(data.combined_plan && selected.length === 0 ? [{ id: "combined", label: "Combined plan", points: data.combined_plan.points }] : []),
                  ]} />
                  {chosen.length > 0 && (
                    <table className="mt-3 w-full text-[11px]">
                      <thead><tr className="text-left text-slate-400"><th className="py-1">Option</th><th className="py-1 text-right">Lowest</th><th className="py-1 text-right">Gain</th><th className="py-1 text-right">Cost</th><th className="py-1 text-right">Score</th></tr></thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">{chosen.map((s) => (
                        <tr key={s.id}><td className="py-1 pr-2">{s.title}</td><td className="tabular py-1 text-right">{formatPKR(s.result.min_balance_paisa)}</td><td className="tabular py-1 text-right text-emerald-700 dark:text-emerald-400">{formatPKR(s.comparison.min_balance_change_paisa, { sign: true })}</td><td className="tabular py-1 text-right">{s.cost_paisa ? formatPKR(s.cost_paisa) : "—"}</td><td className="tabular py-1 text-right">{s.score}</td></tr>
                      ))}</tbody>
                    </table>
                  )}
                  <Button className="mt-3 w-full" variant="outline" disabled={chosen.length === 0} onClick={savePlan}><Save className="h-4 w-4" /> Save selected as a plan</Button>
                </Card>
                {data.combined_plan && (
                  <Card title={<span className="flex items-center gap-2"><Layers className="h-4 w-4 text-brand-600" /> Combined plan</span>} subtitle="Best-ranked actions added until the shortage disappears">
                    <ol className="list-decimal space-y-1 pl-4 text-xs">{data.combined_plan.action_ids.map((id) => <li key={id}>{data.strategies.find((s) => s.id === id)?.title}</li>)}</ol>
                    <p className="mt-3 text-xs">Lowest balance <strong className="tabular">{formatPKR(data.combined_plan.result.min_balance_paisa)}</strong> ({formatPKR(data.combined_plan.comparison.min_balance_change_paisa, { sign: true })}) · {data.combined_plan.result.shortage_date ? `shortage still from ${formatDate(data.combined_plan.result.shortage_date)}` : "no shortage"}</p>
                  </Card>
                )}
                {data.information_only.map((i) => (
                  <Card key={i.id} title={<span className="flex items-center gap-2"><Info className="h-4 w-4 text-blue-500" /> {i.title}</span>}>
                    <p className="text-xs text-slate-600 dark:text-slate-300">{i.detail}</p>
                  </Card>
                ))}
              </div>
            </div>
          )}
          <Notice tone="warning"><ShieldAlert className="mr-1 inline h-3.5 w-3.5" />{data.disclaimer}</Notice>
        </>
      )}
    </div>
  );
}

export default function RecoveryPage() {
  return <Suspense><RecoveryInner /></Suspense>;
}
