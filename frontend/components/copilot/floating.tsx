"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bot, Maximize2, X } from "lucide-react";
import Link from "next/link";
import { CopilotChat } from "./chat";
import { cn } from "@/lib/format";

/**
 * Floating Copilot for every signed-in page: a round launcher bottom-right that opens the real Copilot chat.
 * The conversation stays mounted while closed, so reopening keeps the thread. Hidden on the full /copilot page.
 */
export function FloatingCopilot() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setEverOpened(true);
    const t = setTimeout(() => panel.current?.querySelector<HTMLInputElement>("input[aria-label='Ask the copilot']")?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        launcher.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [open]);

  if (pathname === "/copilot") return null;

  return (
    <div className="no-print">
      {everOpened && (
        <div ref={panel} role="dialog" aria-label="Financial Copilot" aria-modal="false" aria-hidden={!open}
          className={cn("fixed z-50 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-700 dark:bg-slate-950",
            open ? "flex" : "hidden",
            "inset-x-2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] top-16 sm:inset-x-auto sm:right-6 sm:top-auto sm:h-[min(640px,calc(100vh-8rem))] sm:w-[420px]")}>
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white"><Bot className="h-4 w-4 text-brand-600" /> Financial Copilot</p>
            <div className="flex items-center gap-1">
              <Link href="/copilot" onClick={() => setOpen(false)} aria-label="Open full screen" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><Maximize2 className="h-4 w-4" /></Link>
              <button type="button" onClick={() => { setOpen(false); launcher.current?.focus(); }} aria-label="Close Copilot" className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="min-h-0 flex-1 p-3"><CopilotChat compact /></div>
        </div>
      )}
      <button ref={launcher} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={open ? "Close Copilot" : "Open Copilot"}
        className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg transition hover:scale-105 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/50 dark:bg-white dark:text-slate-900 sm:right-6">
        {open ? <X className="h-6 w-6" /> : <Bot className="h-6 w-6" />}
      </button>
    </div>
  );
}
