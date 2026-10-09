"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/state/store";
import { Anomaly } from "@/types/domain";
import { Card } from "@/components/shared/card";
import { Badge } from "@/components/shared/badge";
import { Modal } from "@/components/shared/modal";
import { formatMoney } from "@/lib/domain/money";
import { AlertCircle, FileText, CheckCircle2, ArrowRight } from "lucide-react";
import Link from "next/link";

export function AnomaliesList() {
  const { anomalies, activeWorkspace, transactions } = useApp();
  const [selectedAnomaly, setSelectedAnomaly] = useState<Anomaly | null>(null);

  const getSeverityBadge = (sev: Anomaly["severity"]) => {
    switch (sev) {
      case "critical":
        return <Badge variant="danger">Critical Action Needed</Badge>;
      case "warning":
        return <Badge variant="warning">Attention Required</Badge>;
      case "info":
        return <Badge variant="info">Operational Note</Badge>;
    }
  };

  return (
    <>
      <Card
        title="Detected Operational Anomalies & Risk Signals"
        subtitle={`System monitored active risk signals for ${activeWorkspace.name}`}
      >
        {anomalies.length === 0 ? (
          <div className="py-8 text-center text-slate-500 text-xs">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            No anomalies detected. Operations align with historical run rates.
          </div>
        ) : (
          <div className="space-y-3">
            {anomalies.map((anom) => (
              <div
                key={anom.id}
                className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    {getSeverityBadge(anom.severity)}
                    <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {anom.title}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {anom.explanation}
                  </p>
                  <div className="flex items-center gap-4 text-[11px] text-slate-500 pt-1">
                    <span>
                      Detected: <strong className="font-mono">{anom.detectedAt}</strong>
                    </span>
                    <span>
                      Window: <strong className="font-mono">{anom.period}</strong>
                    </span>
                    {anom.amount && (
                      <span className="text-slate-700 dark:text-slate-200">
                        Variance Impact: <strong>{formatMoney(anom.amount)}</strong>
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setSelectedAnomaly(anom)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    Inspect Evidence
                  </button>
                  {anom.kind === "overdue_udhaar" && (
                    <Link
                      href="/udhaar"
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white transition-colors"
                    >
                      Resolve in Udhaar
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  )}
                  {anom.kind === "supplier_price" && (
                    <Link
                      href="/simulator"
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-white transition-colors"
                    >
                      Stress Test in Simulator
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Evidence Inspection Modal */}
      {selectedAnomaly && (
        <Modal
          isOpen={!!selectedAnomaly}
          onClose={() => setSelectedAnomaly(null)}
          title={`Supporting Evidence: ${selectedAnomaly.title}`}
          description={`Grounding trace for anomaly detected on ${selectedAnomaly.detectedAt}`}
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 space-y-1">
              <div className="font-semibold text-slate-800 dark:text-slate-200">
                Audit Rule Explanation:
              </div>
              <p className="text-slate-600 dark:text-slate-300 leading-normal">
                {selectedAnomaly.explanation}
              </p>
            </div>

            <div>
              <div className="font-semibold text-slate-800 dark:text-slate-200 mb-2">
                Referenced Synthetic Documents & Ledgers ({selectedAnomaly.sourceRefs.length})
              </div>
              <div className="space-y-1.5">
                {selectedAnomaly.sourceRefs.map((ref, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-500" />
                      <span className="font-mono text-slate-800 dark:text-slate-200">{ref}</span>
                    </div>
                    <Badge variant="outline">Verified Synthetic Ingestion</Badge>
                  </div>
                ))}
              </div>
            </div>

            {selectedAnomaly.transactionIds.length > 0 && (
              <div>
                <div className="font-semibold text-slate-800 dark:text-slate-200 mb-2">
                  Contributing Transactions
                </div>
                <div className="space-y-1.5">
                  {selectedAnomaly.transactionIds.map((txId) => {
                    const tx = transactions.find((t) => t.id === txId);
                    if (!tx) return null;
                    return (
                      <div
                        key={tx.id}
                        className="p-2.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-between"
                      >
                        <div>
                          <div className="font-medium text-slate-900 dark:text-slate-100">
                            {tx.merchant}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {tx.occurredAt} • {tx.category} • Ref: {tx.sourceRef}
                          </div>
                        </div>
                        <div className="font-bold text-slate-900 dark:text-slate-100">
                          {formatMoney(tx.amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="pt-2 text-right">
              <button
                onClick={() => setSelectedAnomaly(null)}
                className="px-3 py-1.5 text-xs rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200"
              >
                Close Audit View
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
