"use client";

import React, { useState } from "react";
import { Modal } from "@/components/shared/modal";
import { Button } from "@/components/shared/button";
import { UdhaarRecord } from "@/types/domain";
import { formatMoney, moneyToRupeesNumber, createMoneyFromRupees } from "@/lib/domain/money";
import { Info, CheckCircle2, AlertCircle } from "lucide-react";

interface SettlementModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: UdhaarRecord | null;
  onSettle: (recordId: string, amountPaisa: string, note?: string) => void;
}

export function SettlementModal({ isOpen, onClose, record, onSettle }: SettlementModalProps) {
  const [settlementType, setSettlementType] = useState<"full" | "partial">("full");
  const [partialAmount, setPartialAmount] = useState<string>("");
  const [note, setNote] = useState<string>("Received counter cash / bank deposit");
  const [error, setError] = useState<string | null>(null);

  if (!record) return null;

  const totalOutstandingRupees = moneyToRupeesNumber(record.outstanding);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    let amountPaisaToSettle: string;

    if (settlementType === "full") {
      amountPaisaToSettle = record.outstanding.amountPaisa;
    } else {
      const num = parseFloat(partialAmount.replace(/,/g, ""));
      if (isNaN(num) || num <= 0) {
        setError("Please enter a valid positive settlement amount.");
        return;
      }
      if (num > totalOutstandingRupees) {
        setError(`Partial amount cannot exceed total outstanding balance of Rs. ${totalOutstandingRupees.toLocaleString()}`);
        return;
      }
      amountPaisaToSettle = createMoneyFromRupees(num).amountPaisa;
    }

    onSettle(record.id, amountPaisaToSettle, note);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Settle Customer Account: ${record.customerName}`}
      description="Record partial or full recovery against customer khata record"
    >
      <form onSubmit={handleSubmit} className="space-y-4 text-xs">
        <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-500">Customer:</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">{record.customerName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Total Outstanding Balance:</span>
            <span className="font-bold text-red-700 dark:text-red-400 font-mono">
              {formatMoney(record.outstanding)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">Aging Category:</span>
            <span className="font-semibold uppercase">{record.ageBucket} ({record.status})</span>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block font-medium text-slate-700 dark:text-slate-300">
            Settlement Allocation Strategy
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSettlementType("full")}
              className={`p-2.5 rounded border text-left transition-colors ${
                settlementType === "full"
                  ? "border-slate-900 bg-slate-100 dark:border-slate-400 dark:bg-slate-800 font-semibold"
                  : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              }`}
            >
              <div>Full Settlement</div>
              <div className="text-[10px] text-slate-500 font-normal">
                Clear all {formatMoney(record.outstanding)}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setSettlementType("partial")}
              className={`p-2.5 rounded border text-left transition-colors ${
                settlementType === "partial"
                  ? "border-slate-900 bg-slate-100 dark:border-slate-400 dark:bg-slate-800 font-semibold"
                  : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              }`}
            >
              <div>Partial FIFO Payment</div>
              <div className="text-[10px] text-slate-500 font-normal">
                Apply custom cash recovery
              </div>
            </button>
          </div>
        </div>

        {settlementType === "partial" && (
          <div>
            <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
              Received Recovery Amount (PKR)
            </label>
            <input
              type="number"
              step="any"
              required
              value={partialAmount}
              onChange={(e) => setPartialAmount(e.target.value)}
              placeholder="e.g. 25000"
              className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono"
            />
          </div>
        )}

        <div>
          <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
            Settlement Method / Audit Note
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
          />
        </div>

        {error && (
          <div className="p-2.5 rounded bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="p-2.5 bg-slate-100/70 dark:bg-slate-800/40 rounded border border-slate-200/60 dark:border-slate-700/60 text-[11px] text-slate-500 flex items-start gap-2">
          <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <span>
            <strong>Local Demo Safety:</strong> In this demo environment, confirming settlement updates local simulated ledger state and injects an offsetting cash inflow into your working balance. No actual banking or payment gateway transaction is executed.
          </span>
        </div>

        <div className="pt-3 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm">
            Confirm Settlement
          </Button>
        </div>
      </form>
    </Modal>
  );
}
