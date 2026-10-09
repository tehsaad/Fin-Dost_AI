"use client";

import React from "react";
import { useApp } from "@/lib/state/store";
import { formatMoney, createMoneyFromPaisa } from "@/lib/domain/money";

export function PrintableReport() {
  const {
    activeWorkspace,
    dashboardData,
    recommendations,
    creditReadiness,
    taxPreview,
    isDemoMode,
  } = useApp();

  const generatedDate = new Date().toLocaleDateString("en-PK", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="hidden print:block print-container p-6 space-y-6 text-black bg-white">
      {/* Report Header */}
      <div className="border-b-2 border-black pb-4 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">FinDost AI Financial Operations Report</h1>
          <p className="text-sm text-gray-700 mt-1">
            Automated Executive Briefing & Audit Trace
          </p>
        </div>
        <div className="text-right text-xs text-gray-600 font-mono space-y-0.5">
          <div>Workspace: <strong>{activeWorkspace.name}</strong></div>
          <div>Persona: {activeWorkspace.kind.toUpperCase()}</div>
          <div>Generated: {generatedDate}</div>
          <div>Engine Status: {isDemoMode ? "Synthetic Demo Engine" : "Verified API"}</div>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-4 gap-4 border border-gray-300 p-4 rounded text-xs">
        <div>
          <div className="text-gray-500 font-semibold">Net Balance</div>
          <div className="text-lg font-bold">{formatMoney(createMoneyFromPaisa(dashboardData.kpis.netBalance))}</div>
        </div>
        <div>
          <div className="text-gray-500 font-semibold">Cash Runway</div>
          <div className="text-lg font-bold">{dashboardData.kpis.runwayDays} Days</div>
        </div>
        <div>
          <div className="text-gray-500 font-semibold">Monthly Outflow</div>
          <div className="text-lg font-bold">{formatMoney(createMoneyFromPaisa(dashboardData.kpis.monthlyOutflow))}</div>
        </div>
        <div>
          <div className="text-gray-500 font-semibold">Receivables</div>
          <div className="text-lg font-bold">{formatMoney(createMoneyFromPaisa(dashboardData.kpis.totalOutstandingUdhaar))}</div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wider border-b border-gray-300 pb-1">
          1. Priority Financial Recommendations & Evidence Grounding
        </h2>
        <table className="w-full text-xs text-left border border-gray-200">
          <thead className="bg-gray-100 border-b border-gray-200">
            <tr>
              <th className="p-2">Recommendation</th>
              <th className="p-2">Rationale</th>
              <th className="p-2">Impact</th>
              <th className="p-2">Evidence Sources</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {recommendations.map((rec) => (
              <tr key={rec.id}>
                <td className="p-2 font-semibold">{rec.title}</td>
                <td className="p-2">{rec.plainReason}</td>
                <td className="p-2 font-bold">+{formatMoney(rec.estimatedImpact)}</td>
                <td className="p-2 font-mono text-[10px]">{rec.evidenceSourceRefs.join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Credit / Trade Readiness */}
      {creditReadiness && (
        <div className="space-y-3 page-break">
          <h2 className="text-sm font-bold uppercase tracking-wider border-b border-gray-300 pb-1">
            2. Institutional Readiness & Underwriting Assessment (Score: {creditReadiness.overallScore}/100)
          </h2>
          <table className="w-full text-xs text-left border border-gray-200">
            <thead className="bg-gray-100 border-b border-gray-200">
              <tr>
                <th className="p-2">Assessment Pillar</th>
                <th className="p-2">Score</th>
                <th className="p-2">Weight</th>
                <th className="p-2">Audit Observation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {creditReadiness.factors.map((f, i) => (
                <tr key={i}>
                  <td className="p-2 font-semibold">{f.name}</td>
                  <td className="p-2 font-mono">{f.score}/100</td>
                  <td className="p-2">{f.weight}%</td>
                  <td className="p-2">{f.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-gray-500 italic">
            Disclaimer: {creditReadiness.disclaimer}
          </p>
        </div>
      )}

      {/* Tax Assessment */}
      {taxPreview && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wider border-b border-gray-300 pb-1">
            3. Tax & Withholding Deductibility Summary ({taxPreview.taxYear})
          </h2>
          <div className="p-2 bg-yellow-50 border border-yellow-300 rounded text-xs font-semibold text-yellow-900">
            Preliminary Estimate — FBR Validation Required. This is not certified tax advice.
          </div>
          <table className="w-full text-xs text-left border border-gray-200">
            <tbody className="divide-y divide-gray-200">
              <tr>
                <td className="p-2 font-semibold">Estimated Gross Turnover</td>
                <td className="p-2 font-mono">{formatMoney(taxPreview.estimatedGrossInflow)}</td>
              </tr>
              <tr>
                <td className="p-2 font-semibold">Allowable Business Deductions</td>
                <td className="p-2 font-mono">{formatMoney(taxPreview.deductibleExpenses)}</td>
              </tr>
              <tr>
                <td className="p-2 font-semibold">Illustrative Tax Estimate</td>
                <td className="p-2 font-mono">{formatMoney(taxPreview.illustrativeEstimatedTax)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Signature & Disclaimer Block */}
      <div className="pt-6 border-t border-gray-300 text-[10px] text-gray-500 space-y-1">
        <div>Generated via FinDost AI for AICON&apos;26 Build With AI.</div>
        <div>Notice: Fictional synthetic persona records utilized for judge evaluation. Calculations are deterministic.</div>
      </div>
    </div>
  );
}
