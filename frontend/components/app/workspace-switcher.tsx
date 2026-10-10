"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, LayoutGrid } from "lucide-react";
import { useApp } from "./app-provider";
import { KIND_ICONS } from "./kind-icons";
import { cn } from "@/lib/format";

/** Shows the open workspace and switches to another one the user may open, without signing out. */
export function WorkspaceSwitcher() {
  const { business, me, role, switchWorkspace } = useApp();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const Icon = KIND_ICONS[business.kind];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button ref={button} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        aria-label={`Workspace: ${business.name} (${role}). Switch workspace`}
        className="flex max-w-[14rem] items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800">
        <Icon className="h-4 w-4 shrink-0 text-brand-600" />
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate font-medium">{business.name}</span>
          <span className="block truncate text-[10px] text-slate-500">{business.kind_label} · {role}</span>
        </span>
        <span className="sm:hidden">Switch</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div role="menu" aria-label="Your workspaces"
          className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Your workspaces</p>
          <ul className="max-h-72 overflow-y-auto py-1">
            {me.workspaces.map((w) => {
              const WIcon = KIND_ICONS[w.kind];
              const current = w.id === business.id;
              return (
                <li key={w.id}>
                  <button role="menuitem" disabled={current} onClick={() => switchWorkspace(w.id)}
                    className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm", current ? "cursor-default bg-slate-50 dark:bg-slate-800/60" : "hover:bg-slate-50 dark:hover:bg-slate-800")}>
                    <WIcon className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-900 dark:text-white">{w.name}</span>
                      <span className="block truncate text-[11px] text-slate-500">{w.kind_label} · {w.is_own ? "your account" : `shared · ${w.role}`}</span>
                    </span>
                    {current && <Check className="h-4 w-4 text-brand-600" aria-label="Open now" />}
                  </button>
                </li>
              );
            })}
          </ul>
          <Link href="/workspaces" role="menuitem" className="flex items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-slate-50 dark:border-slate-800 dark:text-brand-400 dark:hover:bg-slate-800">
            <LayoutGrid className="h-4 w-4" /> All workspaces
          </Link>
        </div>
      )}
    </div>
  );
}
