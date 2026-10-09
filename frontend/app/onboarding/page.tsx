"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, GraduationCap, Home, Store } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/shared/button";
import { Field, Input, Toggle } from "@/components/shared/form";
import { Notice, Spinner } from "@/components/shared/feedback";
import { api, ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/format";
import { KIND_INFO } from "@/lib/demo-accounts";
import type { Kind, Me } from "@/lib/types";

const ICONS: Record<Kind, React.ElementType> = { sme: Store, enterprise: Building2, household: Home, student: GraduationCap };
const DEFAULT_NAMES: Record<Kind, string> = { sme: "My Shop", enterprise: "My Company", household: "My Household", student: "My Student Budget" };

export default function OnboardingPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [kind, setKind] = useState<Kind>("sme");
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [demo, setDemo] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Me>("/me").then((m) => {
      if (!m.needs_onboarding) return router.replace("/dashboard");
      let pendingKind: string | null = null;
      let pendingName: string | null = null;
      try {
        pendingKind = localStorage.getItem("findost_pending_kind");
        pendingName = localStorage.getItem("findost_pending_name");
      } catch { /* ignore */ }
      const k = (m.suggested_kind ?? pendingKind ?? "sme") as Kind;
      setKind(k);
      setName(m.suggested_business_name ?? pendingName ?? "");
      setMe(m);
    }).catch((e) => {
      if (e instanceof ApiError && e.status === 401) router.replace("/login?next=/onboarding");
      else setError(errorMessage(e));
    });
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/onboarding", { body: { kind, business_name: name.trim() || DEFAULT_NAMES[kind], city: city.trim() || null, load_demo: demo } });
      try { localStorage.removeItem("findost_pending_kind"); localStorage.removeItem("findost_pending_name"); } catch { /* ignore */ }
      router.replace("/dashboard");
    } catch (err) {
      if (err instanceof ApiError && err.code === "already_onboarded") return router.replace("/dashboard");
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (!me) return <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-slate-500">{error ? <Notice tone="danger">{error}</Notice> : <><Spinner /> Preparing your workspace…</>}</div>;

  return (
    <AuthLayout title={`Welcome${me.user.name ? `, ${me.user.name.split(" ")[0]}` : ""}!`} subtitle="Confirm your account type. It is linked to this login and decides which modules you can use.">
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
          {(Object.keys(KIND_INFO) as Kind[]).map((k) => {
            const Icon = ICONS[k];
            const active = kind === k;
            return (
              <button key={k} type="button" role="radio" aria-checked={active} onClick={() => setKind(k)}
                className={cn("relative rounded-lg border p-3 text-left transition", active ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600 dark:bg-brand-950/30" : "border-slate-200 hover:border-slate-300 dark:border-slate-700")}>
                {active && <CheckCircle2 className="absolute right-2 top-2 h-4 w-4 text-brand-600" />}
                <Icon className={cn("h-5 w-5", active ? "text-brand-700" : "text-slate-400")} />
                <p className="mt-1.5 text-sm font-semibold text-slate-900 dark:text-white">{KIND_INFO[k].title}</p>
                <p className="mt-0.5 text-[10px] text-slate-500">{KIND_INFO[k].modules}</p>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" htmlFor="ob-name"><Input id="ob-name" maxLength={120} value={name} placeholder={DEFAULT_NAMES[kind]} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="City (optional)" htmlFor="ob-city"><Input id="ob-city" maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Lahore" /></Field>
        </div>
        <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
          <Toggle id="ob-demo" checked={demo} onChange={setDemo} label="Start with demo data"
            description="Load a fictional, clearly labelled dataset so you can explore every feature now. You can clear it anytime in Settings and enter your own records." />
        </div>
        <Notice>Your account type can&apos;t be switched later. Use a different login for another type.</Notice>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy && <Spinner />}Open my {KIND_INFO[kind].title.toLowerCase()} workspace</Button>
      </form>
    </AuthLayout>
  );
}
