"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/state/store";
import { CustomerLedger } from "@/components/udhaar/customer-ledger";
import { WhatIfCalculator } from "@/components/udhaar/what-if-calculator";
import { SettlementModal } from "@/components/udhaar/settlement-modal";
import { UdhaarRecord } from "@/types/domain";
import { formatMoney, createMoneyFromPaisa } from "@/lib/domain/money";
import { Card } from "@/components/shared/card";
import { Badge } from "@/components/shared/badge";
import { Button } from "@/components/shared/button";
import {
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  Lock,
  ArrowRight,
  ShieldAlert,
  Users,
} from "lucide-react";
import Link from "next/link";

export default function UdhaarPage() {
  const { activeWorkspace, udhaarRecords, settleUdhaar, dashboardData } = useApp();
  const [selectedRecordForSettlement, setSelectedRecordForSettlement] = useState<UdhaarRecord | null>(null);
  const [settlementSuccessMsg, setSettlementSuccessMsg] = useState<string | null>(null);

  const isBusiness = activeWorkspace.kind === "sme" || activeWorkspace.kind === "enterprise";

  // Role-appropriate guard for Student & Household
  if (!isBusiness) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 mx-auto flex items-center justify-center">
          <Lock className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Udhaar & Receivables Ledger is Inactive for {activeWorkspace.displayName}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
            This module manages B2B customer credit, khata leaf tracing, and FIFO debt recovery. For individual student and household personas, receivables are not applicable.
          </p>
        </div>

        <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-left space-y-2">
          <div className="font-semibold text-slate-800 dark:text-slate-200">
            Recommended Action:
          </div>
          <p className="text-slate-600 dark:text-slate-400">
            Switch to the <strong>Bilal General Store (SME)</strong> or <strong>Indus Textiles (Enterprise)</strong> workspace via the top switcher to inspect active commercial Udhaar management, debt aging buckets, and settlement flows.
          </p>
          <div className="pt-2">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
            >
              Return to Workspace Dashboard <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSettlementConfirm = (recordId: string, amountPaisa: string, note?: string) => {
    const result = settleUdhaar(recordId, amountPaisa, note);
    const settledRupees = Number(BigInt(result.settledAmountPaisa) / 100n).toLocaleString();
    setSettlementSuccessMsg(`Settlement of Rs. ${settledRupees} recorded. Inflow credited to working balance; ledger updated.`);
    setTimeout(() => setSettlementSuccessMsg(null), 6000);
  };

  const totalOutstanding = dashboardData.kpis.totalOutstandingUdhaar;
  const overdueCount = dashboardData.kpis.overdueUdhaarCount;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Customer Udhaar Ledger & Receivables Recovery
            </h2>
            <Badge variant="outline">Net-30 Commercial Terms</Badge>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Manage trade debtors for {activeWorkspace.displayName}. All records reconcile with balance sheet working capital.
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs">
          <div className="p-2 rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <span className="text-slate-500">Total Uncollected:</span>{" "}
            <strong className="font-bold text-slate-900 dark:text-slate-100">
              {formatMoney(createMoneyFromPaisa(totalOutstanding))}
            </strong>
          </div>
          <div className="p-2 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300">
            <span>Overdue Accounts:</span> <strong>{overdueCount}</strong>
          </div>
        </div>
      </div>

      {settlementSuccessMsg && (
        <div className="p-3.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{settlementSuccessMsg}</span>
          </div>
          <button
            onClick={() => setSettlementSuccessMsg(null)}
            className="text-emerald-700 dark:text-emerald-400 font-bold hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* "What If I Collect?" Interactive Calculator */}
      <WhatIfCalculator records={udhaarRecords} />

      {/* Customer Ledger Table */}
      <CustomerLedger
        records={udhaarRecords}
        onOpenSettlement={(rec) => setSelectedRecordForSettlement(rec)}
      />

      {/* Settlement Drawer / Modal */}
      <SettlementModal
        isOpen={!!selectedRecordForSettlement}
        onClose={() => setSelectedRecordForSettlement(null)}
        record={selectedRecordForSettlement}
        onSettle={handleSettlementConfirm}
      />
    </div>
  );
}
