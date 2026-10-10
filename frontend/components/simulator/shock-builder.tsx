"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/shared/button";
import { Field, Input, Select } from "@/components/shared/form";
import { rupeesToPaisa } from "@/lib/format";
import type { Adjustment, Receivable } from "@/lib/types";

const SHOCKS = [
  { type: "sales_decline", label: "Sudden decline in sales" },
  { type: "delayed_payment", label: "Delayed customer payment" },
  { type: "supplier_price_increase", label: "Supplier price increase" },
  { type: "unexpected_expense", label: "Unexpected expense" },
  { type: "utility_increase", label: "Electricity / utility bill increase" },
  { type: "rent_increase", label: "Rent increase" },
  { type: "business_interruption", label: "Temporary business interruption" },
  { type: "flood_disruption", label: "Flood or disruption" },
  { type: "customer_loss", label: "Temporary loss of a major customer" },
];

export function describeAdjustment(a: Adjustment, customers: { id: string; name: string }[] = []): string {
  const n = (k: string) => a[k] as number;
  switch (a.type) {
    case "sales_decline": return `Sales −${n("percent")}% for ${n("duration_days") ?? "all"} days from day ${n("start_day") ?? 1}`;
    case "delayed_payment": return `${a.receivable_ids ? `${(a.receivable_ids as string[]).length} invoice(s)` : `Top ${n("top_n") ?? 3} customers`} pay ${n("delay_days")} days late`;
    case "supplier_price_increase": return `Supplier prices +${n("percent")}% from day ${n("start_day") ?? 1}`;
    case "unexpected_expense": return `${a.label ?? "Unexpected expense"} Rs. ${(n("amount_paisa") / 100).toLocaleString()} on day ${n("day")}`;
    case "utility_increase": return `Utility bills +${n("percent")}%`;
    case "rent_increase": return `Rent +${n("percent")}% from day ${n("start_day") ?? 1}`;
    case "business_interruption": return `Closed ${n("duration_days")} days from day ${n("start_day")} (sales −${n("revenue_loss_percent")}%)`;
    case "flood_disruption": return `Flood: ${n("duration_days")} days, sales −${n("revenue_loss_percent")}%, repairs Rs. ${(n("repair_cost_paisa") / 100).toLocaleString()}`;
    case "customer_loss": return `${customers.find((c) => c.id === a.customer_id)?.name ?? "Customer"} pauses for ${n("duration_days")} days`;
    default: return a.type.replace(/_/g, " ");
  }
}

export function ShockBuilder({ onAdd, receivables, customers, hasReceivables }: {
  onAdd: (a: Adjustment) => void; receivables: Receivable[]; customers: { id: string; name: string }[]; hasReceivables: boolean;
}) {
  const options = SHOCKS.filter((s) => hasReceivables || !["delayed_payment", "customer_loss"].includes(s.type));
  const [type, setType] = useState(options[0].type);
  const [p, setP] = useState<Record<string, string>>({ percent: "20", start_day: "1", duration_days: "14", delay_days: "30", amount: "50000", day: "5",
    revenue_loss_percent: "100", repair_cost: "60000", receivable_delay_days: "14", top_n: "3" });
  const [recIds, setRecIds] = useState<string[]>([]);
  const [customer, setCustomer] = useState(customers[0]?.id ?? "");
  const num = (k: string) => Number(p[k]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: e.target.value });

  const build = (): Adjustment | null => {
    switch (type) {
      case "sales_decline": return { type, percent: num("percent"), start_day: num("start_day"), duration_days: num("duration_days") };
      case "delayed_payment": return recIds.length ? { type, receivable_ids: recIds, delay_days: num("delay_days") } : { type, top_n: num("top_n"), delay_days: num("delay_days") };
      case "supplier_price_increase": return { type, percent: num("percent"), start_day: num("start_day") };
      case "unexpected_expense": { const a = rupeesToPaisa(p.amount); return a ? { type, amount_paisa: a, day: num("day"), label: "Unexpected expense" } : null; }
      case "utility_increase": return { type, percent: num("percent") };
      case "rent_increase": return { type, percent: num("percent"), start_day: num("start_day") };
      case "business_interruption": return { type, start_day: num("start_day"), duration_days: num("duration_days"), revenue_loss_percent: num("revenue_loss_percent") };
      case "flood_disruption": return { type, start_day: num("start_day"), duration_days: num("duration_days"), revenue_loss_percent: num("revenue_loss_percent"), repair_cost_paisa: rupeesToPaisa(p.repair_cost) ?? 0, receivable_delay_days: num("receivable_delay_days") };
      case "customer_loss": return customer ? { type, customer_id: customer, duration_days: num("duration_days") } : null;
    }
    return null;
  };

  const show = (k: string) => ({
    sales_decline: ["percent", "start_day", "duration_days"],
    delayed_payment: ["delay_days", "top_n"],
    supplier_price_increase: ["percent", "start_day"],
    unexpected_expense: ["amount", "day"],
    utility_increase: ["percent"],
    rent_increase: ["percent", "start_day"],
    business_interruption: ["start_day", "duration_days", "revenue_loss_percent"],
    flood_disruption: ["start_day", "duration_days", "revenue_loss_percent", "repair_cost", "receivable_delay_days"],
    customer_loss: ["duration_days"],
  } as Record<string, string[]>)[type]?.includes(k);

  const LABELS: Record<string, string> = { percent: "Change (%)", start_day: "Starts on day", duration_days: "Duration (days)", delay_days: "Delay (days)",
    amount: "Amount (Rs.)", day: "On day", revenue_loss_percent: "Sales lost (%)", repair_cost: "Repair cost (Rs.)", receivable_delay_days: "Collections delayed (days)", top_n: "Largest N customers" };

  return (
    <div className="space-y-3">
      <Field label="Shock type" htmlFor="shock-type">
        <Select id="shock-type" value={type} onChange={(e) => setType(e.target.value)}>{options.map((s) => <option key={s.type} value={s.type}>{s.label}</option>)}</Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        {Object.keys(LABELS).filter(show).map((k) => (
          <Field key={k} label={LABELS[k]} htmlFor={`shock-${k}`}><Input id={`shock-${k}`} inputMode="decimal" value={p[k]} onChange={set(k)} /></Field>
        ))}
      </div>
      {type === "delayed_payment" && receivables.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-slate-600 dark:text-slate-400">Or pick specific invoices</p>
          <div className="max-h-36 space-y-1 overflow-y-auto rounded border border-slate-200 p-2 dark:border-slate-700">
            {receivables.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={recIds.includes(r.id)} onChange={(e) => setRecIds(e.target.checked ? [...recIds, r.id] : recIds.filter((x) => x !== r.id))} />
                {r.customer_name} · Rs. {(r.outstanding_paisa / 100).toLocaleString()} · due {r.due_on}
              </label>
            ))}
          </div>
        </div>
      )}
      {type === "customer_loss" && (
        <Field label="Customer" htmlFor="shock-customer">
          <Select id="shock-customer" value={customer} onChange={(e) => setCustomer(e.target.value)}>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </Field>
      )}
      <Button variant="outline" className="w-full" onClick={() => { const a = build(); if (a) onAdd(a); }}><Plus className="h-4 w-4" /> Add shock</Button>
    </div>
  );
}
