"use client";

import React, { useState } from "react";
import { useApp } from "@/lib/state/store";
import { Card } from "@/components/shared/card";
import { Badge } from "@/components/shared/badge";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  Line,
} from "recharts";
import { moneyToRupeesNumber, formatMoney, createMoneyFromRupees } from "@/lib/domain/money";
import { Eye, Table, Info } from "lucide-react";

export function CashFlowChart() {
  const { dashboardData, activeWorkspace } = useApp();
  const [showTableView, setShowTableView] = useState(false);

  const forecast = dashboardData.forecast;

  const chartData = forecast.points.map((pt, idx) => {
    const baselineRupees = moneyToRupeesNumber(pt.baseline);
    const p10Rupees = pt.p10 ? moneyToRupeesNumber(pt.p10) : baselineRupees * 0.85;
    const p90Rupees = pt.p90 ? moneyToRupeesNumber(pt.p90) : baselineRupees * 1.15;

    return {
      date: pt.date.slice(5), // MM-DD
      fullDate: pt.date,
      baseline: baselineRupees,
      p10: Math.round(p10Rupees),
      p90: Math.round(p90Rupees),
      isHistorical: idx === 0,
    };
  });

  return (
    <Card
      title="90-Day Cash Flow Projection & Scenario Envelopes"
      subtitle="Deterministic cash run rate projection with illustrative P10 (conservative) & P90 (favorable) boundaries"
      action={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-[11px]">
            {forecast.source === "api" ? "API Live Model" : "Seeded Deterministic Engine"}
          </Badge>
          <button
            onClick={() => setShowTableView(!showTableView)}
            className="p-1 rounded text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
            title="Toggle tabular data view"
          >
            {showTableView ? <Eye className="w-4 h-4" /> : <Table className="w-4 h-4" />}
          </button>
        </div>
      }
    >
      <div className="mb-3 p-2.5 rounded bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2">
        <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            Methodology Notice:{" "}
          </span>
          The P10/P90 projection envelopes shown below are <strong>illustrative seeded projections</strong> derived from a deterministic 7-day run rate calculation. They do not constitute machine-learned probabilistic guarantees.
        </div>
      </div>

      {!showTableView ? (
        <div className="h-72 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="p90Band" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0284c7" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#0284c7" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} vertical={false} />
              <XAxis
                dataKey="date"
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
              />
              <YAxis
                stroke="#64748b"
                fontSize={11}
                tickLine={false}
                tickFormatter={(val) => `Rs. ${(val / 1000).toLocaleString()}k`}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded shadow-md text-xs space-y-1">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {data.fullDate} {data.isHistorical ? "(Current Baseline)" : "(Projected)"}
                        </div>
                        <div className="text-slate-700 dark:text-slate-300">
                          Baseline: <span className="font-bold">{formatMoney(createMoneyFromRupees(data.baseline))}</span>
                        </div>
                        <div className="text-blue-600 dark:text-blue-400">
                          P90 Favorable: {formatMoney(createMoneyFromRupees(data.p90))}
                        </div>
                        <div className="text-amber-600 dark:text-amber-400">
                          P10 Conservative: {formatMoney(createMoneyFromRupees(data.p10))}
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                wrapperStyle={{ paddingBottom: 10, fontSize: 11 }}
              />
              <Area
                type="monotone"
                dataKey="p90"
                name="P90 (Optimistic Inflow)"
                stroke="#0284c7"
                strokeDasharray="4 4"
                fill="url(#p90Band)"
              />
              <Area
                type="monotone"
                dataKey="p10"
                name="P10 (Conservative Inflow)"
                stroke="#d97706"
                strokeDasharray="4 4"
                fill="none"
              />
              <Line
                type="monotone"
                dataKey="baseline"
                name="Baseline Run-Rate"
                stroke="#0f172a"
                strokeWidth={2.5}
                dot={{ r: 3, fill: "#0f172a" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 font-semibold border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="px-3 py-2">Interval Date</th>
                <th className="px-3 py-2">Baseline Net Balance</th>
                <th className="px-3 py-2">P10 Conservative</th>
                <th className="px-3 py-2">P90 Optimistic</th>
                <th className="px-3 py-2">Type</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {chartData.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300">{row.fullDate}</td>
                  <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">
                    {formatMoney(createMoneyFromRupees(row.baseline))}
                  </td>
                  <td className="px-3 py-2 text-amber-700 dark:text-amber-400">
                    {formatMoney(createMoneyFromRupees(row.p10))}
                  </td>
                  <td className="px-3 py-2 text-blue-700 dark:text-blue-400">
                    {formatMoney(createMoneyFromRupees(row.p90))}
                  </td>
                  <td className="px-3 py-2 text-slate-400">
                    {row.isHistorical ? "Current Anchor" : "Projected"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
