"use client";

import Link from "next/link";
import { ArrowRight, ClipboardCheck, PiggyBank, ShieldCheck, Target } from "lucide-react";
import { useApp } from "./app-provider";
import { useApi } from "@/lib/hooks";
import { cn, formatPKR } from "@/lib/format";

interface ActionsResp { counts: Record<string, number> }
interface ControlsResp { issue_count: number; records_flagged: number }
interface BudgetResp { has_budgets: boolean; month: string; totals: { budget_paisa: number; actual_paisa: number }; lines: { status: string }[] }
interface GoalsResp { items: { name: string; progress_pct: number; status: string }[] }

function Tile({ href, icon: Icon, title, value, sub, tone = "default" }: {
  href: string; icon: React.ElementType; title: string; value: string; sub: string; tone?: "default" | "warn" | "good";
}) {
  return (
    <Link href={href} className="group flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-4 transition hover:border-brand-400 dark:border-slate-800 dark:bg-slate-900">
      <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", tone === "warn" ? "text-amber-600" : tone === "good" ? "text-emerald-600" : "text-brand-600")} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{title}</p>
        <p className="tabular mt-0.5 text-lg font-semibold text-slate-900 dark:text-white">{value}</p>
        <p className="text-xs text-slate-500">{sub}</p>
      </div>
      <ArrowRight className="mt-1 h-4 w-4 text-slate-300 group-hover:text-brand-600" />
    </Link>
  );
}

/** The finance workflow at a glance: each tile is live data from the API and links to where the work is done. */
export function WorkflowPanel() {
  const { has } = useApp();
  const actions = useApi<ActionsResp>(has("actions") ? "/actions" : null);
  const controls = useApi<ControlsResp>(has("controls") ? "/controls" : null);
  const budget = useApi<BudgetResp>(has("budget") ? "/budgets" : null);
  const goals = useApi<GoalsResp>(has("goals") ? "/goals" : null);

  const tiles: React.ReactNode[] = [];
  if (actions.data) {
    const c = actions.data.counts;
    tiles.push(<Tile key="a" href="/actions" icon={ClipboardCheck} title="Approvals" value={`${c.pending_approval ?? 0} waiting`}
      sub={`${c.proposed ?? 0} proposed · ${c.approved ?? 0} approved, not yet done`} tone={(c.pending_approval ?? 0) > 0 ? "warn" : "default"} />);
  }
  if (controls.data) {
    tiles.push(<Tile key="c" href="/controls" icon={ShieldCheck} title="Data checks" value={controls.data.issue_count ? `${controls.data.issue_count} to review` : "All clear"}
      sub={`${controls.data.records_flagged} record(s) flagged`} tone={controls.data.issue_count ? "warn" : "good"} />);
  }
  if (budget.data) {
    const b = budget.data;
    const over = b.lines.filter((l) => l.status === "over").length;
    tiles.push(<Tile key="b" href="/budget" icon={PiggyBank} title={`Budget ${b.month}`}
      value={b.has_budgets ? `${formatPKR(b.totals.actual_paisa)} of ${formatPKR(b.totals.budget_paisa)}` : "No budget yet"}
      sub={b.has_budgets ? (over ? `${over} categor${over === 1 ? "y" : "ies"} over budget` : "Within budget so far") : "Set monthly budgets to track spending"}
      tone={over ? "warn" : b.has_budgets ? "good" : "default"} />);
  }
  if (goals.data) {
    const g = goals.data.items;
    tiles.push(<Tile key="g" href="/goals" icon={Target} title="Savings goals" value={g.length ? `${g.length} goal${g.length > 1 ? "s" : ""}` : "No goals yet"}
      sub={g.length ? `${g[0].name}: ${g[0].progress_pct}% saved` : "Set a target and see the monthly amount needed"}
      tone={g.some((x) => x.status === "at_risk") ? "warn" : "default"} />);
  }
  if (!tiles.length) return null;
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{tiles}</div>;
}
