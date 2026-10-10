"use client";

import { useState } from "react";
import { PlugZap } from "lucide-react";
import { Button } from "@/components/shared/button";
import { Notice, Spinner } from "@/components/shared/feedback";
import { api, errorMessage } from "@/lib/api";
import { useApi } from "@/lib/hooks";

export interface AiStatus {
  providers: Record<"groq" | "gemini", { configured: boolean; model: string }>;
  tasks: Record<"explain" | "extract_receipt", { route: string[]; available: boolean }>;
  daily_limit: number;
  consent: boolean;
}

const PROVIDER_LABEL = { groq: "Groq", gemini: "Google Gemini" } as const;
const PROVIDER_USE = { groq: "explanations in English, Urdu and Roman Urdu", gemini: "receipt reading, and backup for explanations" } as const;

/** Server-side AI configuration (booleans + model names only) and a live connection test. */
export function AiStatusPanel() {
  const { data } = useApi<AiStatus>("/ai/status");
  const [test, setTest] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return null;

  const run = async () => {
    setBusy(true);
    setTest(null);
    try {
      const r = await api<{ ok: boolean; provider?: string; model?: string; latency_ms?: number; grounded?: boolean; code?: string; message?: string }>("/ai/test", { method: "POST" });
      setTest(r.ok
        ? { tone: r.grounded ? "success" : "warning", text: `${r.provider} (${r.model}) answered in ${r.latency_ms} ms${r.grounded ? "" : " but added numbers that were not in the evidence; such answers are discarded in Copilot"}.` }
        : { tone: "danger", text: `${r.message ?? r.code}` });
    } catch (e) {
      setTest({ tone: "danger", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
      {(["groq", "gemini"] as const).map((p) => (
        <p key={p} className="flex items-start justify-between gap-2">
          <span><strong>{PROVIDER_LABEL[p]}</strong> · <span className="text-slate-500">{PROVIDER_USE[p]}</span></span>
          <span className={data.providers[p].configured ? "shrink-0 text-emerald-700" : "shrink-0 text-slate-400"}>{data.providers[p].configured ? "configured" : "not set up"}</span>
        </p>
      ))}
      <p className="text-slate-500">Up to {data.daily_limit} AI requests per day per workspace. Free provider tiers have their own limits; when they run out, FinDost shows its own calculated answers.</p>
      <Button type="button" size="sm" variant="outline" onClick={run} disabled={busy || !data.tasks.explain.available}>
        {busy ? <Spinner /> : <PlugZap className="h-4 w-4" />} Test AI connection
      </Button>
      <p className="text-[11px] text-slate-400">The test sends one fixed, fictional sentence — none of your records.</p>
      {test && <Notice tone={test.tone}>{test.text}</Notice>}
    </div>
  );
}
