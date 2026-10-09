"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/shared/button";
import { Field, Input, Select } from "@/components/shared/form";
import { Notice, Spinner } from "@/components/shared/feedback";
import { api, errorMessage } from "@/lib/api";
import { KIND_LABEL, rupeesToPaisa, todayISO } from "@/lib/format";
import type { Tx } from "@/lib/types";
import { useApp } from "@/components/app/app-provider";

const CATEGORIES = {
  in: ["Sales", "Digital Payments", "Salary", "Family Allowance", "Freelance Income", "Export Sales", "Other Income"],
  out: ["Inventory Purchase", "Raw Material", "Rent", "Salaries & Wages", "Utilities", "Transport & Fuel", "Packaging",
    "Repairs & Maintenance", "Mobile & Internet", "Education", "Groceries", "Medical", "Dining & Leisure", "Shopping",
    "Bank & Wallet Fees", "Taxes & Fees", "Committee (ROSCA)", "Miscellaneous"],
};

export function TransactionForm({ existing, onSaved, onCancel }: { existing?: Tx | null; onSaved: () => void; onCancel: () => void }) {
  const { has } = useApp();
  const editing = Boolean(existing);
  const [kind, setKind] = useState(existing?.kind ?? "income");
  const [date, setDate] = useState(existing?.occurred_on ?? todayISO());
  const [amount, setAmount] = useState(existing ? String(existing.amount_paisa / 100) : "");
  const [account, setAccount] = useState(existing?.account ?? "cash");
  const [toAccount, setToAccount] = useState(existing?.to_account ?? "bank");
  const [category, setCategory] = useState(existing?.category ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [party, setParty] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const kinds = ["income", "expense", ...(has("receivables") ? ["credit_sale"] : []), "credit_purchase", "loan_received",
    "loan_repayment", "owner_withdrawal", "transfer"];
  const direction = ["income", "credit_sale", "loan_received"].includes(kind) ? "in" : "out";
  const needsAccount = !["credit_sale", "credit_purchase"].includes(kind);

  useEffect(() => {
    if (!editing && kind === "credit_sale") setCategory("Sales");
  }, [kind, editing]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const paisa = rupeesToPaisa(amount);
    if (!paisa || paisa <= 0) return setError("Enter an amount greater than zero.");
    if (kind === "credit_sale" && !party.trim() && !editing) return setError("Credit sales need a customer name.");
    setSaving(true);
    try {
      if (editing && existing) {
        await api(`/transactions/${existing.id}`, { method: "PUT", body: {
          occurred_on: date, amount_paisa: paisa, category: category || undefined, description,
          ...(needsAccount && existing.kind !== "transfer" ? { account } : {}),
          ...(existing.kind === "transfer" ? { account, to_account: toAccount } : {}),
        } });
      } else {
        await api("/transactions", { body: {
          occurred_on: date, kind, amount_paisa: paisa, category, description,
          ...(needsAccount ? { account } : {}),
          ...(kind === "transfer" ? { to_account: toAccount } : {}),
          ...(kind === "credit_sale" ? { customer_name: party.trim(), due_on: dueOn || undefined } : {}),
          ...(kind === "credit_purchase" ? { supplier_name: party.trim() || undefined, due_on: dueOn || undefined } : {}),
          ...(["income", "expense"].includes(kind) && party.trim() ? (kind === "income" ? { customer_name: party.trim() } : { supplier_name: party.trim() }) : {}),
        } });
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {!editing && (
        <Field label="Type" htmlFor="tx-kind" hint={kind === "credit_sale" ? "Counts as revenue now, but no cash until the customer pays." : kind === "credit_purchase" ? "Counts as an expense now; creates a bill to pay later." : undefined}>
          <Select id="tx-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </Select>
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="tx-date"><Input id="tx-date" type="date" required value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Amount (Rs.)" htmlFor="tx-amount"><Input id="tx-amount" inputMode="decimal" required placeholder="e.g. 12,500" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      </div>
      {needsAccount && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === "transfer" ? "From account" : "Account"} htmlFor="tx-account">
            <Select id="tx-account" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="cash">Cash</option><option value="bank">Bank</option><option value="wallet">Wallet (JazzCash/Easypaisa)</option>
            </Select>
          </Field>
          {kind === "transfer" && (
            <Field label="To account" htmlFor="tx-to">
              <Select id="tx-to" value={toAccount} onChange={(e) => setToAccount(e.target.value)}>
                <option value="cash">Cash</option><option value="bank">Bank</option><option value="wallet">Wallet</option>
              </Select>
            </Field>
          )}
        </div>
      )}
      {!editing && ["credit_sale", "credit_purchase", "income", "expense"].includes(kind) && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === "credit_sale" || kind === "income" ? "Customer (optional for cash)" : "Supplier (optional)"} htmlFor="tx-party">
            <Input id="tx-party" value={party} onChange={(e) => setParty(e.target.value)} placeholder="Name" maxLength={120} required={kind === "credit_sale"} />
          </Field>
          {(kind === "credit_sale" || kind === "credit_purchase") && (
            <Field label="Due date" htmlFor="tx-due" hint={kind === "credit_sale" ? "Default 30 days" : "Default 14 days"}>
              <Input id="tx-due" type="date" value={dueOn} min={date} onChange={(e) => setDueOn(e.target.value)} />
            </Field>
          )}
        </div>
      )}
      {kind !== "transfer" && (
        <Field label="Category" htmlFor="tx-cat" hint="Leave empty to auto-categorise from the description">
          <Input id="tx-cat" list="tx-categories" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} placeholder="Auto" />
          <datalist id="tx-categories">{CATEGORIES[direction].map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
      )}
      <Field label="Description" htmlFor="tx-desc">
        <Input id="tx-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={240} placeholder="e.g. Counter cash sales, LESCO bill" />
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving && <Spinner />}{editing ? "Save changes" : "Add transaction"}</Button>
      </div>
    </form>
  );
}
