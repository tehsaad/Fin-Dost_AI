import React from "react";
import { AlertTriangle, Inbox, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/format";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} aria-hidden />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} aria-hidden />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: {
  title: string; description?: string; action?: React.ReactNode; icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-500 dark:bg-slate-800">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = (error as Error)?.message ?? "Something went wrong";
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <p className="font-medium">Couldn&apos;t load this</p>
        <p className="mt-0.5 text-xs opacity-90">{message}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-red-100 dark:hover:bg-red-900/40">
          <RefreshCw className="h-3 w-3" /> Retry
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warning" | "success" | "danger"; children: React.ReactNode; className?: string }) {
  const tones = {
    info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200",
    warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
    danger: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
  };
  return <div className={cn("rounded-md border px-3 py-2 text-xs leading-relaxed", tones[tone], className)}>{children}</div>;
}

/** Labels a value as recorded fact, derived estimate, projection or index. */
export function ValueTag({ type }: { type: "actual" | "estimated" | "forecast" | "index" | "simulated" }) {
  const map = {
    actual: ["Actual", "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"],
    estimated: ["Estimated", "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"],
    forecast: ["Forecast", "bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300"],
    index: ["Index", "bg-violet-50 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300"],
    simulated: ["Simulation", "bg-fuchsia-50 text-fuchsia-800 dark:bg-fuchsia-950/50 dark:text-fuchsia-300"],
  } as const;
  const [label, cls] = map[type];
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", cls)}>{label}</span>;
}

export function LevelBadge({ level }: { level: string }) {
  const cls: Record<string, string> = {
    critical: "bg-red-600 text-white",
    high: "bg-orange-500 text-white",
    medium: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
    low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    watch: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
  };
  return <span className={cn("rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide", cls[level] ?? cls.low)}>{level}</span>;
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            value === t.id
              ? "border-brand-600 text-slate-900 dark:text-white"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200")}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded bg-slate-100 px-1.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
