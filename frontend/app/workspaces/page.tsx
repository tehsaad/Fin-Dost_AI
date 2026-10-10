"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, LogOut, Plus, RefreshCw } from "lucide-react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { KIND_ICONS } from "@/components/app/kind-icons";
import { Notice, Spinner } from "@/components/shared/feedback";
import { api, ApiError, enterWorkspace, errorMessage, forgetSelectedWorkspace } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { cn } from "@/lib/format";
import type { Me, Role, WorkspaceSummary } from "@/lib/types";
import { safeAppPath } from "@/lib/workspace";

const ROLE_TEXT: Record<Role, string> = {
  owner: "Owner · full access",
  editor: "Editor · records, imports and proposals",
  viewer: "Viewer · view and export only",
};

function describe(w: WorkspaceSummary): string {
  if (w.is_own) return `Your own ${w.kind_label.toLowerCase()} account. Only you${w.kind === "enterprise" ? " and the people you invite" : ""} can see it.`;
  const since = w.joined_at ? ` since ${new Date(w.joined_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "";
  return `Shared with you by its owner${since}. Its records are separate from your own account.`;
}

function WorkspacesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeAppPath(params.get("next"));
  const notice = params.get("notice");
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const m = await api<Me>("/me");
      if (m.workspace_denied) forgetSelectedWorkspace();
      if (m.needs_onboarding) return router.replace("/onboarding");
      setMe(m);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return router.replace("/login?next=/workspaces");
      setError(errorMessage(e));
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const open = (id: string) => {
    setOpening(id);
    void enterWorkspace(id, next);
  };

  const logout = async () => {
    await signOut();
    router.replace("/login");
  };

  const own = me?.workspaces.filter((w) => w.is_own) ?? [];
  const shared = me?.workspaces.filter((w) => !w.is_own) ?? [];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#070b14]">
      <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950 md:px-6">
        <Logo />
        <div className="flex items-center gap-2">
          {me?.user.email && <span className="hidden text-xs text-slate-500 sm:inline">{me.user.email}</span>}
          <ThemeToggle />
          <button onClick={logout} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Where would you like to work today?</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Each workspace has its own records, budgets and reports. Opening one never changes or merges another. You can switch at any time from the top bar.
        </p>

        {notice === "no_access" && (
          <Notice tone="warning" className="mt-5">You no longer have access to the workspace that was open, or it does not exist. Choose one of the workspaces below.</Notice>
        )}
        {error && (
          <div className="mt-5 space-y-2">
            <Notice tone="danger">FinDost could not load your workspaces: {error}</Notice>
            <button onClick={load} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"><RefreshCw className="h-4 w-4" /> Try again</button>
          </div>
        )}
        {!me && !error && <p className="mt-8 flex items-center gap-2 text-sm text-slate-500"><Spinner /> Loading your workspaces…</p>}

        {me && (
          <div className="mt-6 space-y-6">
            {[{ title: "Your account", items: own }, { title: "Shared with you", items: shared }].map((group) => group.items.length > 0 && (
              <section key={group.title} aria-labelledby={`h-${group.title}`}>
                <h2 id={`h-${group.title}`} className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{group.title}</h2>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {group.items.map((w) => {
                    const Icon = KIND_ICONS[w.kind];
                    return (
                      <li key={w.id}>
                        <button onClick={() => open(w.id)} disabled={opening !== null}
                          className={cn("group flex h-full w-full flex-col rounded-xl border bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-brand-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60 dark:bg-slate-900",
                            opening === w.id ? "border-brand-500" : "border-slate-200 dark:border-slate-800")}>
                          <span className="flex items-start gap-3">
                            <span className="rounded-lg bg-brand-50 p-2 text-brand-700 dark:bg-brand-950/50 dark:text-brand-400"><Icon className="h-5 w-5" /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-semibold text-slate-900 dark:text-white">{w.name}</span>
                              <span className="block text-xs text-slate-500">{w.kind_label}{w.city ? ` · ${w.city}` : ""}{w.is_demo ? " · demo data" : ""}</span>
                            </span>
                          </span>
                          <span className="mt-3 inline-flex w-fit rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">{ROLE_TEXT[w.role]}</span>
                          <span className="mt-2 flex-1 text-xs text-slate-500 dark:text-slate-400">{describe(w)}</span>
                          <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-400">
                            {opening === w.id ? <><Spinner /> Opening…</> : <>Open workspace <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {!me.own_workspace_id && (
              <section>
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Your account</h2>
                <Link href="/onboarding" className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-700 hover:border-brand-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  <Plus className="h-5 w-5 text-brand-600" />
                  <span><strong className="font-semibold">Create your own account</strong><span className="block text-xs text-slate-500">Student, household, shop or enterprise — separate from the workspaces shared with you.</span></span>
                </Link>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function WorkspacesPage() {
  return <Suspense><WorkspacesInner /></Suspense>;
}
