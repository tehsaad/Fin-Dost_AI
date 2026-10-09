"use client";

import React from "react";
import { useApp } from "@/lib/state/store";
import { formatMoney, formatPakistaniScale } from "@/lib/domain/money";
import { createMoneyFromPaisa } from "@/lib/domain/money";
import { Wallet, Hourglass, ArrowUpRight, ArrowDownRight, BookOpen, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/shared/badge";

export function KpiCards() {
  const { dashboardData, activeWorkspace } = useApp();
  const { kpis } = dashboardData;

  const netBalanceMoney = createMoneyFromPaisa(kpis.netBalance);
  const monthlyInflowMoney = createMoneyFromPaisa(kpis.monthlyInflow);
  const monthlyOutflowMoney = createMoneyFromPaisa(kpis.monthlyOutflow);
  const udhaarMoney = createMoneyFromPaisa(kpis.totalOutstandingUdhaar);

  const isBusiness = activeWorkspace.kind === "sme" || activeWorkspace.kind === "enterprise";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {/* 1. Net Working Balance */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-subtle">
        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
          <span className="text-xs font-medium">Net Working Balance</span>
          <Wallet className="w-4 h-4 text-slate-700 dark:text-slate-300" />
        </div>
        <div className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
          {formatMoney(netBalanceMoney)}
        </div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
          <span className="text-slate-400">Scale:</span>
          <span className="font-semibold text-slate-700 dark:text-slate-300">
            {formatPakistaniScale(netBalanceMoney)}
          </span>
        </div>
      </div>

      {/* 2. Cash Runway Days */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-subtle">
        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
          <span className="text-xs font-medium">Cash Runway (30d Rate)</span>
          <Hourglass className="w-4 h-4 text-slate-700 dark:text-slate-300" />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            {kpis.runwayDays} Days
          </span>
          <Badge
            variant={
              kpis.runwayDays > 90
                ? "success"
                : kpis.runwayDays > 45
                ? "warning"
                : "danger"
            }
          >
            {kpis.runwayDays > 90 ? "Stable" : kpis.runwayDays > 45 ? "Moderate" : "Shortage Risk"}
          </Badge>
        </div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500">
          <span>Zero-inflow survival:</span>
          <span className="font-medium text-slate-700 dark:text-slate-300">
            ~{Math.round(kpis.runwayDays / 30)} Months
          </span>
        </div>
      </div>

      {/* 3. Monthly Run Rate (Inflow vs Outflow) */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-subtle">
        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
          <span className="text-xs font-medium">Monthly Inflow / Outflow</span>
          <div className="flex items-center gap-1">
            <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" />
            <ArrowDownRight className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Inflow:</span>
            <span className="font-semibold text-emerald-700 dark:text-emerald-400">
              {formatMoney(monthlyInflowMoney)}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Outflow:</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {formatMoney(monthlyOutflowMoney)}
            </span>
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500">
          <span>Net monthly cash flow:</span>
          <span
            className={`font-semibold ${
              BigInt(monthlyInflowMoney.amountPaisa) >= BigInt(monthlyOutflowMoney.amountPaisa)
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-red-700 dark:text-red-400"
            }`}
          >
            {formatMoney(createMoneyFromPaisa(BigInt(monthlyInflowMoney.amountPaisa) - BigInt(monthlyOutflowMoney.amountPaisa)))}
          </span>
        </div>
      </div>

      {/* 4. Udhaar / Receivables (Business) or Savings Buffer (Student/Household) */}
      {isBusiness ? (
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-subtle">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-medium">Uncollected Udhaar</span>
            <BookOpen className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            {formatMoney(udhaarMoney)}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px]">
            <span className="text-slate-400">Overdue accounts:</span>
            <span className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1">
              {kpis.overdueUdhaarCount > 0 && <AlertTriangle className="w-3 h-3 text-amber-600" />}
              {kpis.overdueUdhaarCount} Overdue
            </span>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-subtle">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-medium">Budget Buffer Margin</span>
            <Wallet className="w-4 h-4 text-blue-600" />
          </div>
          <div className="text-xl font-bold text-emerald-700 dark:text-emerald-400 tracking-tight">
            +18.4%
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500">
            <span>Monthly retention:</span>
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Positive surplus
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
