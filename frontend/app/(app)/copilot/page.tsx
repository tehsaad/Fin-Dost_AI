"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bot, Send, ShieldCheck, Sparkles, User } from "lucide-react";
import { PageHeader } from "@/components/app/shell";
import { useApp } from "@/components/app/app-provider";
import { Button } from "@/components/shared/button";
import { Notice, Spinner } from "@/components/shared/feedback";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import type { CopilotAnswer } from "@/lib/types";

type Msg = { role: "user"; text: string } | { role: "bot"; answer: CopilotAnswer } | { role: "error"; text: string };

const SUGGESTIONS_BIZ = [
  "Can I afford Rs. 50,000 next week?",
  "Why is my cash-flow risk high?",
  "Which invoices should I follow up on first?",
  "What happens if sales decrease by 20%?",
  "How much cash could remain after scheduled supplier payments?",
  "Compare these two recovery strategies",
  "Explain my dashboard in simple Urdu",
];
const SUGGESTIONS_PERSONAL = [
  "Can I afford Rs. 10,000 next week?",
  "Why is my cash-flow risk high?",
  "Where am I spending the most?",
  "How much cash could remain after scheduled bills?",
  "Compare these two recovery strategies",
  "Explain my dashboard in simple Urdu",
];
const LINK_LABEL: Record<string, string> = { "/dashboard": "Dashboard", "/simulator": "Simulator", "/alerts": "Alerts", "/forecast": "Forecast",
  "/recovery": "Recovery", "/reports": "Reports", "/transactions?tab=receivables": "Receivables" };

export default function CopilotPage() {
  const { business, has } = useApp();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<"en" | "ur">(business.language);
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);
  const suggestions = has("receivables") ? SUGGESTIONS_BIZ : SUGGESTIONS_PERSONAL;

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const answer = await api<CopilotAnswer>("/copilot/query", { body: { question: q, language: lang } });
      setMessages((m) => [...m, { role: "bot", answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "error", text: errorMessage(e) }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <PageHeader title="Financial Copilot" urdu="مالی مددگار" description="Ask in English, Roman Urdu or Urdu. Every answer is calculated from your records by the same engine as the dashboard — it never invents numbers."
        actions={
          <div className="flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900" role="group" aria-label="Answer language">
            {(["en", "ur"] as const).map((l) => (
              <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={cn("rounded px-2.5 py-1 text-xs font-medium", lang === l ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300")}>{l === "en" ? "English" : "اردو"}</button>
            ))}
          </div>
        } />
      <div className="flex-1 space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900" aria-live="polite">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 rounded-full bg-brand-50 p-3 dark:bg-brand-950/40"><Sparkles className="h-6 w-6 text-brand-600" /></div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">What would you like to know?</p>
            <p className="mb-4 mt-1 max-w-md text-xs text-slate-500">Try one of these — answers include the evidence they were built from.</p>
            <div className="flex max-w-2xl flex-wrap justify-center gap-2">
              {suggestions.map((s) => <button key={s} onClick={() => ask(s)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-700 transition hover:border-brand-400 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-brand-950/30">{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => m.role === "user" ? (
          <div key={i} className="flex justify-end gap-2">
            <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-slate-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-slate-900">{m.text}</div>
            <User className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
          </div>
        ) : m.role === "error" ? (
          <Notice key={i} tone="danger">{m.text}</Notice>
        ) : (
          <div key={i} className="flex gap-2">
            <Bot className="mt-1 h-5 w-5 shrink-0 text-brand-600" />
            <div className="max-w-[85%] space-y-2 rounded-2xl rounded-tl-sm border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60">
              <p className={cn("text-sm text-slate-800 dark:text-slate-100", m.answer.language === "ur" && "urdu text-base")} lang={m.answer.language}>{m.answer.answer}</p>
              {m.answer.language === "ur" && <details className="text-xs text-slate-500"><summary className="cursor-pointer">English</summary><p className="mt-1">{m.answer.answer_en}</p></details>}
              {m.answer.evidence.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">Evidence ({m.answer.evidence.length})</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-slate-500">{m.answer.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
                </details>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <ShieldCheck className="h-3 w-3" />{m.answer.used_llm ? "AI-rephrased · numbers verified" : "Calculated from your data"}
                </span>
                {m.answer.links.map((l) => <Link key={l} href={l} className="text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-400">Open {LINK_LABEL[l] ?? l} →</Link>)}
              </div>
            </div>
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-xs text-slate-500"><Spinner /> Calculating…</div>}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="mt-3 flex gap-2">
        <input aria-label="Ask the copilot" value={input} onChange={(e) => setInput(e.target.value)} maxLength={500} dir="auto"
          placeholder={lang === "ur" ? "اپنا سوال لکھیں…" : "Ask about your cash, customers, bills or scenarios…"}
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-950" />
        <Button type="submit" disabled={busy || !input.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
      </form>
      <p className="mt-2 text-[11px] text-slate-500">
        {business.ai_consent ? "AI rephrasing is on: only computed figures (with names masked) may be sent to the language model, and any answer with an unverified number is discarded." : "AI rephrasing is off — answers come from FinDost's own templates. You can opt in from Settings."}
      </p>
    </div>
  );
}
