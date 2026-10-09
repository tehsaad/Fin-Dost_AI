"use client";

import React, { useState } from "react";
import { Recommendation } from "@/types/domain";
import { Card } from "@/components/shared/card";
import { Badge } from "@/components/shared/badge";
import { formatMoney } from "@/lib/domain/money";
import { EvidenceModal } from "./evidence-modal";
import { useApp } from "@/lib/state/store";
import { FileText, ArrowUpRight, Clock, ShieldCheck, Sparkles } from "lucide-react";

interface RecommendationsProps {
  recommendations: Recommendation[];
}

export function Recommendations({ recommendations }: RecommendationsProps) {
  const { transactions, udhaarRecords, activeWorkspace } = useApp();
  const [activeRecommendation, setActiveRecommendation] = useState<Recommendation | null>(null);

  return (
    <>
      <Card
        title="Grounded Operational Recommendations"
        subtitle={`Actionable, evidence-backed improvements for ${activeWorkspace.name}`}
      >
        <div className="space-y-3">
          {recommendations.map((rec) => (
            <div
              key={rec.id}
              className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="neutral" className="uppercase font-mono text-[10px]">
                    {rec.category}
                  </Badge>
                  <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {rec.title}
                  </h3>
                </div>

                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                  {rec.plainReason}
                </p>

                <div className="flex items-center gap-4 text-[11px] text-slate-500 pt-1">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-400" />
                    Horizon: <strong>{rec.timeHorizon}</strong>
                  </span>
                  <span>
                    Evidence Sources:{" "}
                    <strong>{rec.evidenceSourceRefs.length} referenced</strong>
                  </span>
                </div>
              </div>

              <div className="flex flex-row md:flex-col items-center md:items-end justify-between md:justify-center gap-2 shrink-0 border-t md:border-t-0 pt-2 md:pt-0">
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Estimated Liquidity Impact
                  </div>
                  <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                    +{formatMoney(rec.estimatedImpact)}
                  </div>
                </div>

                <button
                  onClick={() => setActiveRecommendation(rec)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-500" />
                  Inspect Evidence
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <EvidenceModal
        isOpen={!!activeRecommendation}
        onClose={() => setActiveRecommendation(null)}
        recommendation={activeRecommendation}
        transactions={transactions}
        udhaarRecords={udhaarRecords}
      />
    </>
  );
}
