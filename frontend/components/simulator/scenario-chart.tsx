"use client";

import React from "react";
import { Card } from "@/components/shared/card";
import { Badge } from "@/components/shared/badge";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { SimulationResult } from "@/lib/domain/scenarios";
import { formatMoney, createMoneyFromRupees } from "@/lib/domain/money";
import { AlertCircle, CheckCircle2, TrendingDown } from "lucide-react";

interface ScenarioChartProps {
  simulation: SimulationResult;
}

export function ScenarioChart({ simulation }: ScenarioChartProps) {
  const { points, shortageDate, shortageGap, isSolvent } = simulation;

  return (
    <Card
      title="Stress Test Projection: Baseline vs Simulated Stressed Trajectory"
      subtitle="Evaluates 90-day cash survival under active macroeconomic shocks and offsetting recovery levers"
      action={
        <div className="flex items-center gap-2">
          {isSolvent ? (
            <Badge variant="success">
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Cash Positive (No Shortage)
            </Badge>
          ) : (
            <Badge variant="danger">
              <AlertCircle className="w-3.5 h-3.5 mr-1" />
              Shortage Projected: {shortageDate}
            </Badge>
          )}
        </div>
      }
    >
      {!isSolvent && shortageDate && (
        <div className="mb-3 p-3 rounded bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-xs text-red-900 dark:text-red-200 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Liquidity Breach Detected on {shortageDate}: </span>
            Simulated cash balance exhausts working buffer, reaching a peak shortfall of{" "}
            <strong>{formatMoney(shortageGap)}</strong>. Activate recovery levers below to close this gap.
          </div>
        </div>
      )}

      <div className="h-72 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.2} vertical={false} />
            <XAxis
              dataKey="date"
              stroke="#64748b"
              fontSize={11}
              tickLine={false}
              tickFormatter={(d) => d.slice(5)}
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
                        {data.date} (Day {data.day})
                      </div>
                      <div className="text-slate-700 dark:text-slate-300">
                        Baseline Run-Rate: <strong>{formatMoney(createMoneyFromRupees(data.baselineRupees))}</strong>
                      </div>
                      <div className={data.simulatedRupees < 0 ? "text-red-600 font-bold" : "text-emerald-600 font-bold"}>
                        Simulated Balance: {formatMoney(createMoneyFromRupees(data.simulatedRupees))}
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
            <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="3 3" label={{ value: "Liquidity Zero (Breach)", fill: "#dc2626", fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey="baselineRupees"
              name="Baseline Trajectory"
              stroke="#64748b"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="simulatedRupees"
              name="Simulated Stressed Trajectory"
              stroke={isSolvent ? "#059669" : "#b91c1c"}
              strokeWidth={2.5}
              dot={{ r: 3, fill: isSolvent ? "#059669" : "#b91c1c" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
