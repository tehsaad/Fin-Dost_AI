"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { ModeIndicator } from "./mode-indicator";
import { ThemeToggle } from "./theme-toggle";
import { Menu, X, LayoutDashboard, UploadCloud, BookOpenCheck, TrendingDown, FileSpreadsheet } from "lucide-react";
import { useApp } from "@/lib/state/store";

export function Header() {
  const pathname = usePathname();
  const { activeWorkspace } = useApp();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const getPageInfo = () => {
    switch (pathname) {
      case "/dashboard":
        return { title: "Executive Cash Flow Overview", subtitle: "Working capital, runway forecast & risk alerts" };
      case "/upload":
        return { title: "Ingestion & Extraction Review Station", subtitle: "Audit synthetic OCR fields & verify confidence tags" };
      case "/udhaar":
        return { title: "Customer Udhaar & Receivables Ledger", subtitle: "Track aging buckets, FIFO settlement & collection impact" };
      case "/simulator":
        return { title: "Deterministic Shock Simulator", subtitle: "Stress test supply chain spikes & evaluate recovery levers" };
      case "/reports":
        return { title: "Actionable Recommendations & Reports", subtitle: "Evidence traceability, preliminary tax & credit health" };
      default:
        return { title: "FinDost AI", subtitle: "Financial Operations" };
    }
  };

  const { title, subtitle } = getPageInfo();

  const isBusiness = activeWorkspace.kind === "sme" || activeWorkspace.kind === "enterprise";

  const mobileNav = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { name: "Ingestion & Review", href: "/upload", icon: UploadCloud },
    { name: "Udhaar Manager", href: "/udhaar", icon: BookOpenCheck, disabled: !isBusiness },
    { name: "Shock Simulator", href: "/simulator", icon: TrendingDown },
    { name: "Reports & Evidence", href: "/reports", icon: FileSpreadsheet },
  ];

  return (
    <header className="h-16 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-4 md:px-6 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-1.5 rounded md:hidden text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        <div className="hidden sm:block">
          <h1 className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-tight">
            {title}
          </h1>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">
            {subtitle}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <WorkspaceSwitcher />
        <ModeIndicator />
        <ThemeToggle />
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-x-0 top-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 p-4 space-y-2 md:hidden z-30 shadow-lg">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 pb-1">
            Navigation
          </div>
          {mobileNav.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            if (item.disabled) return null;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded text-sm ${
                  isActive
                    ? "bg-slate-900 text-white font-medium dark:bg-slate-100 dark:text-slate-900"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </div>
      )}
    </header>
  );
}
