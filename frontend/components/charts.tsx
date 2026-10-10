"use client";

import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ReferenceDot, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { formatDate, formatPKR, formatScale } from "@/lib/format";
import type { ForecastPoint } from "@/lib/types";

const axisStyle = { fontSize: 11, fill: "#94a3b8" };

function MoneyTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number | number[]; color: string; dataKey: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <p className="mb-1 font-semibold text-slate-800 dark:text-slate-100">{formatDate(label, "long")}</p>
      {payload.filter((p) => p.value !== null && p.value !== undefined).map((p) => (
        <p key={p.dataKey} className="flex justify-between gap-4" style={{ color: p.color }}>
          <span>{p.name}</span>
          <span className="tabular font-medium">
            {Array.isArray(p.value) ? `${formatPKR(p.value[0])} – ${formatPKR(p.value[1])}` : formatPKR(p.value)}
          </span>
        </p>
      ))}
    </div>
  );
}

export function BalanceChart({ history, points, reserve = 0, shortageDate, height = 300, scenario, scenarioLabel = "Scenario" }: {
  history: { date: string; balance_paisa: number }[];
  points: ForecastPoint[];
  reserve?: number;
  shortageDate?: string | null;
  height?: number;
  scenario?: { date: string; balance_paisa: number }[];
  scenarioLabel?: string;
}) {
  const byDate = new Map<string, Record<string, unknown>>();
  for (const h of history) byDate.set(h.date, { date: h.date, actual: h.balance_paisa });
  const scen = new Map((scenario ?? []).map((s) => [s.date, s.balance_paisa]));
  for (const p of points) {
    const row = byDate.get(p.date) ?? { date: p.date };
    row.forecast = p.balance_paisa;
    if (p.day > 0) row.band = [p.low_paisa, p.high_paisa];
    if (scen.has(p.date)) row.scenario = scen.get(p.date);
    byDate.set(p.date, row);
  }
  const data = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const today = points[0]?.date;
  const shortage = shortageDate ? points.find((p) => p.date === shortageDate) : null;

  return (
    <div style={{ height }} className="w-full" role="img" aria-label="Cash balance: recorded history and projected forecast">
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="bandFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.18} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} tick={axisStyle} minTickGap={24} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => formatScale(v)} tick={axisStyle} width={58} axisLine={false} tickLine={false} />
          <Tooltip content={<MoneyTooltip />} />
          <Area type="monotone" dataKey="band" name="Range for everyday variation" stroke="none" fill="url(#bandFill)" isAnimationActive={false} />
          <Line type="monotone" dataKey="actual" name="Actual balance" stroke="#64748b" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#2563eb" strokeWidth={2.2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
          {scenario && <Line type="monotone" dataKey="scenario" name={scenarioLabel} stroke="#c026d3" strokeWidth={2.2} dot={false} isAnimationActive={false} />}
          <ReferenceLine y={0} stroke="#dc2626" strokeWidth={1.2} label={{ value: "Rs. 0", position: "insideTopLeft", fill: "#dc2626", fontSize: 10 }} />
          {reserve > 0 && <ReferenceLine y={reserve} stroke="#d97706" strokeDasharray="4 4" label={{ value: "Reserve", position: "insideTopRight", fill: "#d97706", fontSize: 10 }} />}
          {today && <ReferenceLine x={today} stroke="#94a3b8" strokeDasharray="2 3" label={{ value: "Today", position: "top", fill: "#94a3b8", fontSize: 10 }} />}
          {shortage && <ReferenceDot x={shortage.date} y={shortage.balance_paisa} r={5} fill="#dc2626" stroke="#fff" strokeWidth={2} />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

const SERIES_COLORS = ["#64748b", "#c026d3", "#059669", "#2563eb", "#ea580c", "#0891b2"];

export function CompareChart({ series, height = 300, reserve = 0 }: {
  series: { id: string; label: string; points: { date: string; balance_paisa: number }[]; dashed?: boolean }[];
  height?: number;
  reserve?: number;
}) {
  const byDate = new Map<string, Record<string, unknown>>();
  series.forEach((s) => s.points.forEach((p) => {
    const row = byDate.get(p.date) ?? { date: p.date };
    row[s.id] = p.balance_paisa;
    byDate.set(p.date, row);
  }));
  const data = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return (
    <div style={{ height }} className="w-full" role="img" aria-label="Comparison of projected cash balances">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.18} vertical={false} />
          <XAxis dataKey="date" tickFormatter={(d) => formatDate(d)} tick={axisStyle} minTickGap={24} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={(v) => formatScale(v)} tick={axisStyle} width={58} axisLine={false} tickLine={false} />
          <Tooltip content={<MoneyTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine y={0} stroke="#dc2626" strokeWidth={1.2} />
          {reserve > 0 && <ReferenceLine y={reserve} stroke="#d97706" strokeDasharray="4 4" />}
          {series.map((s, i) => (
            <Line key={s.id} type="monotone" dataKey={s.id} name={s.label} stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={i === 0 ? 2 : 2.4} strokeDasharray={s.dashed || i === 0 ? "6 4" : undefined} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryBars({ data, height = 240 }: { data: { category: string; amount_paisa: number }[]; height?: number }) {
  const colors = ["#059669", "#10b981", "#34d399", "#6ee7b7", "#94a3b8", "#cbd5e1", "#e2e8f0", "#f1f5f9"];
  return (
    <div style={{ height }} className="w-full" role="img" aria-label="Spending by category">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="category" tick={{ ...axisStyle, fill: "#64748b" }} width={130} axisLine={false} tickLine={false} />
          <Tooltip formatter={(v: number) => formatPKR(v)} cursor={{ fill: "rgba(148,163,184,0.1)" }} />
          <Bar dataKey="amount_paisa" name="Amount" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
