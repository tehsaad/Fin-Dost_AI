"use client";

import React from "react";
import { ScenarioShock } from "@/types/domain";
import { Card } from "@/components/shared/card";
import { Badge } from "@/components/shared/badge";
import { formatMoney } from "@/lib/domain/money";
import { AlertTriangle, Zap, DollarSign, Clock } from "lucide-react";

interface ScenarioControlsProps {
  shocks: ScenarioShock[];
  onToggleShock: (id: string) => void;
}

export function ScenarioControls({ shocks, onToggleShock }: ScenarioControlsProps) {
  const getShockIcon = (kind: ScenarioShock["kind"]) => {
    switch (kind) {
      case "price_rise":
        return <TrendingUpIcon className="w-4 h-4 text-red-600" />;
      case "delayed_receivables":
        return <Clock className="w-4 h-4 text-amber-600" />;
      case "utility_spike":
        return <Zap className="w-4 h-4 text-orange-600" />;
      default:
        return <AlertTriangle className="w-4 h-4 text-slate-600" />;
    }
  };

  return (
    <Card
      title="Macroeconomic Shocks & Stress Factors"
      subtitle="Activate deterministic supply chain and operational shocks to test resilience"
    >
      <div className="space-y-3">
        {shocks.map((shock) => {
          return (
            <div
              key={shock.id}
              onClick={() => onToggleShock(shock.id)}
              className={`p-3.5 rounded-lg border cursor-pointer transition-colors flex items-start justify-between gap-3 ${
                shock.active
                  ? "border-red-300 bg-red-50/40 dark:border-red-900 dark:bg-red-950/20"
                  : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={shock.active}
                  onChange={() => {}} // handled by parent div
                  className="mt-1 rounded border-slate-300 text-red-600 focus:ring-red-500"
                />
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    {shock.label}
                    {shock.percent && (
                      <Badge variant="danger">+{shock.percent}% Outflow</Badge>
                    )}
                    {shock.delayDays && (
                      <Badge variant="warning">{shock.delayDays}d Cash Delay</Badge>
                    )}
                    {shock.amount && !shock.percent && (
                      <Badge variant="neutral">{formatMoney(shock.amount)}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {shock.description}
                  </p>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <span
                  className={`text-[11px] font-semibold ${
                    shock.active ? "text-red-700 dark:text-red-400" : "text-slate-400"
                  }`}
                >
                  {shock.active ? "SHOCK ACTIVE" : "INACTIVE"}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function TrendingUpIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}
