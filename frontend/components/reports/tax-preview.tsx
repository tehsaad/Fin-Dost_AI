"use client";

import React from "react";
import { TaxPreview } from "@/types/domain";
import { Card } from "@/components/shared/card";
import { Badge } from "@/components/shared/badge";
import { formatMoney } from "@/lib/domain/money";
import { AlertCircle, FileText, CheckCircle2, Info } from "lucide-react";

interface TaxPreviewProps {
  taxPreview: TaxPreview;
}

export function TaxPreviewView({ taxPreview }: TaxPreviewProps) {
  return (
    <Card
      title={`Pakistan Tax & Withholding Preview (${taxPreview.taxYear})`}
      subtitle="Operational deduction analysis mapped against the Federal Board of Revenue (FBR) Income Tax Ordinance"
      action={
        <Badge variant="warning" className="font-bold">
          Preliminary Estimate — FBR Validation Required
        </Badge>
      }
    >
      <div className="space-y-4">
        {/* Prominent FBR Regulatory Disclaimer Banner */}
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Preliminary Estimate — FBR Validation Required: </span>
            This assessment is an illustrative operational estimate based on seeded transaction receipts and standard slab assumptions. It does not replace certified tax consultancy, formal IRIS e-filing, or official FBR audit compliance.
          </div>
        </div>

        {/* Top Summary Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
            <span className="text-[11px] text-slate-500">Gross Annual Turnover</span>
            <div className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
              {formatMoney(taxPreview.estimatedGrossInflow)}
            </div>
          </div>

          <div className="p-3 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
            <span className="text-[11px] text-slate-500">Documented Expenses</span>
            <div className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
              {formatMoney(taxPreview.totalExpenses)}
            </div>
          </div>

          <div className="p-3 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
            <span className="text-[11px] text-slate-500">Allowable Deductions</span>
            <div className="text-base font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
              {formatMoney(taxPreview.deductibleExpenses)}
            </div>
          </div>

          <div className="p-3 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800">
            <span className="text-[11px] text-slate-500">Illustrative Estimated Tax</span>
            <div className="text-base font-bold text-slate-900 dark:text-slate-100 mt-0.5">
              {formatMoney(taxPreview.illustrativeEstimatedTax)}
            </div>
          </div>
        </div>

        {/* Deductible Categories breakdown */}
        {taxPreview.deductibleCategories.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Eligible Deductible Expense Classifications
            </div>
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-slate-900">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 font-semibold border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="px-3.5 py-2">FBR Ordinance Category</th>
                    <th className="px-3.5 py-2">Documented Incurred</th>
                    <th className="px-3.5 py-2">Allowable %</th>
                    <th className="px-3.5 py-2">Deductible Value</th>
                    <th className="px-3.5 py-2">Statutory Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {taxPreview.deductibleCategories.map((cat, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="px-3.5 py-2 font-medium text-slate-900 dark:text-slate-100">
                        {cat.category}
                      </td>
                      <td className="px-3.5 py-2 font-mono text-slate-700 dark:text-slate-300">
                        {formatMoney(cat.spent)}
                      </td>
                      <td className="px-3.5 py-2 font-mono text-slate-600 dark:text-slate-400">
                        {cat.deductiblePercentage}%
                      </td>
                      <td className="px-3.5 py-2 font-mono font-bold text-emerald-700 dark:text-emerald-400">
                        {formatMoney(cat.deductibleAmount)}
                      </td>
                      <td className="px-3.5 py-2 text-[11px] text-slate-500">
                        {cat.note}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
