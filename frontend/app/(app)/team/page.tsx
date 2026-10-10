"use client";

import { useState } from "react";
import { Copy, UserMinus } from "lucide-react";
import { PageHeader } from "@/components/app/shell";
import { useApp } from "@/components/app/app-provider";
import { Card } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { Field, Input, Select } from "@/components/shared/form";
import { ErrorState, Notice, PageSkeleton, Spinner } from "@/components/shared/feedback";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { formatDate } from "@/lib/format";
import type { Role } from "@/lib/types";

interface Member { user_id: string; email: string | null; role: Role; status: string; is_creator: boolean; is_you: boolean }
interface Invite { id: string; email: string; role: Role; status: string; email_sent: boolean; expires_at: string }
interface Team { members: Member[]; invitations: Invite[]; your_role: Role; can_manage: boolean; email_delivery: boolean }

const ROLE_HELP: Record<Role, string> = {
  owner: "Everything, including approvals, team and workspace settings",
  editor: "Add, import and edit records; prepare reports; propose actions (cannot approve or manage the team)",
  viewer: "View and export only",
};

export default function TeamPage() {
  const { switchWorkspace, me } = useApp();
  const { data, error, reload } = useApi<Team>("/team");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "warning" | "danger"; text: string; link?: string } | null>(null);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;

  const invite = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ email_sent: boolean; message: string; invite_link: string }>("/team/invitations", { body: { email: email.trim(), role } });
      setResult({ tone: r.email_sent ? "success" : "warning", text: r.message, link: r.email_sent ? undefined : r.invite_link });
      setEmail("");
      reload();
    } catch (e) {
      setResult({ tone: "danger", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  const act = (p: Promise<unknown>) => p.then(reload).catch((e) => setResult({ tone: "danger", text: errorMessage(e) }));
  const leave = async (m: Member) => {
    await api(`/team/members/${m.user_id}`, { method: "DELETE" }).catch((e) => setResult({ tone: "danger", text: errorMessage(e) }));
    const own = me.workspaces.find((w) => w.is_own);
    if (own) switchWorkspace(own.id);
    else window.location.assign("/workspaces");
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Team & Access" urdu="ٹیم" description="Several people can work in this company's workspace. Every request is checked on the server against their role." />
      <Card title="Members">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <p className="font-medium text-slate-900 dark:text-slate-100">{m.email ?? (m.is_creator ? "Workspace creator" : m.user_id)}{m.is_you && <span className="ml-1 text-xs text-slate-500">(you)</span>}</p>
                <p className="text-xs text-slate-500">{ROLE_HELP[m.role]}</p>
              </div>
              <div className="flex items-center gap-2">
                {data.can_manage && !m.is_creator ? (
                  <Select aria-label={`Role for ${m.email ?? m.user_id}`} value={m.role} className="py-1 text-xs"
                    onChange={(e) => act(api(`/team/members/${m.user_id}`, { method: "PUT", body: { role: e.target.value } }))}>
                    <option value="owner">Owner</option><option value="editor">Finance editor</option><option value="viewer">Viewer</option>
                  </Select>
                ) : <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize dark:bg-slate-800">{m.role}</span>}
                {!m.is_creator && (data.can_manage || m.is_you) && (
                  <Button size="sm" variant="ghost" aria-label={m.is_you ? "Leave workspace" : `Remove ${m.email ?? m.user_id}`}
                    onClick={() => (m.is_you ? leave(m) : act(api(`/team/members/${m.user_id}`, { method: "DELETE" })))}>
                    <UserMinus className="h-4 w-4" /> {m.is_you ? "Leave" : "Remove"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-slate-500">The workspace creator is always an owner and cannot be removed, so the company never loses its owner.</p>
      </Card>

      {data.can_manage && (
        <Card title="Invite a colleague" subtitle={data.email_delivery ? "They get an email from no-reply@tehsaad.site with a link that expires in 7 days" : "Email delivery is not configured on the server: you'll get a link to share yourself"}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Work email" htmlFor="inv-email"><Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Role" htmlFor="inv-role">
              <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="viewer">Viewer</option><option value="editor">Finance editor</option><option value="owner">Owner</option>
              </Select>
            </Field>
            <Button className="self-end" onClick={invite} disabled={busy || !email.includes("@")}>{busy && <Spinner />}Send invitation</Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{ROLE_HELP[role]}. Only the invited email address can accept, once.</p>
          {result && (
            <Notice tone={result.tone} className="mt-3">
              {result.text}
              {result.link && (
                <span className="mt-2 flex items-center gap-2 break-all text-xs">
                  <code className="rounded bg-white/60 px-1 py-0.5 dark:bg-black/30">{result.link}</code>
                  <button type="button" onClick={() => navigator.clipboard?.writeText(result.link!)} aria-label="Copy invitation link"><Copy className="h-3.5 w-3.5" /></button>
                </span>
              )}
            </Notice>
          )}
        </Card>
      )}

      {data.can_manage && data.invitations.length > 0 && (
        <Card title="Invitations">
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {data.invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{i.email} · <span className="capitalize">{i.role}</span> · <span className="text-slate-500">{i.status}{i.status === "pending" ? `, expires ${formatDate(i.expires_at.slice(0, 10))}` : ""}{i.email_sent ? "" : " · no email sent"}</span></span>
                {i.status === "pending" && <Button size="sm" variant="ghost" onClick={() => act(api(`/team/invitations/${i.id}`, { method: "DELETE" }))}>Revoke</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
