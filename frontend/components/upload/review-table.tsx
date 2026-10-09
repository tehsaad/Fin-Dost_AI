"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/state/store";
import { Transaction } from "@/types/domain";
import { formatMoney, createMoneyFromRupees, moneyToRupeesNumber } from "@/lib/domain/money";
import { Badge } from "@/components/shared/badge";
import { Button } from "@/components/shared/button";
import { Edit2, Check, X, History, Sparkles, AlertCircle, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/shared/modal";

export function ReviewTable() {
  const { transactions, editTransaction, activeWorkspace } = useApp();

  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMerchant, setEditMerchant] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");

  // Audit history modal
  const [auditTarget, setAuditTarget] = useState<Transaction | null>(null);

  // Status notification when an edit causes a recalculation
  const [recalcBanner, setRecalcBanner] = useState<string | null>(null);

  const startEditing = (tx: Transaction) => {
    setEditingId(tx.id);
    setEditMerchant(tx.merchant);
    setEditCategory(tx.category);
    setEditAmount(moneyToRupeesNumber(tx.amount).toString());
    setEditNote(tx.correctionNote || "Corrected vendor name & categorized expense");
  };

  const cancelEditing = () => {
    setEditingId(null);
  };

  const saveEditing = (id: string) => {
    editTransaction(id, {
      merchant: editMerchant,
      category: editCategory,
      amountRupees: editAmount,
      note: editNote,
    });
    setEditingId(null);
    setRecalcBanner(`Transaction verified. Dashboard cash-flow run-rate, runway days, and 90-day forecast have been deterministically updated.`);
    setTimeout(() => setRecalcBanner(null), 6000);
  };

  const getConfidenceBadge = (tx: Transaction) => {
    if (tx.reviewStatus === "confirmed" && !tx.isEdited) {
      return (
        <Badge variant="success">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          High ({Math.round((tx.confidence || 0.95) * 100)}%)
        </Badge>
      );
    }
    if (tx.isEdited) {
      return (
        <Badge variant="info">
          <History className="w-3 h-3 text-blue-600" />
          Verified & Edited
        </Badge>
      );
    }
    return (
      <Badge variant="warning">
        <AlertCircle className="w-3 h-3 text-amber-600" />
        Needs Review ({Math.round((tx.confidence || 0.6) * 100)}%)
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      {recalcBanner && (
        <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{recalcBanner}</span>
          </div>
          <button
            onClick={() => setRecalcBanner(null)}
            className="text-emerald-700 dark:text-emerald-400 font-bold hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Extracted Transactions & Review Station
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Review synthetic OCR extractions. Correcting uncertain fields triggers live forecast recomputation.
          </p>
        </div>
        <div className="text-xs text-slate-500 font-mono">
          {transactions.filter((t) => t.reviewStatus === "needs_review").length} requiring review
        </div>
      </div>

      <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-3.5 py-2.5">Date</th>
                <th className="px-3.5 py-2.5">Merchant / Source Entity</th>
                <th className="px-3.5 py-2.5">Category</th>
                <th className="px-3.5 py-2.5">Direction</th>
                <th className="px-3.5 py-2.5">Exact Amount (PKR)</th>
                <th className="px-3.5 py-2.5">Source Ref</th>
                <th className="px-3.5 py-2.5">Confidence</th>
                <th className="px-3.5 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {transactions.map((tx) => {
                const isEditing = editingId === tx.id;

                return (
                  <tr
                    key={tx.id}
                    className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors ${
                      tx.reviewStatus === "needs_review"
                        ? "bg-amber-50/30 dark:bg-amber-950/10"
                        : tx.isEdited
                        ? "bg-blue-50/20 dark:bg-blue-950/10"
                        : ""
                    }`}
                  >
                    {/* Date */}
                    <td className="px-3.5 py-2.5 font-mono text-slate-700 dark:text-slate-300">
                      {tx.occurredAt}
                    </td>

                    {/* Merchant */}
                    <td className="px-3.5 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editMerchant}
                          onChange={(e) => setEditMerchant(e.target.value)}
                          className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                        />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span>{tx.merchant}</span>
                          {tx.isEdited && (
                            <button
                              onClick={() => setAuditTarget(tx)}
                              title="View before/after audit log"
                              className="text-blue-600 dark:text-blue-400 p-0.5 hover:underline"
                            >
                              <History className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Category */}
                    <td className="px-3.5 py-2.5 text-slate-600 dark:text-slate-400">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          className="w-full px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-slate-100"
                        />
                      ) : (
                        <span>{tx.category}</span>
                      )}
                    </td>

                    {/* Direction */}
                    <td className="px-3.5 py-2.5">
                      <span
                        className={`font-semibold ${
                          tx.direction === "inflow"
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-slate-700 dark:text-slate-300"
                        }`}
                      >
                        {tx.direction === "inflow" ? "+ Inflow" : "- Outflow"}
                      </span>
                    </td>

                    {/* Amount */}
                    <td className="px-3.5 py-2.5 font-semibold text-slate-900 dark:text-slate-100">
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <span className="text-slate-400 font-mono">Rs.</span>
                          <input
                            type="text"
                            value={editAmount}
                            onChange={(e) => setEditAmount(e.target.value)}
                            className="w-24 px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono text-slate-900 dark:text-slate-100"
                          />
                        </div>
                      ) : (
                        formatMoney(tx.amount)
                      )}
                    </td>

                    {/* Source Ref */}
                    <td className="px-3.5 py-2.5 font-mono text-[11px] text-slate-500">
                      {tx.sourceRef || "MANUAL-ENTRY"}
                    </td>

                    {/* Confidence */}
                    <td className="px-3.5 py-2.5">{getConfidenceBadge(tx)}</td>

                    {/* Actions */}
                    <td className="px-3.5 py-2.5 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => saveEditing(tx.id)}
                            title="Save human verification"
                          >
                            <Check className="w-3.5 h-3.5 mr-1" /> Save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={cancelEditing}
                            title="Cancel edit"
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant={tx.reviewStatus === "needs_review" ? "primary" : "outline"}
                          size="sm"
                          onClick={() => startEditing(tx)}
                        >
                          <Edit2 className="w-3 h-3 mr-1" />
                          {tx.reviewStatus === "needs_review" ? "Review" : "Edit"}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit History Modal */}
      {auditTarget && (
        <Modal
          isOpen={!!auditTarget}
          onClose={() => setAuditTarget(null)}
          title="Before / After Audit Trail"
          description={`Trace of user correction on Transaction ${auditTarget.id}`}
        >
          <div className="space-y-4 text-xs">
            <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200">
              <strong>Human-in-the-Loop Verification:</strong> This synthetic OCR extraction was flagged for low confidence and subsequently reviewed and corrected by an authorized operator.
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                <div className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] mb-2">
                  Initial AI / OCR Extraction
                </div>
                <div className="space-y-1.5">
                  <div>
                    <span className="text-slate-400">Merchant: </span>
                    <strong className="text-slate-700 dark:text-slate-300">
                      {auditTarget.originalMerchant ?? auditTarget.merchant}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Category: </span>
                    <span className="text-slate-700 dark:text-slate-300">
                      {auditTarget.originalCategory ?? auditTarget.category}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Amount: </span>
                    <strong className="text-slate-700 dark:text-slate-300">
                      {formatMoney(auditTarget.originalAmount ?? auditTarget.amount)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Initial Confidence: </span>
                    <Badge variant="warning">0.62 (Uncertain OCR)</Badge>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
                <div className="font-semibold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider text-[10px] mb-2">
                  Verified Final Record
                </div>
                <div className="space-y-1.5">
                  <div>
                    <span className="text-slate-400">Merchant: </span>
                    <strong className="text-emerald-900 dark:text-emerald-100">
                      {auditTarget.merchant}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Category: </span>
                    <span className="text-emerald-900 dark:text-emerald-100">
                      {auditTarget.category}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400">Amount: </span>
                    <strong className="text-emerald-900 dark:text-emerald-100">
                      {formatMoney(auditTarget.amount)}
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400">Verified Confidence: </span>
                    <Badge variant="success">1.00 (Human Audited)</Badge>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-2.5 rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-slate-400">Audit Justification: </span>
              <span className="font-mono text-slate-700 dark:text-slate-300">
                {auditTarget.correctionNote || "Verified by user operator"}
              </span>
            </div>

            <div className="text-right pt-2">
              <Button variant="secondary" size="sm" onClick={() => setAuditTarget(null)}>
                Close Audit Inspection
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
