"use client";

import { useState } from "react";
import { AlertTriangle, ArrowDownUp, Boxes, PackagePlus, Snail } from "lucide-react";
import { PageHeader } from "@/components/app/shell";
import { Card } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { Field, Input, Select } from "@/components/shared/form";
import { EmptyState, ErrorState, Notice, PageSkeleton, Spinner, ValueTag } from "@/components/shared/feedback";
import { Modal } from "@/components/shared/modal";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { cn, formatDate, formatPKR, rupeesToPaisa, todayISO } from "@/lib/format";

interface Product {
  id: string; sku: string; name: string; unit: string; quantity: number; reorder_level: number; lead_time_days: number;
  unit_cost_paisa: number; sale_price_paisa: number; stock_value_paisa: number; gross_margin_pct: number | null;
  realized_margin_pct: number | null; daily_demand: number; demand_variability: number | null; sales_history_days: number;
  days_of_cover: number | null; low_stock: boolean; slow_moving: boolean; reorder_suggestion: number | null; reorder_note: string;
  sufficient_data: boolean; value_share_pct: number; high_exposure: boolean;
}
interface Inventory {
  total_value_paisa: number; product_count: number; low_stock_count: number; slow_moving_count: number; products: Product[];
  assumptions: string[]; recent_movements: { id: string; product: string; date: string; type: string; quantity: number; unit_value_paisa: number; note: string | null }[];
}

export default function InventoryPage() {
  const { data, error, reload } = useApi<Inventory>("/inventory");
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<Product | null>(null);
  const [filter, setFilter] = useState<"all" | "low" | "slow">("all");
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <PageSkeleton />;
  const products = data.products.filter((p) => filter === "all" || (filter === "low" ? p.low_stock : p.slow_moving));

  return (
    <div className="space-y-6">
      <PageHeader title="Inventory & demand" urdu="اسٹاک اور طلب" description="Stock value, margins and simple, explainable demand estimates. Stock movements never change your ledger unless you ask them to."
        actions={<Button onClick={() => setAdding(true)}><PackagePlus className="h-4 w-4" /> Add product</Button>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Inventory value", formatPKR(data.total_value_paisa), Boxes, "estimated"], ["Products", String(data.product_count), Boxes, "actual"],
          ["Low stock", String(data.low_stock_count), AlertTriangle, "actual"], ["Slow-moving", String(data.slow_moving_count), Snail, "estimated"]].map(([l, v, I, t]) => {
          const Icon = I as React.ElementType;
          return (
            <div key={l as string} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between"><Icon className="h-4 w-4 text-slate-400" /><ValueTag type={t as "actual" | "estimated"} /></div>
              <p className="mt-2 text-xs text-slate-500">{l as string}</p><p className="tabular text-xl font-semibold text-slate-900 dark:text-white">{v as string}</p>
            </div>
          );
        })}
      </div>

      <Card title="Products" subtitle="Sorted by stock value"
        action={<Select aria-label="Filter products" className="w-36 py-1.5 text-xs" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}><option value="all">All</option><option value="low">Low stock</option><option value="slow">Slow-moving</option></Select>}>
        {products.length === 0 ? <EmptyState title="No products here" description="Add products to track stock value, margins and reorder points." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left uppercase tracking-wide text-slate-400"><tr>
                <th className="py-2 pr-3">Product</th><th className="py-2 pr-3 text-right">On hand</th><th className="py-2 pr-3 text-right">Value</th><th className="py-2 pr-3 text-right">Margin</th>
                <th className="py-2 pr-3 text-right">Sells / day</th><th className="py-2 pr-3 text-right">Days of cover</th><th className="py-2 pr-3">Reorder suggestion</th><th className="py-2" />
              </tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {products.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2 pr-3">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{p.name}</p>
                      <p className="text-[10px] text-slate-400">{p.sku} · {formatPKR(p.unit_cost_paisa)} → {formatPKR(p.sale_price_paisa)}</p>
                      <div className="mt-0.5 flex gap-1">
                        {p.low_stock && <span className="rounded bg-red-100 px-1 text-[9px] font-bold uppercase text-red-700 dark:bg-red-900/40 dark:text-red-300">Low stock</span>}
                        {p.slow_moving && <span className="rounded bg-amber-100 px-1 text-[9px] font-bold uppercase text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">Slow</span>}
                        {p.high_exposure && <span className="rounded bg-violet-100 px-1 text-[9px] font-bold uppercase text-violet-800 dark:bg-violet-900/40 dark:text-violet-300">High exposure</span>}
                      </div>
                    </td>
                    <td className="tabular py-2 pr-3 text-right">{p.quantity} {p.unit}</td>
                    <td className="tabular py-2 pr-3 text-right">{formatPKR(p.stock_value_paisa)}<p className="text-[10px] text-slate-400">{p.value_share_pct}%</p></td>
                    <td className="tabular py-2 pr-3 text-right">{p.gross_margin_pct !== null ? `${p.gross_margin_pct}%` : "—"}</td>
                    <td className="tabular py-2 pr-3 text-right">{p.daily_demand}</td>
                    <td className={cn("tabular py-2 pr-3 text-right", (p.days_of_cover ?? 0) > 60 && "text-amber-600", p.days_of_cover !== null && p.days_of_cover < p.lead_time_days + 3 && "text-red-600")}>{p.days_of_cover ?? "—"}</td>
                    <td className="py-2 pr-3">
                      {p.reorder_suggestion !== null ? <span className="font-semibold">{p.reorder_suggestion ? `${p.reorder_suggestion} ${p.unit}` : "Enough stock"}</span> : <span className="text-slate-400">—</span>}
                      <p className="max-w-[220px] text-[10px] text-slate-400">{p.reorder_note}</p>
                    </td>
                    <td className="py-2 text-right"><Button size="sm" variant="outline" onClick={() => setMoving(p)}><ArrowDownUp className="h-3.5 w-3.5" /> Stock</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="How these estimates work"><ul className="list-disc space-y-1 pl-4 text-xs text-slate-600 dark:text-slate-300">{data.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></Card>
        <Card title="Recent stock movements">
          <ul className="divide-y divide-slate-100 text-xs dark:divide-slate-800">{data.recent_movements.map((m) => (
            <li key={m.id} className="flex justify-between py-1.5"><span>{formatDate(m.date)} · {m.product} · <span className="capitalize">{m.type}</span></span><span className={cn("tabular font-medium", m.quantity > 0 ? "text-emerald-700" : "")}>{m.quantity > 0 ? "+" : ""}{m.quantity}</span></li>
          ))}</ul>
        </Card>
      </div>

      <AddProductModal open={adding} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />
      {moving && <MovementModal product={moving} onClose={() => setMoving(null)} onSaved={() => { setMoving(null); reload(); }} />}
    </div>
  );
}

function AddProductModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ sku: "", name: "", unit: "pcs", cost: "", price: "", reorder: "0", lead: "3", qty: "0" });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cost = rupeesToPaisa(f.cost);
    const price = rupeesToPaisa(f.price);
    if (cost === null || price === null || cost < 0 || price < 0) return setErr("Enter a valid cost and price.");
    setSaving(true);
    setErr(null);
    try {
      await api("/inventory/products", { body: { sku: f.sku.trim(), name: f.name.trim(), unit: f.unit || "pcs", unit_cost_paisa: cost, sale_price_paisa: price,
        reorder_level: Number(f.reorder) || 0, lead_time_days: Number(f.lead) || 0, opening_quantity: Number(f.qty) || 0 } });
      setF({ sku: "", name: "", unit: "pcs", cost: "", price: "", reorder: "0", lead: "3", qty: "0" });
      onSaved();
    } catch (e2) {
      setErr(errorMessage(e2));
    } finally {
      setSaving(false);
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal isOpen={open} onClose={onClose} title="Add product" maxWidth="md">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="SKU" htmlFor="p-sku"><Input id="p-sku" required maxLength={40} value={f.sku} onChange={set("sku")} /></Field>
          <Field label="Name" htmlFor="p-name" className="col-span-2"><Input id="p-name" required maxLength={120} value={f.name} onChange={set("name")} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Unit" htmlFor="p-unit"><Input id="p-unit" maxLength={16} value={f.unit} onChange={set("unit")} /></Field>
          <Field label="Cost (Rs.)" htmlFor="p-cost"><Input id="p-cost" required inputMode="decimal" value={f.cost} onChange={set("cost")} /></Field>
          <Field label="Sale price (Rs.)" htmlFor="p-price"><Input id="p-price" required inputMode="decimal" value={f.price} onChange={set("price")} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Opening stock" htmlFor="p-qty"><Input id="p-qty" inputMode="numeric" value={f.qty} onChange={set("qty")} /></Field>
          <Field label="Reorder level" htmlFor="p-re"><Input id="p-re" inputMode="numeric" value={f.reorder} onChange={set("reorder")} /></Field>
          <Field label="Lead time (days)" htmlFor="p-lead"><Input id="p-lead" inputMode="numeric" value={f.lead} onChange={set("lead")} /></Field>
        </div>
        {err && <Notice tone="danger">{err}</Notice>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving && <Spinner />}Save product</Button></div>
      </form>
    </Modal>
  );
}

function MovementModal({ product, onClose, onSaved }: { product: Product; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState<"sale" | "purchase" | "adjustment">("sale");
  const [qty, setQty] = useState("1");
  const [date, setDate] = useState(todayISO());
  const [ledger, setLedger] = useState(false);
  const [account, setAccount] = useState("cash");
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(qty);
    if (!n || !Number.isInteger(n)) return setErr("Enter a whole, non-zero quantity.");
    try {
      await api("/inventory/movements", { body: { product_id: product.id, movement_type: type, quantity: n, occurred_on: date, record_in_ledger: ledger && type !== "adjustment", account } });
      onSaved();
    } catch (e2) {
      setErr(errorMessage(e2));
    }
  };
  const unit = type === "sale" ? product.sale_price_paisa : product.unit_cost_paisa;
  return (
    <Modal isOpen onClose={onClose} title={`Stock movement · ${product.name}`} description={`${product.quantity} ${product.unit} on hand`} maxWidth="md">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Type" htmlFor="m-type"><Select id="m-type" value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="sale">Sale</option><option value="purchase">Purchase</option><option value="adjustment">Adjustment (+/−)</option></Select></Field>
          <Field label="Quantity" htmlFor="m-qty"><Input id="m-qty" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          <Field label="Date" htmlFor="m-date"><Input id="m-date" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        {type !== "adjustment" && (
          <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-700">
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={ledger} onChange={(e) => setLedger(e.target.checked)} />
              Also record {formatPKR(unit * Math.abs(Number(qty) || 0))} as {type === "sale" ? "income" : "an expense"} in my khata</label>
            {ledger && <Select aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)}><option value="cash">Cash</option><option value="bank">Bank</option><option value="wallet">Wallet</option></Select>}
          </div>
        )}
        {err && <Notice tone="danger">{err}</Notice>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit">Save movement</Button></div>
      </form>
    </Modal>
  );
}
