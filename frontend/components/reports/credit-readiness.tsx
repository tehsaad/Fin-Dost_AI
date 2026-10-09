"use client";

import React from "react";
import { CreditReadiness } from "@/types/domain";
import { Card } from "@/components/shared/card";
import { Badge } from "@/components/shared/badge";
import { useApp } from "@/lib/state/store";
import { ShieldCheck, Info, CheckCircle2, AlertCircle } from "lucide-react";

interface CreditReadinessProps {
  creditReadiness: CreditReadiness;
}

export function CreditReadinessView({ creditReadiness }: CreditReadinessProps) {
  const { toggleShariahWording } = useApp();

  const isShariah = creditReadiness.isShariahCompliantWording;

  const getStatusBadge = (status: "good" | "moderate" | "attention") => {
    switch (status) {
      case "good":
        return <Badge variant="success">Strong Compliance</Badge>;
      case "moderate":
        return <Badge variant="warning">Adequate</Badge>;
      case "attention":
        return <Badge variant="danger">Improvement Target</Badge>;
    }
  };

  return (
    <Card
      title={
        isShariah
          ? "Islamic Financing Readiness (Murabaha / Musawamah)"
          : "Commercial Credit Readiness & Risk Profile"
      }
      subtitle={
        isShariah
          ? "Underwriting criteria mapped for Shariah-compliant asset-backed trade facilities"
          : "Underwriting criteria mapped for conventional bank working capital facilities"
      }
      action={
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-600 dark:text-slate-300">
            <span>Shariah Terminology:</span>
            <input
              type="checkbox"
              checked={isShariah}
              onChange={toggleShariahWording}
              className="rounded border-slate-300 text-slate-900 focus:ring-slate-400"
            />
          </label>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Score Header */}
        <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full border-4 border-slate-900 dark:border-slate-100 flex items-center justify-center font-bold text-xl text-slate-900 dark:text-slate-100">
              {creditReadiness.overallScore}
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {isShariah
                  ? "Islamic Trade Facility Readiness Index"
                  : "Overall Credit Readiness Score"}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Calculated across {creditReadiness.factors.length} verifiable transaction pillars
              </div>
            </div>
          </div>

          <div className="text-right">
            <Badge variant={creditReadiness.overallScore >= 75 ? "success" : "warning"}>
              {creditReadiness.overallScore >= 75 ? "Tier-1 Bank Ready" : "Developing Buffer"}
            </Badge>
          </div>
        </div>

        {/* Factors Breakdown */}
        <div className="space-y-2.5">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
            Weighted Factor Assessment
          </div>
          {creditReadiness.factors.map((factor, idx) => (
            <div
              key={idx}
              className="p-3 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  {isShariah && factor.name.includes("Debt")
                    ? factor.name.replace("Debt", "Trade Financing")
                    : factor.name}
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-slate-500 font-bold">{factor.score}/100</span>
                  {getStatusBadge(factor.status)}
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    factor.score >= 80
                      ? "bg-emerald-600"
                      : factor.score >= 65
                      ? "bg-amber-500"
                      : "bg-red-500"
                  }`}
                  style={{ width: `${factor.score}%` }}
                />
              </div>

              <div className="text-[11px] text-slate-500 flex justify-between">
                <span>{factor.details}</span>
                <span className="text-slate-400">Weight: {factor.weight}%</span>
              </div>
            </div>
          ))}
        </div>

        {/* Disclaimer */}
        <div className="p-3 bg-slate-100/60 dark:bg-slate-800/30 rounded border border-slate-200/60 dark:border-slate-700/60 text-[11px] text-slate-500 flex items-start gap-2">
          <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          <span>
            <strong>Disclaimer:</strong> {creditReadiness.disclaimer} This scoring model is an operational pre-screening utility and does not constitute certified underwriting, regulatory endorsement, or official Shariah fatwa.
          </span>
        </div>
      </div>
    </Card>
  );
}
