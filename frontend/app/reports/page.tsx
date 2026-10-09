"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/state/store";
import { Recommendations } from "@/components/reports/recommendations";
import { CreditReadinessView } from "@/components/reports/credit-readiness";
import { TaxPreviewView } from "@/components/reports/tax-preview";
import { PrintableReport } from "@/components/reports/printable-report";
import { Button } from "@/components/shared/button";
import { Badge } from "@/components/shared/badge";
import { Printer, FileDown, ShieldAlert, Sparkles, CheckCircle2 } from "lucide-react";

export default function ReportsPage() {
  const { activeWorkspace, recommendations, creditReadiness, taxPreview } = useApp();

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Top Banner with Print PDF Action */}
      <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Executive Financial Operations & Audit Report
            </h2>
            <Badge variant="outline">{activeWorkspace.name}</Badge>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Evidence-grounded recommendations, preliminary tax deductibility, and creditworthiness profile.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            onClick={handlePrint}
            title="Export clean PDF via browser print stylesheet"
          >
            <Printer className="w-3.5 h-3.5 mr-1.5" />
            Export PDF Report
          </Button>
        </div>
      </div>

      {/* Recommendations & Traceable Evidence */}
      <div className="no-print">
        <Recommendations recommendations={recommendations} />
      </div>

      {/* Credit Readiness Profile */}
      {creditReadiness && (
        <div className="no-print">
          <CreditReadinessView creditReadiness={creditReadiness} />
        </div>
      )}

      {/* Tax Deductibility Preview */}
      {taxPreview && (
        <div className="no-print">
          <TaxPreviewView taxPreview={taxPreview} />
        </div>
      )}

      {/* Print-only Report Layout (Rendered only on print / PDF export) */}
      <PrintableReport />
    </div>
  );
}
