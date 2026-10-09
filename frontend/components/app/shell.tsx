"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity, AlertTriangle, BookOpen, Boxes, FileBarChart2, FileUp, Globe2, LayoutDashboard, LifeBuoy,
  LogOut, Menu, MessageSquareText, NotebookPen, Settings, TrendingUp, X, Zap,
} from "lucide-react";
import { useApp } from "./app-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth";
import { cn } from "@/lib/format";
import type { Feature } from "@/lib/types";
import { Logo } from "@/components/logo";

type NavItem = { href: string; label: string; urdu: string; icon: React.ElementType; feature?: Feature };

const GROUPS: { title: string; items: NavItem[] }[] = [
  { title: "Overview", items: [{ href: "/dashboard", label: "Command Center", urdu: "ڈیش بورڈ", icon: LayoutDashboard }] },
  {
    title: "Records",
    items: [
      { href: "/transactions", label: "Digital Khata", urdu: "کھاتہ", icon: NotebookPen, feature: "ledger" },
      { href: "/import", label: "Import CSV", urdu: "ڈیٹا شامل کریں", icon: FileUp, feature: "import" },
      { href: "/inventory", label: "Inventory", urdu: "اسٹاک", icon: Boxes, feature: "inventory" },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { href: "/forecast", label: "Cash Forecast", urdu: "پیشگوئی", icon: TrendingUp, feature: "forecast" },
      { href: "/alerts", label: "Risk & Alerts", urdu: "خطرات", icon: AlertTriangle, feature: "alerts" },
      { href: "/simulator", label: "Shock Simulator", urdu: "جھٹکا ٹیسٹ", icon: Zap, feature: "simulator" },
      { href: "/recovery", label: "Recovery", urdu: "بحالی", icon: LifeBuoy, feature: "recovery" },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/reports", label: "Reports", urdu: "رپورٹ", icon: FileBarChart2, feature: "reports" },
      { href: "/copilot", label: "Copilot", urdu: "مددگار", icon: MessageSquareText, feature: "copilot" },
      { href: "/impact", label: "SDG Impact", urdu: "اثرات", icon: Globe2, feature: "impact" },
      { href: "/learn", label: "Learn the terms", urdu: "سیکھیں", icon: BookOpen },
    ],
  },
];

const KIND_STYLE: Record<string, string> = {
  sme: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300",
  enterprise: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300",
  household: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  student: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300",
};

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { has } = useApp();
  return (
    <nav className="space-y-5 px-3 py-4" aria-label="Main">
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => !i.feature || has(i.feature));
        if (!items.length) return null;
        return (
          <div key={g.title}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{g.title}</p>
            <div className="space-y-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                      active
                        ? "bg-slate-900 font-medium text-white dark:bg-white dark:text-slate-900"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-slate-100",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", active ? "" : "text-slate-400 group-hover:text-brand-600")} />
                    <span className="flex-1 truncate">{item.label}</span>
                    <span className={cn("urdu text-[11px]", active ? "opacity-80" : "text-slate-400")}>{item.urdu}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

const PATH_FEATURE: Record<string, Feature> = Object.fromEntries(
  GROUPS.flatMap((g) => g.items).filter((i) => i.feature).map((i) => [i.href, i.feature as Feature]),
);

function ModuleGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { has, business } = useApp();
  const feature = Object.entries(PATH_FEATURE).find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1];
  if (feature && !has(feature)) {
    return (
      <div className="mx-auto mt-16 max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
        <p className="text-base font-semibold text-slate-900 dark:text-white">Not part of your account type</p>
        <p className="mt-2 text-sm text-slate-500">This module isn&apos;t available for {business.kind_label.toLowerCase()} accounts. Each login has one account type; sign up with a different account to use other modules.</p>
        <Link href="/dashboard" className="mt-5 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-slate-900">Back to dashboard</Link>
      </div>
    );
  }
  return <>{children}</>;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { business, me } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const logout = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-[#070b14]">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950 lg:flex">
        <div className="flex h-16 items-center border-b border-slate-100 px-5 dark:border-slate-800">
          <Link href="/dashboard" aria-label="FinDost home"><Logo /></Link>
        </div>
        <div className="flex-1 overflow-y-auto"><NavList /></div>
        <div className="border-t border-slate-100 p-3 dark:border-slate-800">
          <Link href="/settings" className={cn("flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/70", pathname === "/settings" && "bg-slate-100 dark:bg-slate-800")}>
            <Settings className="h-4 w-4 text-slate-400" /> Settings
          </Link>
          <button onClick={logout} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/70">
            <LogOut className="h-4 w-4 text-slate-400" /> Sign out
          </button>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl dark:bg-slate-950">
            <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5 dark:border-slate-800">
              <Logo />
              <button onClick={() => setOpen(false)} aria-label="Close menu" className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto"><NavList onNavigate={() => setOpen(false)} /></div>
            <div className="border-t border-slate-100 p-3 dark:border-slate-800">
              <Link href="/settings" className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-600 dark:text-slate-400"><Settings className="h-4 w-4" /> Settings</Link>
              <button onClick={logout} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-600 dark:text-slate-400"><LogOut className="h-4 w-4" /> Sign out</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded-md p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 lg:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{business.name}</span>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", KIND_STYLE[business.kind])}>{business.kind}</span>
                {business.is_demo && (
                  <span title="All records in this workspace are fictional demo data" className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    Demo data
                  </span>
                )}
              </div>
              <p className="hidden truncate text-[11px] text-slate-500 sm:block">{business.kind_label}{business.city ? ` · ${business.city}` : ""} · PKR</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[11px] text-slate-500 md:flex"><Activity className="h-3.5 w-3.5 text-brand-600" /> {me.user.email ?? "Signed in"}</span>
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">
          <div className="print-container mx-auto max-w-7xl"><ModuleGuard>{children}</ModuleGuard></div>
        </main>
      </div>
    </div>
  );
}

export function PageHeader({ title, urdu, description, actions }: { title: string; urdu?: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="flex items-baseline gap-3 text-xl font-semibold tracking-tight text-slate-900 dark:text-white md:text-2xl">
          {title}
          {urdu && <span className="urdu text-base font-normal text-slate-400">{urdu}</span>}
        </h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
