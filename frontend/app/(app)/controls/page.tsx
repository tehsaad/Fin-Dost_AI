"use client";

import Link from "next/link";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/app/shell";
import { ProposeAction } from "@/components/app/propose-action";
import { ErrorState, LevelBadge, Notice, PageSkeleton } from "@/components/shared/feedback";
import { useApi } from "@/lib/hooks";
import { cn, formatDate, formatPKR } from "@/lib/format";

interface Rec { type: string; id: string; date?: string; label: string; amount_paisa: number; reason?: string }
interface Check { id: string; severity: "high" | "medium" | "low"; title: string; explanation: string; count: number; records: Rec[]; next_step: string; status: "issue" | "pass" }
interface Controls { checked_on: string; checks: Check[]; issue_count: number; records_flagged: number; scope: string }

function CheckRow({ c }: { c: Check }) {
  const [open, setOpen] = useState(c.status === "issue" && c.severity === "high");
  return (
    <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left">
        {c.status === "pass" ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <LevelBadge level={c.severity === "high" ? "high" : c.severity === "medium" ? "medium" : "low"} />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{c.title}</p>
          <p className="text-xs text-slate-500">{c.status === "pass" ? "No issues found" : `${c.count} record(s) to review`}</p>
        </div>
        <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-slate-100 p-4 text-sm dark:border-slate-800">
          <p className="text-slate-700 dark:text-slate-300">{c.explanation}</p>
          {c.records.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-400"><tr><th className="py-1 pr-2">Date</th><th className="py-1 pr-2">Record</th><th className="py-1 pr-2">Why</th><th className="py-1 text-right">Amount</th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {c.records.map((r) => (
                    <tr key={`${r.type}-${r.id}`}>
                      <td className="whitespace-nowrap py-1 pr-2 text-slate-500">{r.date ? formatDate(r.date) : "—"}</td>
                      <td className="py-1 pr-2">{r.type === "transaction" ? <Link href={`/transactions?q=${encodeURIComponent(r.label)}`} className="text-brand-700 hover:underline dark:text-brand-400">{r.label}</Link> : r.label}</td>
                      <td className="py-1 pr-2 text-slate-500">{r.reason ?? ""}</td>
                      <td className="tabular py-1 text-right">{formatPKR(r.amount_paisa)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-emerald-800 dark:text-emerald-300"><strong>Next step:</strong> {c.next_step}</p>
          {c.status === "issue" && <ProposeAction title={`Review: ${c.title}`} description={c.next_step} sourceType="control" sourceRef={c.id} requiresApproval={false} />}
        </div>
      )}
    </div>
  );
}

export default function ControlsPage() {
  const { data, error, reload } = useApi<Controls>("/controls");
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  return (
    <div className="space-y-6">
      <PageHeader title="Data Checks" urdu="ڈیٹا کی جانچ" description="Controls over your records: duplicates, missing categories, unmatched payments and totals that don't agree. Every finding lists the records behind it." />
      <Notice>{data.scope}</Notice>
      <p className="text-sm text-slate-600 dark:text-slate-300">{data.issue_count === 0 ? "All checks passed." : `${data.issue_count} check(s) need review · ${data.records_flagged} record(s) flagged · checked ${formatDate(data.checked_on, "long")}`}</p>
      <div className="space-y-3">{data.checks.map((c) => <CheckRow key={c.id} c={c} />)}</div>
    </div>
  );
}
