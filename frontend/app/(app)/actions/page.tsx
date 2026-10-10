"use client";

import { useState } from "react";
import { Check, CircleSlash, Send, X } from "lucide-react";
import { PageHeader } from "@/components/app/shell";
import { Card } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { Field, Input } from "@/components/shared/form";
import { EmptyState, ErrorState, Notice, PageSkeleton, Spinner, Tabs } from "@/components/shared/feedback";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, formatDate, formatPKR } from "@/lib/format";

interface Action {
  id: string; title: string; description: string | null; source_type: string; estimated_impact_paisa: number | null; impact_basis: string | null;
  due_on: string | null; requires_approval: boolean; status: string; created_by: string; decided_by: string | null; decided_at: string | null;
  decision_note: string | null; completed_by: string | null; completed_at: string | null; outcome_note: string | null; created_at: string | null;
}
interface ActionsResp { items: Action[]; counts: Record<string, number>; your_role: string; can_approve: boolean; can_propose: boolean }

const STATUS_STYLE: Record<string, string> = {
  proposed: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  pending_approval: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
  approved: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
  cancelled: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};
type Tab = "open" | "pending_approval" | "done";

export default function ActionsPage() {
  const { data, error, reload } = useApi<ActionsResp>("/actions");
  const [tab, setTab] = useState<Tab>("open");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;

  const step = async (a: Action, verb: string) => {
    setBusy(`${a.id}:${verb}`);
    setMsg(null);
    try {
      await api(`/actions/${a.id}/${verb}`, { body: { note: notes[a.id] || null } });
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const addTask = async () => {
    if (title.trim().length < 3) return setMsg("Give the task a short title.");
    try {
      await api("/actions", { body: { title: title.trim(), source_type: "manual", requires_approval: false } });
      setTitle("");
      reload();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  const filtered = data.items.filter((a) => tab === "open" ? ["proposed", "approved"].includes(a.status)
    : tab === "pending_approval" ? a.status === "pending_approval" : ["completed", "rejected", "cancelled"].includes(a.status));

  return (
    <div className="space-y-6">
      <PageHeader title="Tasks & Approvals" urdu="کام اور منظوری"
        description="Recommendations become proposals; owners approve or reject; the person who does the work marks it completed. FinDost never moves money — 'completed' is what a person recorded." />
      <Notice>Your role: <strong>{data.your_role}</strong>. {data.can_approve ? "You can approve or reject proposals." : "Only workspace owners can approve or reject."}</Notice>
      <Tabs tabs={[{ id: "open", label: "Open", count: (data.counts.proposed ?? 0) + (data.counts.approved ?? 0) },
        { id: "pending_approval", label: "Waiting for approval", count: data.counts.pending_approval ?? 0 },
        { id: "done", label: "Closed", count: (data.counts.completed ?? 0) + (data.counts.rejected ?? 0) + (data.counts.cancelled ?? 0) }]}
        value={tab} onChange={setTab} />
      {msg && <Notice tone="danger">{msg}</Notice>}
      {filtered.length === 0 ? (
        <EmptyState title="Nothing here" description="Use “Propose as action” on a recovery option, alert or data check, or add a task below." />
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{a.title}</p>
                  {a.description && <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{a.description}</p>}
                  <p className="mt-1 text-[11px] text-slate-500">From {a.source_type}{a.created_at ? ` · ${formatDate(a.created_at.slice(0, 10), "long")}` : ""}{a.requires_approval ? " · needs approval" : ""}</p>
                  {a.estimated_impact_paisa !== null && <p className="mt-1 text-xs">Estimated effect on lowest balance: <strong className="tabular">{formatPKR(a.estimated_impact_paisa, { sign: true })}</strong> <span className="text-slate-500">— {a.impact_basis}</span></p>}
                  {a.decision_note && <p className="mt-1 text-xs text-slate-600">Decision note: {a.decision_note}</p>}
                  {a.outcome_note && <p className="mt-1 text-xs text-slate-600">Outcome: {a.outcome_note}</p>}
                </div>
                <span className={cn("rounded px-2 py-0.5 text-[11px] font-semibold", STATUS_STYLE[a.status])}>{a.status.replace("_", " ")}</span>
              </div>
              {!["completed", "rejected", "cancelled"].includes(a.status) && (data.can_propose || data.can_approve) && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                  <Input aria-label={`Note for ${a.title}`} placeholder="Note (optional)" value={notes[a.id] ?? ""} onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })} className="max-w-xs py-1 text-xs" maxLength={500} />
                  {a.status === "proposed" && a.requires_approval && data.can_propose && <Button size="sm" variant="outline" onClick={() => step(a, "submit")} disabled={!!busy}>{busy === `${a.id}:submit` ? <Spinner /> : <Send className="h-3.5 w-3.5" />} Submit for approval</Button>}
                  {a.status === "pending_approval" && data.can_approve && <>
                    <Button size="sm" onClick={() => step(a, "approve")} disabled={!!busy}>{busy === `${a.id}:approve` ? <Spinner /> : <Check className="h-3.5 w-3.5" />} Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => step(a, "reject")} disabled={!!busy}><X className="h-3.5 w-3.5" /> Reject</Button>
                  </>}
                  {(a.status === "approved" || (a.status === "proposed" && !a.requires_approval)) && data.can_propose && <Button size="sm" onClick={() => step(a, "complete")} disabled={!!busy}>{busy === `${a.id}:complete` ? <Spinner /> : <Check className="h-3.5 w-3.5" />} Mark completed</Button>}
                  {data.can_propose && <Button size="sm" variant="ghost" onClick={() => step(a, "cancel")} disabled={!!busy}><CircleSlash className="h-3.5 w-3.5" /> Cancel</Button>}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      {data.can_propose && (
        <Card title="Add a task" subtitle="For follow-ups that don't need approval">
          <div className="flex gap-2">
            <Field label="Task" htmlFor="t-title" className="flex-1"><Input id="t-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Button className="self-end" onClick={addTask}>Add</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
