"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CloudRain, Clock, Home, LifeBuoy, Package, Play, Save, Store, Trash2, TrendingDown, X, Zap } from "lucide-react";
import { PageHeader } from "@/components/app/shell";
import { termsFor } from "@/lib/terms";
import { useApp } from "@/components/app/app-provider";
import { Card } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { Field, Input } from "@/components/shared/form";
import { ErrorState, Notice, PageSkeleton, Spinner, Tabs } from "@/components/shared/feedback";
import { Modal } from "@/components/shared/modal";
import { CompareChart } from "@/components/charts";
import { ResultPanel } from "@/components/simulator/result-panel";
import { describeAdjustment, ShockBuilder } from "@/components/simulator/shock-builder";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, formatDate, formatPKR, rupeesToPaisa } from "@/lib/format";
import type { Adjustment, Payable, Receivable, Scenario, SimResult } from "@/lib/types";

interface Presets {
  presets: { id: string; label: string; icon: string; adjustments: Adjustment[] }[];
  receivables: Receivable[];
  payables: Payable[];
  customers: { id: string; name: string }[];
}
const ICONS: Record<string, React.ElementType> = { "trending-down": TrendingDown, clock: Clock, package: Package, zap: Zap, "alert-triangle": AlertTriangle, store: Store, "cloud-rain": CloudRain, home: Home };

function useSimulation(adjustments: Adjustment[]) {
  const [result, setResult] = useState<SimResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    const id = ++seq.current;
    setRunning(true);
    const t = setTimeout(async () => {
      try {
        const r = await api<SimResult>("/scenarios/simulate", { body: { adjustments, horizon: 30 } });
        if (id === seq.current) { setResult(r); setError(null); }
      } catch (e) {
        if (id === seq.current) setError(errorMessage(e));
      } finally {
        if (id === seq.current) setRunning(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [adjustments]);
  return { result, running, error };
}

export default function SimulatorPage() {
  const { has, business } = useApp();
  const presets = useApi<Presets>("/scenarios/presets");
  const saved = useApi<{ items: Scenario[] }>("/scenarios");
  const [tab, setTab] = useState<"shock" | "whatif" | "saved">("shock");

  // shock tab
  const [shocks, setShocks] = useState<Adjustment[]>([]);
  // what-if tab
  const [sales, setSales] = useState(0);
  const [opex, setOpex] = useState(0);
  const [purchases, setPurchases] = useState(0);
  const [emergency, setEmergency] = useState("");
  const [emergencyDay, setEmergencyDay] = useState("7");
  const [recovery, setRecovery] = useState("");
  const [recDates, setRecDates] = useState<Record<string, string>>({});
  const [payDates, setPayDates] = useState<Record<string, string>>({});

  const whatIf = useMemo(() => {
    const out: Adjustment[] = [];
    if (sales) out.push({ type: "sales_change", percent: sales });
    if (sales < 0 && Number(recovery) > 0) out.push({ type: "revenue_recovery", start_day: 1, recover_days: Number(recovery) });
    if (opex) out.push({ type: "opex_change", percent: opex });
    if (purchases) out.push({ type: "purchase_change", percent: purchases });
    const em = rupeesToPaisa(emergency);
    if (em && em > 0) out.push({ type: "emergency_expense", amount_paisa: em, day: Math.max(1, Number(emergencyDay) || 1), label: "Emergency expense" });
    Object.entries(recDates).forEach(([id, d]) => d && out.push({ type: "move_receivable", receivable_id: id, expected_date: d }));
    Object.entries(payDates).forEach(([id, d]) => d && out.push({ type: "move_payable", payable_id: id, due_date: d }));
    return out;
  }, [sales, opex, purchases, emergency, emergencyDay, recovery, recDates, payDates]);

  const active = tab === "whatif" ? whatIf : shocks;
  const sim = useSimulation(active);

  // save
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const save = async () => {
    setSaveErr(null);
    try {
      const s = await api<Scenario>("/scenarios", { body: { name: name || "My scenario", kind: tab === "whatif" ? "what_if" : "shock", adjustments: active } });
      setSavedId(s.id);
      setSaveOpen(false);
      setName("");
      saved.reload();
    } catch (e) {
      setSaveErr(errorMessage(e));
    }
  };

  // compare saved
  const [selected, setSelected] = useState<string[]>([]);
  const [compare, setCompare] = useState<{ baseline: { points: { date: string; balance_paisa: number }[] }; scenarios: { id: string; name: string; summary: SimResult["scenario"]["summary"]; comparison: SimResult["comparison"]; points: { date: string; balance_paisa: number }[] }[] } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [cmpErr, setCmpErr] = useState<string | null>(null);
  const runCompare = async () => {
    setComparing(true);
    setCmpErr(null);
    try {
      setCompare(await api("/scenarios/compare", { body: { scenario_ids: selected } }));
    } catch (e) {
      setCmpErr(errorMessage(e));
    } finally {
      setComparing(false);
    }
  };
  const remove = useCallback(async (id: string) => {
    await api(`/scenarios/${id}`, { method: "DELETE" }).catch(() => undefined);
    setSelected((s) => s.filter((x) => x !== id));
    saved.reload();
  }, [saved]);

  if (presets.error) return <ErrorState error={presets.error} onRetry={presets.reload} />;
  if (!presets.data) return <PageSkeleton />;
  const P = presets.data;

  return (
    <div className="space-y-6">
      <PageHeader title={termsFor(business.kind).simulator} urdu="جھٹکا اور اگر-مگر"
        description={termsFor(business.kind).simulatorDescription} />
      <Tabs tabs={[{ id: "shock", label: "Financial shocks" }, { id: "whatif", label: "What-if decisions" }, { id: "saved", label: "Saved & compare", count: saved.data?.items.length }]} value={tab} onChange={setTab} />

      {tab !== "saved" && (
        <div className="grid gap-6 xl:grid-cols-5">
          <div className="space-y-4 xl:col-span-2">
            {tab === "shock" ? (
              <>
                <Card title="Quick shocks" subtitle="Click to add">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {P.presets.filter((p) => has("receivables") || !p.adjustments.some((a) => a.type === "delayed_payment")).map((p) => {
                      const Icon = ICONS[p.icon] ?? Zap;
                      return (
                        <button key={p.id} onClick={() => setShocks([...shocks, ...p.adjustments])}
                          className="flex items-center gap-2 rounded-md border border-slate-200 p-2.5 text-left text-xs font-medium transition hover:border-fuchsia-300 hover:bg-fuchsia-50 dark:border-slate-700 dark:hover:bg-fuchsia-950/30">
                          <Icon className="h-4 w-4 shrink-0 text-fuchsia-600" />{p.label}
                        </button>
                      );
                    })}
                  </div>
                </Card>
                <Card title="Custom shock" subtitle="Adjust the parameters">
                  <ShockBuilder onAdd={(a) => setShocks([...shocks, a])} receivables={P.receivables} customers={P.customers} hasReceivables={has("receivables")} />
                </Card>
                <Card title="Active shocks" subtitle={shocks.length ? `${shocks.length} applied together` : "None yet"}
                  action={shocks.length > 0 && <button onClick={() => setShocks([])} className="text-xs text-slate-500 hover:text-red-600">Clear</button>}>
                  {shocks.length === 0 ? <p className="text-xs text-slate-500">Add a quick shock or a custom one.</p> : (
                    <ul className="space-y-1.5">{shocks.map((s, i) => (
                      <li key={i} className="flex items-center justify-between gap-2 rounded bg-fuchsia-50 px-2.5 py-1.5 text-xs text-fuchsia-900 dark:bg-fuchsia-950/30 dark:text-fuchsia-200">
                        {describeAdjustment(s, P.customers)}
                        <button onClick={() => setShocks(shocks.filter((_, j) => j !== i))} aria-label="Remove shock"><X className="h-3.5 w-3.5" /></button>
                      </li>
                    ))}</ul>
                  )}
                </Card>
              </>
            ) : (
              <>
                <Card title="Change your plans" subtitle="Sliders apply for the whole forecast">
                  <div className="space-y-4">
                    {[["Expected sales", sales, setSales], ["Operating expenses", opex, setOpex], ["Stock purchases", purchases, setPurchases]].map(([label, val, setter]) => (
                      <div key={label as string}>
                        <div className="flex justify-between text-xs"><span className="font-medium text-slate-700 dark:text-slate-300">{label as string}</span><span className={cn("tabular font-semibold", (val as number) > 0 ? "text-emerald-600" : (val as number) < 0 ? "text-red-600" : "")}>{(val as number) > 0 ? "+" : ""}{val as number}%</span></div>
                        <input type="range" min={-50} max={50} step={5} value={val as number} onChange={(e) => (setter as (n: number) => void)(Number(e.target.value))} className="w-full accent-brand-600" aria-label={label as string} />
                      </div>
                    ))}
                    {sales < 0 && (
                      <Field label="Sales recover to normal over (days)" htmlFor="wi-rec" hint="Leave empty if the drop lasts the whole period">
                        <Input id="wi-rec" inputMode="numeric" value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="e.g. 14" />
                      </Field>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Emergency expense (Rs.)" htmlFor="wi-em"><Input id="wi-em" inputMode="decimal" value={emergency} onChange={(e) => setEmergency(e.target.value)} placeholder="0" /></Field>
                      <Field label="On day" htmlFor="wi-emd"><Input id="wi-emd" inputMode="numeric" value={emergencyDay} onChange={(e) => setEmergencyDay(e.target.value)} /></Field>
                    </div>
                  </div>
                </Card>
                {has("receivables") && P.receivables.length > 0 && (
                  <Card title="Customer collection dates" subtitle="When will each customer actually pay?">
                    <ul className="space-y-2">{P.receivables.slice(0, 8).map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate">{r.customer_name} · {formatPKR(r.outstanding_paisa)}</span>
                        <Input type="date" aria-label={`Collection date for ${r.customer_name}`} className="w-40 py-1 text-xs" value={recDates[r.id] ?? ""} onChange={(e) => setRecDates({ ...recDates, [r.id]: e.target.value })} />
                      </li>
                    ))}</ul>
                  </Card>
                )}
                {P.payables.length > 0 && (
                  <Card title="Payment dates" subtitle="Move a bill or supplier payment">
                    <ul className="space-y-2">{P.payables.slice(0, 8).map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate">{p.supplier_name ?? p.category} · {formatPKR(p.outstanding_paisa)} · due {formatDate(p.due_on)}</span>
                        <Input type="date" aria-label={`Payment date for ${p.label}`} className="w-40 py-1 text-xs" value={payDates[p.id] ?? ""} onChange={(e) => setPayDates({ ...payDates, [p.id]: e.target.value })} />
                      </li>
                    ))}</ul>
                  </Card>
                )}
              </>
            )}
          </div>
          <div className="space-y-4 xl:col-span-3">
            {sim.error && <Notice tone="danger">{sim.error}</Notice>}
            <ResultPanel result={sim.result} running={sim.running} title={tab === "whatif" ? "What-if result" : "Shock result"} />
            <div className="flex flex-wrap justify-end gap-2">
              {savedId && <Link href={`/recovery?scenario=${savedId}`}><Button variant="outline"><LifeBuoy className="h-4 w-4" /> Find recovery options</Button></Link>}
              <Button onClick={() => setSaveOpen(true)} disabled={active.length === 0}><Save className="h-4 w-4" /> Save scenario</Button>
            </div>
          </div>
        </div>
      )}

      {tab === "saved" && (
        <div className="space-y-6">
          <Card title="Saved scenarios" subtitle="Tick two or more to compare them side by side">
            {!saved.data ? <Spinner /> : saved.data.items.length === 0 ? <p className="text-sm text-slate-500">No saved scenarios yet.</p> : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {saved.data.items.map((s) => (
                  <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex min-w-0 items-start gap-3">
                      <input type="checkbox" className="mt-1" checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{s.name} {s.is_demo && <span className="text-[10px] uppercase text-amber-600">demo</span>}</span>
                        <span className="block text-xs text-slate-500">{s.adjustments.map((a) => describeAdjustment(a, P.customers)).join(" · ") || "No changes"}{s.actions.length ? ` + ${s.actions.length} recovery action(s)` : ""}</span>
                        {s.last_result && <span className="block text-[11px] text-slate-400">Last run: lowest {formatPKR(s.last_result.summary.min_balance_paisa)}{s.last_result.summary.shortage_date ? ` · shortage ${formatDate(s.last_result.summary.shortage_date)}` : " · no shortage"}</span>}
                      </span>
                    </label>
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="outline" onClick={() => { setShocks(s.adjustments); setTab(s.kind === "what_if" ? "shock" : "shock"); }}><Play className="h-3.5 w-3.5" /> Open</Button>
                      <Link href={`/recovery?scenario=${s.id}`}><Button size="sm" variant="ghost"><LifeBuoy className="h-3.5 w-3.5" /> Recovery</Button></Link>
                      <button onClick={() => remove(s.id)} aria-label={`Delete ${s.name}`} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end"><Button disabled={selected.length < 2 || comparing} onClick={runCompare}>{comparing && <Spinner />}Compare {selected.length || ""} scenarios</Button></div>
            {cmpErr && <Notice tone="danger" className="mt-3">{cmpErr}</Notice>}
          </Card>
          {compare && (
            <Card title={<span className="flex items-center gap-2">Scenario comparison <span className="rounded bg-fuchsia-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300">Simulation</span></span>}>
              <CompareChart series={[{ id: "baseline", label: "Baseline", points: compare.baseline.points }, ...compare.scenarios.map((s) => ({ id: s.id, label: s.name, points: s.points }))]} height={320} />
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-400"><th className="py-1.5">Scenario</th><th className="py-1.5 text-right">Lowest balance</th><th className="py-1.5 text-right">vs baseline</th><th className="py-1.5 text-right">Shortage</th><th className="py-1.5 text-right">Days below 0</th><th className="py-1.5 text-right">In 14 days</th></tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {compare.scenarios.map((s) => (
                      <tr key={s.id}><td className="py-1.5 font-medium">{s.name}</td><td className="tabular py-1.5 text-right">{formatPKR(s.summary.min_balance_paisa)}</td><td className="tabular py-1.5 text-right">{formatPKR(s.comparison.min_balance_change_paisa, { sign: true })}</td><td className="py-1.5 text-right">{s.summary.shortage_date ? formatDate(s.summary.shortage_date) : "None"}</td><td className="tabular py-1.5 text-right">{s.comparison.scenario_days_negative}</td><td className="tabular py-1.5 text-right">{formatPKR(s.summary.balance_d14_paisa)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      <Modal isOpen={saveOpen} onClose={() => setSaveOpen(false)} title="Save scenario" maxWidth="sm">
        <div className="space-y-4">
          <Field label="Name" htmlFor="sc-name"><Input id="sc-name" autoFocus maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Eid slowdown + late payments" /></Field>
          {saveErr && <Notice tone="danger">{saveErr}</Notice>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></div>
        </div>
      </Modal>
    </div>
  );
}
