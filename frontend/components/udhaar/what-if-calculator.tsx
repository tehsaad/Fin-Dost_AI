"use client";

import React, { useState, useMemo } from "react";
import { UdhaarRecord } from "@/types/domain";
import { formatMoney, createMoneyFromPaisa, moneyToRupeesNumber } from "@/lib/domain/money";
import { Card } from "@/components/shared/card";
import { Badge } from "@/components/shared/badge";
import { Button } from "@/components/shared/button";
import { Calculator, ArrowRight, CheckCircle2, TrendingUp, RefreshCw } from "lucide-react";
import { useApp } from "@/lib/state/store";

interface WhatIfCalculatorProps {
  records: UdhaarRecord[];
}

export function WhatIfCalculator({ records }: WhatIfCalculatorProps) {
  const { dashboardData } = useApp();
  const currentRunway = dashboardData.kpis.runwayDays;

  // Track which records user hypothetically collects
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    // Default to top 2 overdue
    return records.filter((r) => r.status === "overdue").slice(0, 2).map((r) => r.id);
  });

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selectAllOverdue = () => {
    setSelectedIds(records.filter((r) => r.status === "overdue").map((r) => r.id));
  };

  const clearAll = () => {
    setSelectedIds([]);
  };

  // Compute hypothetical collection amount exactly
  const hypotheticalCollectedPaisa = useMemo(() => {
    let sum = 0n;
    for (const id of selectedIds) {
      const rec = records.find((r) => r.id === id);
      if (rec && rec.status !== "settled") {
        sum += BigInt(rec.outstanding.amountPaisa);
      }
    }
    return sum;
  }, [selectedIds, records]);

  const hypotheticalMoney = createMoneyFromPaisa(hypotheticalCollectedPaisa);

  // Compute extended runway:
  // Each 50,000 PKR collected adds ~11-14 days based on daily net drain
  const dailyDrainPaisa = useMemo(() => {
    const monthlyOut = BigInt(dashboardData.kpis.monthlyOutflow);
    const monthlyIn = BigInt(dashboardData.kpis.monthlyInflow);
    const net = monthlyOut > monthlyIn ? (monthlyOut - monthlyIn) / 30n : 100000n; // fallback to 1k PKR/day
    return net > 0n ? net : 100000n;
  }, [dashboardData]);

  const addedRunwayDays = useMemo(() => {
    if (hypotheticalCollectedPaisa === 0n) return 0;
    return Math.round(Number(hypotheticalCollectedPaisa / dailyDrainPaisa));
  }, [hypotheticalCollectedPaisa, dailyDrainPaisa]);

  const simulatedTotalRunway = currentRunway + addedRunwayDays;

  return (
    <Card
      title="“What If I Collect?” Runway Expansion Calculator"
      subtitle="Select debtors to simulate the immediate working capital expansion from prompt recoveries"
      action={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={selectAllOverdue}>
            Select All Overdue
          </Button>
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Reset
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Debtor checklist */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {records.filter(r => r.status !== "settled").map((rec) => {
            const isSelected = selectedIds.includes(rec.id);
            return (
              <label
                key={rec.id}
                className={`flex items-start gap-2.5 p-2.5 rounded border text-xs cursor-pointer transition-colors ${
                  isSelected
                    ? "border-slate-900 bg-slate-50 dark:border-slate-400 dark:bg-slate-800 font-medium"
                    : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300"
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(rec.id)}
                  className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-semibold text-slate-900 dark:text-slate-100">
                    {rec.customerName}
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mt-0.5">
                    <span>{rec.ageBucket} ({rec.status})</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                      {formatMoney(rec.outstanding)}
                    </span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Calculation Result Banner */}
        <div className="p-4 rounded-lg bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
              Simulated Collection Injection
            </div>
            <div className="text-xl font-bold tracking-tight">
              {formatMoney(hypotheticalMoney)}
            </div>
            <div className="text-xs text-slate-300 dark:text-slate-600 mt-0.5">
              Across {selectedIds.length} selected accounts
            </div>
          </div>

          <div className="flex items-center gap-4 border-t sm:border-t-0 sm:border-l border-slate-700 dark:border-slate-300 pt-3 sm:pt-0 sm:pl-6">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-semibold">
                Cash Runway Impact
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-emerald-400 dark:text-emerald-600">
                  +{addedRunwayDays} Days
                </span>
                <span className="text-xs text-slate-300 dark:text-slate-600">
                  (From {currentRunway}d to <strong>{simulatedTotalRunway}d</strong>)
                </span>
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500">
                Formula: (Recovered Amount) / (30-day net daily outflow)
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
