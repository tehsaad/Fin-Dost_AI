"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/lib/state/store";
import {
  LayoutDashboard,
  UploadCloud,
  BookOpenCheck,
  TrendingDown,
  FileSpreadsheet,
  Lock,
  Sparkles,
} from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();
  const { activeWorkspace } = useApp();

  const isBusiness = activeWorkspace.kind === "sme" || activeWorkspace.kind === "enterprise";

  const navItems = [
    {
      name: "Dashboard",
      href: "/dashboard",
      icon: LayoutDashboard,
      description: "Overview & cash runway",
    },
    {
      name: "Ingestion & Review",
      href: "/upload",
      icon: UploadCloud,
      description: "Receipt & statement intake",
    },
    {
      name: "Udhaar Manager",
      href: "/udhaar",
      icon: BookOpenCheck,
      description: isBusiness ? "Receivables & aging ledger" : "Business only feature",
      restricted: !isBusiness,
    },
    {
      name: "Shock Simulator",
      href: "/simulator",
      icon: TrendingDown,
      description: "Stress test & recovery levers",
    },
    {
      name: "Reports & Evidence",
      href: "/reports",
      icon: FileSpreadsheet,
      description: "Audit trail, tax & credit",
    },
  ];

  return (
    <aside className="w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between hidden md:flex shrink-0">
      <div>
        {/* Brand */}
        <div className="h-16 flex items-center px-6 border-b border-slate-100 dark:border-slate-800 gap-2.5">
          <div className="w-8 h-8 rounded bg-slate-900 dark:bg-white flex items-center justify-center text-white dark:text-slate-900 font-bold text-sm">
            FD
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-1.5">
              FinDost AI
              <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-1 rounded font-mono">
                PKR
              </span>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Financial Operations MVP
            </div>
          </div>
        </div>

        {/* Navigation list */}
        <nav className="p-3 space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between px-3 py-2.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4" />
                  <div>
                    <div>{item.name}</div>
                    <div
                      className={`text-[10px] ${
                        isActive
                          ? "text-slate-300 dark:text-slate-600"
                          : "text-slate-400 dark:text-slate-500"
                      }`}
                    >
                      {item.description}
                    </div>
                  </div>
                </div>

                {item.restricted && (
                  <span
                    title="Available for SME & Enterprise personas"
                    className="p-1 text-slate-400"
                  >
                    <Lock className="w-3 h-3" />
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer info box */}
      <div className="p-4 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 space-y-1">
        <div className="flex items-center justify-between text-slate-700 dark:text-slate-300 font-medium">
          <span>AICON&apos;26 Build With AI</span>
          <span className="text-[10px] font-mono">v0.9-MVP</span>
        </div>
        <p className="text-[10px] text-slate-400 leading-normal">
          Deterministic financial ops engine with inspectable AI evidence extraction.
        </p>
      </div>
    </aside>
  );
}
