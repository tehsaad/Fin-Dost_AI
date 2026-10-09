"use client";

import React from "react";
import { RecoveryAction } from "@/types/domain";
import { Card } from "@/components/shared/card";
import { Badge } from "@/components/shared/badge";
import { formatMoney } from "@/lib/domain/money";
import { ShieldCheck, CheckCircle2, ArrowUpRight } from "lucide-react";

interface RecoveryLeversProps {
  recoveries: RecoveryAction[];
  onToggleRecovery: (id: string) => void;
  isSolvent: boolean;
}

export function RecoveryLevers({ recoveries, onToggleRecovery, isSolvent }: RecoveryLeversProps) {
  return (
    <Card
      title="Managerial Recovery Levers (Counter-Measures)"
      subtitle="Click levers to inject liquidity or compress variable expenditure to avert projected shortages"
    >
      <div className="space-y-3">
        {recoveries.map((rec) => {
          return (
            <div
              key={rec.id}
              onClick={() => onToggleRecovery(rec.id)}
              className={`p-3.5 rounded-lg border cursor-pointer transition-colors flex items-start justify-between gap-3 ${
                rec.active
                  ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20"
                  : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={rec.active}
                  onChange={() => {}} // handled by parent div
                  className="mt-1 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                />
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    {rec.label}
                    <Badge variant="success">
                      +{formatMoney(rec.estimatedImpact)} Liquidity Impact
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {rec.description}
                  </p>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <span
                  className={`text-[11px] font-semibold ${
                    rec.active ? "text-emerald-700 dark:text-emerald-400" : "text-slate-400"
                  }`}
                >
                  {rec.active ? "LEVER APPLIED" : "AVAILABLE"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
