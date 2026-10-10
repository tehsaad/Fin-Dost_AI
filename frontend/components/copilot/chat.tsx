"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bot, Brain, Calculator, PenLine, Send, ShieldCheck, Sparkles, User } from "lucide-react";
import { useApp } from "@/components/app/app-provider";
import { Button } from "@/components/shared/button";
import { Notice, Spinner } from "@/components/shared/feedback";
import { useAiAssistance } from "@/components/app/ai-assistance";
import { errorMessage } from "@/lib/api";
import { askCopilot, buildHistory } from "@/lib/copilot-stream";
import { cn } from "@/lib/format";
import type { CopilotAnswer, CopilotContext, CopilotStage } from "@/lib/types";

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
  "/recovery": "Recovery", "/reports": "Reports", "/transactions?tab=receivables": "Receivables",
  "/transactions?tab=payables": "Payables", "/transactions": "Transactions", "/import": "Import", "/budget": "Budget",
  "/goals": "Goals", "/actions": "Tasks & approvals", "/controls": "Data checks", "/inventory": "Inventory" };
const NOT_CALCULATED = new Set(["clarify", "unknown", "out_of_scope", "error"]);
const STAGES: { id: CopilotStage; label: string; icon: typeof Brain }[] = [
  { id: "understanding", label: "Understanding…", icon: Brain },
  { id: "calculating", label: "Calculating…", icon: Calculator },
  { id: "writing", label: "Writing…", icon: PenLine },
];
const FALLBACK_NOTE: Record<string, string> = {
  quota: "Today's AI limit is used up, so this answer uses FinDost's own wording. The figures are the same.",
  ai_error: "The AI service didn't respond cleanly, so this answer uses FinDost's own wording. The figures are the same.",
  unavailable: "AI isn't set up on the server right now, so this answer uses FinDost's own wording.",
};

/**
 * The Copilot conversation: one implementation used by the /copilot page and the floating launcher.
 * It calls the existing /copilot/stream API (JSON fallback) with the workspace, history and context.
 */
export function CopilotChat({ compact = false }: { compact?: boolean }) {
  const { business, has, can } = useApp();
  const ai = useAiAssistance();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [stage, setStage] = useState<CopilotStage | null>(null);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<"en" | "ur">(business.language);
  const [busy, setBusy] = useState(false);
  // The previous turn's interpretation, sent back so follow-ups keep context. It holds no financial data.
  const [context, setContext] = useState<CopilotContext | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);
  const suggestions = (has("receivables") ? SUGGESTIONS_BIZ : SUGGESTIONS_PERSONAL).slice(0, compact ? 4 : undefined);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    // The last 8 messages go along so follow-ups ("another 10%?") are read in context. Figures are always
    // recomputed from your records on the server; earlier answers are never used as numbers.
    const history = buildHistory(messages);
    setLastQuestion(q);
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    setStage("understanding");
    try {
      const answer = await askCopilot({ question: q, language: lang, context, history }, setStage);
      setMessages((m) => [...m, { role: "bot", answer }]);
      if (answer.context) setContext(answer.context);
    } catch (e) {
      setMessages((m) => [...m, { role: "error", text: errorMessage(e) }]);
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  const langToggle = (
    <div className="flex rounded-md border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900" role="group" aria-label="Answer language">
      {(["en", "ur"] as const).map((l) => (
        <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={cn("rounded px-2.5 py-1 text-xs font-medium", lang === l ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "text-slate-600 dark:text-slate-300")}>{l === "en" ? "English" : "اردو"}</button>
      ))}
    </div>
  );

  return (
    <div className={cn("flex min-h-0 flex-col", compact ? "h-full" : "h-[calc(100vh-8rem)]")}>
      {compact ? <div className="mb-2 flex justify-end">{langToggle}</div> : (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-baseline gap-3 text-xl font-semibold tracking-tight text-slate-900 dark:text-white md:text-2xl">Financial Copilot <span className="urdu text-base font-normal text-slate-400">مالی مددگار</span></h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">Ask in English, Roman Urdu or Urdu. Every answer is calculated from your records by the same engine as the dashboard — it never invents numbers.</p>
          </div>
          {langToggle}
        </div>
      )}
      {!ai.enabled && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200" role="status">
          <p>AI answers are off. You still get exact answers from FinDost&apos;s own rules; turning AI on lets it understand free-form questions and word answers naturally.</p>
          {can("admin")
            ? <Button size="sm" onClick={() => { void ai.setAi(true); }} disabled={ai.saving}>{ai.saving ? <Spinner /> : <Sparkles className="h-4 w-4" />} Turn ON AI Answers</Button>
            : <p className="font-medium">Only a workspace owner can turn AI answers on.</p>}
          {ai.error && <p className="w-full text-red-700 dark:text-red-300">{ai.error}</p>}
        </div>
      )}
      <div className={cn("min-h-0 flex-1 space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900", compact ? "p-3" : "p-4")} aria-live="polite">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-3 rounded-full bg-brand-50 p-3 dark:bg-brand-950/40"><Sparkles className="h-6 w-6 text-brand-600" /></div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">What would you like to know?</p>
            <p className="mb-4 mt-1 max-w-md text-xs text-slate-500">Ask in your own words, or try one of these. Answers include the evidence they were built from, and you can ask follow-ups like “what if it drops another 10%?”.</p>
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
          <div key={i} className="space-y-1">
            <Notice tone="danger">{m.text}</Notice>
            {i === messages.length - 1 && lastQuestion && !busy && (
              <button type="button" onClick={() => { setMessages((ms) => ms.slice(0, -2)); void ask(lastQuestion); }}
                className="text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-400">Retry</button>
            )}
          </div>
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
                {!NOT_CALCULATED.has(m.answer.intent) && <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <ShieldCheck className="h-3 w-3" />{m.answer.used_llm ? `Worded by AI (${m.answer.ai_provider === "groq" ? "Groq" : "Gemini"}) · numbers verified against your data` : "Calculated from your data"}
                </span>}
                {m.answer.interpreted_by === "groq" || m.answer.interpreted_by === "gemini" ? (
                  <span className="text-[10px] text-slate-500">Question understood by AI</span>
                ) : null}
                {m.answer.links.map((l) => <Link key={l} href={l} className="text-[11px] font-medium text-brand-700 hover:underline dark:text-brand-400">Open {LINK_LABEL[l] ?? l} →</Link>)}
              </div>
              {m.answer.ai_fallback && FALLBACK_NOTE[m.answer.ai_fallback] && <p className="text-[11px] text-amber-700 dark:text-amber-300">{FALLBACK_NOTE[m.answer.ai_fallback]}</p>}
              {m.answer.suggestions && m.answer.suggestions.length > 0 && i === messages.length - 1 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {m.answer.suggestions.map((s) => <button key={s} onClick={() => ask(s)} disabled={busy} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700 transition hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-brand-950/30">{s}</button>)}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex flex-wrap items-center gap-1.5" role="status" aria-live="polite">
            {STAGES.filter((st) => st.id !== "writing" || stage === "writing").map((st) => {
              const order = STAGES.findIndex((x) => x.id === stage);
              const idx = STAGES.findIndex((x) => x.id === st.id);
              const state = idx < order ? "done" : idx === order ? "active" : "todo";
              const Icon = st.icon;
              return (
                <span key={st.id} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
                  state === "active" && "border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-700 dark:bg-brand-950/40 dark:text-brand-300",
                  state === "done" && "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
                  state === "todo" && "border-slate-200 text-slate-400 dark:border-slate-700")}>
                  {state === "active" ? <Spinner /> : <Icon className="h-3 w-3" />}{st.label}
                </span>
              );
            })}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="mt-3 flex gap-2">
        <input aria-label="Ask the copilot" value={input} onChange={(e) => setInput(e.target.value)} maxLength={500} dir="auto"
          placeholder={lang === "ur" ? "اپنا سوال لکھیں…" : "Ask about your cash, customers, bills or scenarios…"}
          className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 dark:border-slate-700 dark:bg-slate-950" />
        <Button type="submit" disabled={busy || !input.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
      </form>
      <p className={cn("mt-2 text-[11px] text-slate-500", compact && "hidden")}>
        {ai.enabled ? "AI is on: your question and computed figures (with customer and supplier names masked) may be sent to the language model to understand the question and word the answer. Numbers always come from FinDost's engine, and any answer with an unverified number is discarded." : "AI is off: answers come from FinDost's own rules and wording. You can turn it on above or in Settings."}
      </p>
    </div>
  );
}
