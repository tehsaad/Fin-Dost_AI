"use client";

import { useState } from "react";
import { Button } from "@/components/shared/button";
import { Field, Input, Select } from "@/components/shared/form";
import { Notice, Spinner } from "@/components/shared/feedback";
import { Modal } from "@/components/shared/modal";
import { api, errorMessage } from "@/lib/api";
import { formatPKR, rupeesToPaisa, todayISO } from "@/lib/format";

export function PaymentModal({ open, onClose, title, outstanding, endpoint, onSaved }: {
  open: boolean; onClose: () => void; title: string; outstanding: number; endpoint: string; onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [account, setAccount] = useState("cash");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const paisa = rupeesToPaisa(amount);
    if (!paisa || paisa <= 0) return setError("Enter an amount greater than zero.");
    if (paisa > outstanding) return setError(`That is more than the outstanding ${formatPKR(outstanding)}.`);
    setSaving(true);
    setError(null);
    try {
      await api(endpoint, { body: { amount_paisa: paisa, occurred_on: date, account, note: note || undefined } });
      setAmount("");
      setNote("");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={title} description={`Outstanding ${formatPKR(outstanding, { decimals: outstanding % 100 !== 0 })} · partial payments allowed`} maxWidth="md">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (Rs.)" htmlFor="pay-amount">
            <Input id="pay-amount" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(outstanding / 100)} />
          </Field>
          <Field label="Date" htmlFor="pay-date"><Input id="pay-date" type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap gap-2">
          {[0.25, 0.5, 1].map((f) => (
            <button type="button" key={f} onClick={() => setAmount(String(Math.round(outstanding * f) / 100))}
              className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
              {f === 1 ? "Full" : `${f * 100}%`} ({formatPKR(Math.round(outstanding * f))})
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account" htmlFor="pay-acct">
            <Select id="pay-acct" value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="cash">Cash</option><option value="bank">Bank</option><option value="wallet">Wallet</option>
            </Select>
          </Field>
          <Field label="Note (optional)" htmlFor="pay-note"><Input id="pay-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving && <Spinner />}Record payment</Button></div>
      </form>
    </Modal>
  );
}
