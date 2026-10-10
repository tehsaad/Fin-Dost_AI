"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DatabaseZap, LogOut, RotateCcw, Save, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/app/shell";
import { useApp } from "@/components/app/app-provider";
import { Card } from "@/components/shared/card";
import { Button } from "@/components/shared/button";
import { Field, Input, Select, Toggle } from "@/components/shared/form";
import { Notice, Spinner } from "@/components/shared/feedback";
import { Modal } from "@/components/shared/modal";
import { AiStatusPanel } from "@/components/app/ai-status";
import { AccountSecurity } from "@/components/app/account-security";
import { useAiAssistance } from "@/components/app/ai-assistance";
import { api, errorMessage } from "@/lib/api";
import { signOut } from "@/lib/auth";
import { rupeesToPaisa } from "@/lib/format";

export default function SettingsPage() {
  const { business, me, refresh } = useApp();
  const router = useRouter();
  const [f, setF] = useState({
    name: business.name, city: business.city ?? "", reserve: String(business.cash_reserve_paisa / 100),
    cash: String(business.opening_cash_paisa / 100), bank: String(business.opening_bank_paisa / 100), wallet: String(business.opening_wallet_paisa / 100),
    opening_date: business.opening_date, language: business.language,
  });
  // Saved on its own, the moment it is switched, so it never waits on (or gets overwritten by) the form below.
  const ai = useAiAssistance();
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState<"reset" | "clear" | null>(null);
  const [working, setWorking] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      await api("/business", { method: "PUT", body: {
        name: f.name, city: f.city || null, cash_reserve_paisa: rupeesToPaisa(f.reserve) ?? 0,
        opening_cash_paisa: rupeesToPaisa(f.cash) ?? 0, opening_bank_paisa: rupeesToPaisa(f.bank) ?? 0, opening_wallet_paisa: rupeesToPaisa(f.wallet) ?? 0,
        opening_date: f.opening_date, language: f.language,
      } });
      await refresh();
      setMsg({ tone: "success", text: "Settings saved." });
    } catch (err) {
      setMsg({ tone: "danger", text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  };

  const runConfirm = async () => {
    setWorking(true);
    try {
      await api(confirm === "reset" ? "/business/reset-demo" : "/business/clear", { method: "POST" });
      await refresh();
      setConfirm(null);
      router.push("/dashboard");
    } catch (err) {
      setMsg({ tone: "danger", text: errorMessage(err) });
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings & profile" urdu="ترتیبات" description="Your workspace, opening balances, safety reserve and privacy choices." />
      <form onSubmit={save} className="grid gap-6 lg:grid-cols-3">
        <Card title="Business profile" className="lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name" htmlFor="s-name"><Input id="s-name" required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="City" htmlFor="s-city"><Input id="s-city" maxLength={80} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
            <Field label="Account type" htmlFor="s-kind" hint="Fixed for this login. Use a different account for another module."><Input id="s-kind" disabled value={business.kind_label} /></Field>
            <Field label="Explanation language" htmlFor="s-lang"><Select id="s-lang" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value as "en" | "ur" })}><option value="en">English</option><option value="ur">اردو (Urdu)</option></Select></Field>
            <Field label="Safety cash reserve (Rs.)" htmlFor="s-res" hint="Alerts fire when cash is projected below this"><Input id="s-res" inputMode="decimal" value={f.reserve} onChange={(e) => setF({ ...f, reserve: e.target.value })} /></Field>
            <Field label="Opening balance date" htmlFor="s-od"><Input id="s-od" type="date" value={f.opening_date} onChange={(e) => setF({ ...f, opening_date: e.target.value })} /></Field>
            <Field label="Opening cash (Rs.)" htmlFor="s-c"><Input id="s-c" inputMode="decimal" value={f.cash} onChange={(e) => setF({ ...f, cash: e.target.value })} /></Field>
            <Field label="Opening bank (Rs.)" htmlFor="s-b"><Input id="s-b" inputMode="decimal" value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} /></Field>
            <Field label="Opening wallet (Rs.)" htmlFor="s-w"><Input id="s-w" inputMode="decimal" value={f.wallet} onChange={(e) => setF({ ...f, wallet: e.target.value })} /></Field>
          </div>
        </Card>
        <div className="space-y-6">
          <Card title="Privacy & AI">
            <Toggle id="s-ai" checked={ai.enabled} onChange={(v) => { void ai.setAi(v); }} label="Allow AI assistance"
              description="Off by default. When on: (1) Copilot sends already-computed figures, with customer and supplier names masked, to Groq (or Gemini as backup) to word the answer — any answer with an unverified number is discarded — and, when its own rules can't place a question, sends the question text (names masked) to pick the right calculation; (2) receipt photos you choose to upload are read by Google Gemini and shown for your review before anything is saved. AI never calculates your balances." />
            <p className="mt-2 text-[11px] text-slate-500" aria-live="polite">{ai.saving ? "Saving…" : ai.enabled ? "AI assistance is on. Saved to your account." : "AI assistance is off. Saved to your account."}</p>
            {ai.error && <Notice tone="danger">{ai.error}</Notice>}
            <AiStatusPanel />
          </Card>
          <Card title="Account">
            <p className="text-xs text-slate-500">Signed in as <strong className="text-slate-700 dark:text-slate-300">{me.user.is_anonymous ? "private demo visitor" : me.user.email ?? me.user.id}</strong></p>
            <AccountSecurity isAnonymous={business.is_anonymous} expiresOn={business.demo_expires_on} />
            <Button type="button" variant="outline" className="mt-3 w-full" onClick={async () => { await signOut(); router.replace("/login"); }}><LogOut className="h-4 w-4" /> Sign out</Button>
          </Card>
        </div>
        <div className="flex items-center justify-end gap-3 lg:col-span-3">
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <Button type="submit" disabled={saving}>{saving ? <Spinner /> : <Save className="h-4 w-4" />} Save settings</Button>
        </div>
      </form>

      <Card title="Data" subtitle="Demo data is fictional and clearly labelled">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border border-slate-200 p-4 dark:border-slate-700">
            <p className="flex items-center gap-2 text-sm font-medium"><RotateCcw className="h-4 w-4 text-blue-600" /> Reset demo data</p>
            <p className="mt-1 text-xs text-slate-500">Replace everything with the fictional {business.kind_label.toLowerCase()} demo dataset.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setConfirm("reset")}>Reset demo</Button>
          </div>
          <div className="rounded-md border border-red-200 p-4 dark:border-red-900">
            <p className="flex items-center gap-2 text-sm font-medium"><DatabaseZap className="h-4 w-4 text-red-600" /> Start with my own data</p>
            <p className="mt-1 text-xs text-slate-500">Delete all records in this workspace (demo and yours) and start empty.</p>
            <Button variant="danger" size="sm" className="mt-3" onClick={() => setConfirm("clear")}><Trash2 className="h-4 w-4" /> Clear all data</Button>
          </div>
        </div>
      </Card>

      <Modal isOpen={confirm !== null} onClose={() => setConfirm(null)} title={confirm === "reset" ? "Reset to demo data?" : "Delete all data?"} maxWidth="md">
        <p className="text-sm text-slate-600 dark:text-slate-300">{confirm === "reset" ? "All current records are replaced by the demo dataset." : "All transactions, customers, bills, products and scenarios in this workspace are permanently deleted."} This cannot be undone.</p>
        <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant={confirm === "clear" ? "danger" : "primary"} onClick={runConfirm} disabled={working}>{working && <Spinner />}Confirm</Button></div>
      </Modal>
    </div>
  );
}
