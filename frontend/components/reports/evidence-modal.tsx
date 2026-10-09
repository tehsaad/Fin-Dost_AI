"use client";

import React from "react";
import { Modal } from "@/components/shared/modal";
import { Recommendation, Transaction, UdhaarRecord } from "@/types/domain";
import { formatMoney } from "@/lib/domain/money";
import { Badge } from "@/components/shared/badge";
import { Button } from "@/components/shared/button";
import { FileText, ArrowRight, ShieldCheck, AlertCircle } from "lucide-react";

interface EvidenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  recommendation: Recommendation | null;
  transactions: Transaction[];
  udhaarRecords: UdhaarRecord[];
}

export function EvidenceModal({
  isOpen,
  onClose,
  recommendation,
  transactions,
  udhaarRecords,
}: EvidenceModalProps) {
  if (!recommendation) return null;

  const relevantTxs = transactions.filter((t) =>
    recommendation.evidenceTransactionIds.includes(t.id)
  );

  const relevantUdhaar = udhaarRecords.filter((u) =>
    recommendation.evidenceSourceRefs.includes(u.sourceRef || "")
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Evidence Trace: ${recommendation.title}`}
      description="Inspect contributing synthetic documents, ledger leaves, and transactions grounding this insight"
    >
      <div className="space-y-4 text-xs">
        {/* Recommendation context */}
        <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Operational Rationale:
            </span>
            <Badge variant="success">Impact: {formatMoney(recommendation.estimatedImpact)}</Badge>
          </div>
          <p className="text-slate-600 dark:text-slate-300">
            {recommendation.plainReason}
          </p>
          <div className="text-[11px] text-slate-500 pt-1">
            Horizon: <strong>{recommendation.timeHorizon}</strong> • Category:{" "}
            <strong>{recommendation.category.toUpperCase()}</strong>
          </div>
        </div>

        {/* Synthetic Document Sources */}
        <div>
          <div className="font-semibold text-slate-800 dark:text-slate-200 mb-2 flex items-center justify-between">
            <span>Grounding Documents & Source Refs ({recommendation.evidenceSourceRefs.length})</span>
            <Badge variant="outline">Verified Synthetic Ingestion</Badge>
          </div>

          {recommendation.evidenceSourceRefs.length === 0 ? (
            <div className="p-4 text-center text-slate-400 bg-slate-50 dark:bg-slate-800/40 rounded border border-slate-200 dark:border-slate-800">
              No direct external documents referenced for this rule.
            </div>
          ) : (
            <div className="space-y-2">
              {recommendation.evidenceSourceRefs.map((ref, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-500" />
                    <span className="font-mono text-slate-800 dark:text-slate-200">{ref}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Archived Document Ref</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Contributing Transactions */}
        {relevantTxs.length > 0 && (
          <div>
            <div className="font-semibold text-slate-800 dark:text-slate-200 mb-2">
              Contributing Transactions ({relevantTxs.length})
            </div>
            <div className="space-y-1.5">
              {relevantTxs.map((tx) => (
                <div
                  key={tx.id}
                  className="p-2.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-between"
                >
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      {tx.merchant}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {tx.occurredAt} • {tx.category} • Ref: {tx.sourceRef}
                    </div>
                  </div>
                  <div className="font-bold text-slate-900 dark:text-slate-100">
                    {formatMoney(tx.amount)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contributing Udhaar */}
        {relevantUdhaar.length > 0 && (
          <div>
            <div className="font-semibold text-slate-800 dark:text-slate-200 mb-2">
              Contributing Udhaar Debtor Accounts ({relevantUdhaar.length})
            </div>
            <div className="space-y-1.5">
              {relevantUdhaar.map((udh) => (
                <div
                  key={udh.id}
                  className="p-2.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-between"
                >
                  <div>
                    <div className="font-semibold text-slate-800 dark:text-slate-200">
                      {udh.customerName}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      Aging: {udh.ageBucket} • Status: {udh.status} • Khata Ref: {udh.sourceRef}
                    </div>
                  </div>
                  <div className="font-bold text-red-700 dark:text-red-400">
                    {formatMoney(udh.outstanding)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Assumptions */}
        <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 rounded border border-slate-200 dark:border-slate-700 space-y-1">
          <span className="font-semibold text-slate-700 dark:text-slate-300">
            Explicit Assumptions:
          </span>
          <ul className="list-disc pl-4 text-[11px] text-slate-500">
            {recommendation.assumptions.map((ass, i) => (
              <li key={i}>{ass}</li>
            ))}
          </ul>
        </div>

        <div className="pt-2 text-right">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close Evidence Trace
          </Button>
        </div>
      </div>
    </Modal>
  );
}
