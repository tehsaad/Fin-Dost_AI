"use client";

import React, { useState } from "react";
import { Dropzone } from "@/components/upload/dropzone";
import { ReviewTable } from "@/components/upload/review-table";
import { useApp } from "@/lib/state/store";
import { createMoneyFromRupees } from "@/lib/domain/money";
import { Card } from "@/components/shared/card";
import { Badge } from "@/components/shared/badge";
import { CheckCircle2, Loader2, Sparkles, Plus, Info } from "lucide-react";
import { Modal } from "@/components/shared/modal";
import { Button } from "@/components/shared/button";

export default function UploadPage() {
  const { activeWorkspace, importTransactions } = useApp();
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState<string | null>(null);
  const [showManualModal, setShowManualModal] = useState(false);

  // Manual transaction inputs
  const [manualMerchant, setManualMerchant] = useState("");
  const [manualCategory, setManualCategory] = useState("Operating Expenses");
  const [manualAmount, setManualAmount] = useState("");
  const [manualDirection, setManualDirection] = useState<"inflow" | "outflow">("outflow");

  const runSimulatedExtraction = (sourceTitle: string) => {
    setIsProcessing(true);
    setProcessingStage("Validating file header & integrity...");

    setTimeout(() => {
      setProcessingStage("Running local synthetic Pakistani OCR parser...");
    }, 700);

    setTimeout(() => {
      setProcessingStage("Normalizing amounts & assigning confidence tags...");
    }, 1400);

    setTimeout(() => {
      // Ingest new realistic rows tailored to the workspace
      if (activeWorkspace.kind === "sme") {
        importTransactions([
          {
            workspaceId: activeWorkspace.id,
            occurredAt: "2026-10-09",
            merchant: "Habib Oil Mills Wholesale",
            amount: createMoneyFromRupees(52000),
            direction: "outflow",
            category: "Inventory Restock",
            confidence: 0.94,
            reviewStatus: "confirmed",
            sourceRef: "INV-HOM-7712.pdf",
          },
          {
            workspaceId: activeWorkspace.id,
            occurredAt: "2026-10-09",
            merchant: "Counter Cash & Easypaisa Inflow",
            amount: createMoneyFromRupees(41500),
            direction: "inflow",
            category: "Retail Sales",
            confidence: 0.65,
            reviewStatus: "needs_review",
            sourceRef: "POS-SLIP-1009.jpg",
          },
        ]);
      } else {
        importTransactions([
          {
            workspaceId: activeWorkspace.id,
            occurredAt: "2026-10-09",
            merchant: `${activeWorkspace.name} - Utility Settlement`,
            amount: createMoneyFromRupees(15000),
            direction: "outflow",
            category: "Utilities",
            confidence: 0.95,
            reviewStatus: "confirmed",
            sourceRef: "ONLINE-TRF-BILL",
          },
        ]);
      }

      setIsProcessing(false);
      setProcessingStage(null);
    }, 2200);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualMerchant || !manualAmount) return;

    importTransactions([
      {
        workspaceId: activeWorkspace.id,
        occurredAt: new Date().toISOString().split("T")[0],
        merchant: manualMerchant,
        amount: createMoneyFromRupees(manualAmount),
        direction: manualDirection,
        category: manualCategory,
        confidence: 1.0,
        reviewStatus: "confirmed",
        sourceRef: "MANUAL-INPUT",
      },
    ]);

    setShowManualModal(false);
    setManualMerchant("");
    setManualAmount("");
  };

  return (
    <div className="space-y-6">
      {/* Top Description */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Intake & Human-in-the-Loop Review Station
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Ingest invoices, receipts, and bank statements for {activeWorkspace.displayName}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowManualModal(true)}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add Manual Entry
          </Button>
        </div>
      </div>

      {/* Processing Animation Modal / Indicator */}
      {isProcessing && (
        <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 flex items-center gap-3 animate-pulse">
          <Loader2 className="w-5 h-5 text-blue-600 animate-spin shrink-0" />
          <div className="text-xs">
            <div className="font-semibold text-blue-900 dark:text-blue-200">
              Processing Synthetic Document...
            </div>
            <div className="text-blue-700 dark:text-blue-300 font-mono">
              {processingStage}
            </div>
          </div>
        </div>
      )}

      {/* Dropzone & Sample Intake */}
      <Dropzone
        onFileAccepted={(file) => runSimulatedExtraction(file.name)}
        onSampleRequested={() => runSimulatedExtraction("FMCG Sample Batch")}
        isProcessing={isProcessing}
      />

      {/* Extracted Transactions Review Station */}
      <ReviewTable />

      {/* Manual Entry Modal */}
      <Modal
        isOpen={showManualModal}
        onClose={() => setShowManualModal(false)}
        title="Create Manual Transaction Entry"
        description="Add a verified accounting entry directly to current workspace records"
      >
        <form onSubmit={handleManualSubmit} className="space-y-3 text-xs">
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Merchant / Counterparty Name
            </label>
            <input
              type="text"
              required
              value={manualMerchant}
              onChange={(e) => setManualMerchant(e.target.value)}
              placeholder="e.g. Metro Wholesale / LESCO Bill"
              className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Amount (PKR)
              </label>
              <input
                type="number"
                step="any"
                required
                value={manualAmount}
                onChange={(e) => setManualAmount(e.target.value)}
                placeholder="e.g. 35000"
                className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Direction
              </label>
              <select
                value={manualDirection}
                onChange={(e) => setManualDirection(e.target.value as "inflow" | "outflow")}
                className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              >
                <option value="outflow">Outflow (Expense / Supplier)</option>
                <option value="inflow">Inflow (Sales / Deposit)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Category
            </label>
            <input
              type="text"
              value={manualCategory}
              onChange={(e) => setManualCategory(e.target.value)}
              className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="pt-3 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowManualModal(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm">
              Save & Recalculate
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
