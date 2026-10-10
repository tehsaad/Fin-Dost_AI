"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { captchaEnabled, Turnstile } from "@/components/auth/turnstile";
import { Notice, Spinner } from "@/components/shared/feedback";
import { api, ApiError, enterWorkspace } from "@/lib/api";
import { DEMO_PERSONAS } from "@/lib/demo-accounts";
import { getSupabase } from "@/lib/supabase/client";
import type { Kind } from "@/lib/types";

/** Opens a private demo workspace for this visitor only (Supabase anonymous sign-in + seeded fictional data). */
export function PrivateDemo() {
  const router = useRouter();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [reset, setReset] = useState(0);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = async (kind: Kind, name: string) => {
    setError(null);
    if (captchaEnabled && !captcha) return setError("Complete the security check first.");
    const supabase = getSupabase();
    if (!supabase) return setError("Sign-in is not configured.");
    setBusy(kind);
    const { error: err } = await supabase.auth.signInAnonymously({
      options: { captchaToken: captcha ?? undefined, data: { account_type: kind, private_demo: true } },
    });
    if (err) {
      setBusy(null);
      setReset((r) => r + 1);
      return setError(err.message);
    }
    try {
      // Choosing a demo persona is the explicit workspace choice for this new session.
      const r = await api<{ business: { id: string } }>("/onboarding", { body: { kind, business_name: name, load_demo: true } });
      await enterWorkspace(r.business.id, "/dashboard");
    } catch (e) {
      if (!(e instanceof ApiError && e.code === "already_onboarded")) {
        setBusy(null);
        return setError(e instanceof Error ? e.message : "Could not open the demo.");
      }
      router.replace("/workspaces");
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
      <p className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300"><Sparkles className="h-4 w-4 text-brand-600" /> Try a private demo (no sign-up)</p>
      <p className="mt-1 text-[11px] text-slate-500">You get your own workspace with synthetic, fictional data. Nobody else can see or change it, and it is deleted after 7 days unless you keep it.</p>
      <div className="mt-3"><Turnstile onToken={setCaptcha} resetSignal={reset} action="demo" /></div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {DEMO_PERSONAS.map((d) => (
          <button key={d.kind} type="button" onClick={() => start(d.kind, d.name)} disabled={busy !== null}
            className="rounded-md border border-slate-200 bg-white p-2 text-left transition hover:border-brand-400 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100">{busy === d.kind && <Spinner />}{d.label}</span>
            <span className="block text-[10px] text-slate-500">{d.who}</span>
          </button>
        ))}
      </div>
      {error && <Notice tone="danger" className="mt-3">{error}</Notice>}
    </div>
  );
}
