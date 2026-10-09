"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, BellOff, Bell, ChevronDown, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/app/shell";
import { Card } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { EmptyState, ErrorState, LevelBadge, Notice, PageSkeleton } from "@/components/shared/feedback";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, formatDate, formatPKR } from "@/lib/format";
import type { Alert } from "@/lib/types";

interface AlertsResponse {
  items: Alert[];
  counts: Record<string, number>;
  recently_resolved: { id: string; title: string; rule: string; last_detected_on: string }[];
  score_note: string;
}

const RULE_LABEL: Record<string, string> = {
  projected_shortage: "Projected shortage", reserve_breach: "Reserve breach", obligations_at_risk: "Bills at risk",
  revenue_decline: "Revenue decline", bill_increase: "Bill increase", expense_spike: "Expense spike",
  overdue_receivables: "Overdue payments", credit_exposure: "Credit exposure", customer_concentration: "Customer concentration",
  supplier_concentration: "Supplier concentration", unusual_transaction: "Unusual transaction", slow_inventory: "Slow inventory",
  insufficient_history: "Data sufficiency",
};

function labelize(key: string) {
  return key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function AlertCard({ alert, onAck, defaultOpen }: { alert: Alert; onAck: (id: string) => void; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const acked = alert.status === "acknowledged";
  const items = alert.items as Record<string, unknown>[];
  return (
    <div id={alert.id} className={cn("scroll-mt-24 rounded-lg border bg-white shadow-subtle dark:bg-slate-900",
      alert.level === "critical" ? "border-red-300 dark:border-red-900" : "border-slate-200 dark:border-slate-800", acked && "opacity-70")}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-3 p-4 text-left">
        <div className="pt-0.5"><LevelBadge level={alert.level} /></div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{alert.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">{RULE_LABEL[alert.rule] ?? alert.rule} · severity {alert.score}/100 · first seen {formatDate(alert.first_detected_on)}{acked && " · acknowledged"}</p>
        </div>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-slate-100 p-4 text-sm dark:border-slate-800">
          <p className="text-slate-700 dark:text-slate-300">{alert.explanation}</p>
          {(Object.keys(alert.amounts).length > 0 || Object.keys(alert.dates).length > 0) && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(alert.amounts).map(([k, v]) => <span key={k} className="rounded-md bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">{labelize(k)}: <strong className="tabular">{formatPKR(v)}</strong></span>)}
              {Object.entries(alert.dates).map(([k, v]) => <span key={k} className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-800 dark:bg-blue-950/50 dark:text-blue-300">{labelize(k)}: <strong>{formatDate(v, "long")}</strong></span>)}
            </div>
          )}
          {alert.evidence.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Triggering evidence</p>
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600 dark:text-slate-300">{alert.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          )}
          {alert.transactions.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Contributing transactions</p>
              <table className="w-full text-xs"><tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {alert.transactions.map((t) => (
                  <tr key={t.id}><td className="py-1 pr-2 text-slate-500">{formatDate(t.date)}</td><td className="py-1 pr-2">{t.description || t.category}</td><td className="py-1 pr-2 text-slate-500">{t.category}</td><td className="tabular py-1 text-right font-medium">{formatPKR(t.amount_paisa)}</td></tr>
                ))}
              </tbody></table>
            </div>
          )}
          {items.length > 0 && !alert.evidence.length && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600 dark:text-slate-300">
              {items.map((it, i) => <li key={i}>{String(it.label ?? it.customer ?? "")} {typeof it.amount_paisa === "number" ? formatPKR(it.amount_paisa as number) : typeof it.outstanding_paisa === "number" ? formatPKR(it.outstanding_paisa as number) : ""}</li>)}
            </ul>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">Recommended next step</p>
              <p className="mt-1 text-xs text-emerald-900 dark:text-emerald-200">{alert.next_step}</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800/40">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">Limitations</p>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{alert.limitations}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-400">{alert.score_note}</p>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => onAck(alert.id)}>{acked ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}{acked ? "Re-open" : "Acknowledge"}</Button>
              <Link href={alert.link}><Button size="sm" variant="outline">Go to action <ArrowRight className="h-3.5 w-3.5" /></Button></Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AlertsPage() {
  const { data, error, reload } = useApi<AlertsResponse>("/alerts");
  const [ackError, setAckError] = useState<string | null>(null);
  const [hash, setHash] = useState("");
  useEffect(() => setHash(window.location.hash.slice(1)), []);
  useEffect(() => {
    if (hash && data) document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
  }, [hash, data]);

  const ack = async (id: string) => {
    try {
      await api(`/alerts/${id}/acknowledge`, { method: "POST" });
      reload();
    } catch (e) {
      setAckError(errorMessage(e));
    }
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  return (
    <div className="space-y-6">
      <PageHeader title="Risk & early warnings" urdu="خطرات اور انتباہ" description="Explainable rules over your ledger and forecast, plus statistical checks for unusual amounts. Unusual never means fraudulent — always check the receipt." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["critical", "high", "medium", "low"] as const).map((l) => (
          <div key={l} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <LevelBadge level={l} /><span className="tabular text-2xl font-semibold text-slate-900 dark:text-white">{data.counts[l] ?? 0}</span>
          </div>
        ))}
      </div>
      <Notice>{data.score_note}</Notice>
      {ackError && <Notice tone="danger">{ackError}</Notice>}
      {data.items.length === 0 ? (
        <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="No active warnings" description="FinDost re-checks your records every time you open this page." />
      ) : (
        <div className="space-y-3">{data.items.map((a, i) => <AlertCard key={a.id} alert={a} onAck={ack} defaultOpen={a.id === hash || (i === 0 && !hash)} />)}</div>
      )}
      {data.recently_resolved.length > 0 && (
        <Card title="Recently resolved" subtitle="No longer triggered by your current data">
          <ul className="space-y-1 text-xs text-slate-500">{data.recently_resolved.map((r) => <li key={r.id}>✓ {r.title} <span className="text-slate-400">(last seen {formatDate(r.last_detected_on)})</span></li>)}</ul>
        </Card>
      )}
    </div>
  );
}
