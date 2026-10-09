"use client";

import React from "react";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { CashFlowChart } from "@/components/dashboard/cash-flow-chart";
import { AnomaliesList } from "@/components/dashboard/anomalies-list";
import { useApp } from "@/lib/state/store";
import { Clock, ShieldAlert, Sparkles, ArrowRight } from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
  const { activeWorkspace, isDemoMode } = useApp();

  return (
    <div className="space-y-6">
      {/* Top Banner showing Persona Context and Hero Workflow guidance */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono">
              {activeWorkspace.kind.toUpperCase()} WORKSPACE
            </span>
            <span className="text-xs text-slate-500">
              {activeWorkspace.displayName}
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
            {activeWorkspace.description}
          </p>
        </div>

        {activeWorkspace.kind === "sme" && (
          <div className="flex items-center gap-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-2.5 rounded-md">
            <div className="text-xs text-emerald-900 dark:text-emerald-300">
              <span className="font-bold">Hero Demo Tour:</span> Review low-confidence receipt in Ingestion, or collect Udhaar to extend runway.
            </div>
            <Link
              href="/upload"
              className="text-xs font-medium text-emerald-800 dark:text-emerald-300 hover:underline flex items-center shrink-0"
            >
              Start Tour <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </Link>
          </div>
        )}
      </div>

      {/* KPI Cards */}
      <KpiCards />

      {/* Cash Flow Projection Chart */}
      <CashFlowChart />

      {/* Operational Anomalies & Risk Signals */}
      <AnomaliesList />
    </div>
  );
}
