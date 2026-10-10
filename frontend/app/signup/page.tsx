"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, GraduationCap, Home, MailCheck, Store } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { captchaEnabled, Turnstile, useCaptchaToken } from "@/components/auth/turnstile";
import { useQueryParam } from "@/lib/use-query-param";
import { GoogleButton, googleEnabled } from "@/components/auth/google-button";
import { Button } from "@/components/shared/button";
import { Field, Input } from "@/components/shared/form";
import { Notice, Spinner } from "@/components/shared/feedback";
import { authMode } from "@/lib/auth";
import { cn } from "@/lib/format";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { KIND_INFO } from "@/lib/demo-accounts";
import type { Kind } from "@/lib/types";

const ICONS: Record<Kind, React.ElementType> = { sme: Store, enterprise: Building2, household: Home, student: GraduationCap };

function SignupInner() {
  const router = useRouter();
  const typeParam = useQueryParam("type");
  const [kind, setKind] = useState<Kind>("sme");
  useEffect(() => {  // "Start" on a landing-page card preselects that account type
    if (typeParam && ["sme", "enterprise", "household", "student"].includes(typeParam)) setKind(typeParam as Kind);
  }, [typeParam]);
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { token: captcha, onToken: setCaptcha, ready: captchaReady } = useCaptchaToken();
  const [reset, setReset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);

  const resend = async () => {
    setError(null);
    if (captchaEnabled && !captcha) return setError("Complete the security check first.");
    setBusy(true);
    const { error: err } = (await getSupabase()?.auth.resend({ type: "signup", email: email.trim(),
      options: { captchaToken: captcha ?? undefined, emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` } }))
      ?? { error: new Error("Sign-up is not configured.") };
    setBusy(false);
    setReset((r) => r + 1);
    if (err) return setError(err.message);
    setResent(true);
  };

  const rememberChoice = () => {
    try {
      localStorage.setItem("findost_pending_kind", kind);
      if (business.trim()) localStorage.setItem("findost_pending_name", business.trim());
    } catch { /* ignore */ }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters for your password.");
    const supabase = getSupabase();
    if (!supabase) return setError("Sign-up is not configured.");
    setBusy(true);
    const captchaToken = await captchaReady();  // pressed before the security check finished: wait for it
    if (captchaEnabled && !captchaToken) {
      setBusy(false);
      return setError("Please complete the security check.");
    }
    rememberChoice();
    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: {
        captchaToken: captchaToken ?? undefined,
        data: { account_type: kind, business_name: business.trim() || undefined, full_name: name.trim() || undefined },
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
      },
    });
    setBusy(false);
    if (err) {
      setReset((r) => r + 1);
      return setError(err.message);
    }
    if (data.session) router.replace("/onboarding");
    else {
      setReset((r) => r + 1);  // the token was used by sign-up; resend needs a fresh one
      setSent(true);
    }
  };

  if (sent) {
    return (
      <AuthLayout title="Check your email" subtitle="One more step">
        <div className="flex flex-col items-center rounded-lg border border-slate-200 p-8 text-center dark:border-slate-800">
          <MailCheck className="h-10 w-10 text-brand-600" />
          <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">We sent a confirmation link to <strong>{email}</strong> from no-reply@tehsaad.site. Open it to activate your {KIND_INFO[kind].title.toLowerCase()} workspace. Check spam if it is not there in a minute.</p>
          <div className="mt-4 w-full space-y-2 text-left">
            <Turnstile onToken={setCaptcha} resetSignal={reset} action="resend" />
            {error && <Notice tone="danger">{error}</Notice>}
            {resent && <Notice tone="success">Sent again. Links expire after 24 hours.</Notice>}
            <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={resend}>{busy && <Spinner />}Resend the email</Button>
          </div>
          <Link href="/login" className="mt-4 text-sm font-medium text-brand-700 hover:underline">Back to sign in</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Create your account" subtitle="Choose who FinDost is for. Each login has one account type, which decides your modules.">
      {authMode === "dev" || !supabaseConfigured ? (
        <Notice tone="warning">{authMode === "dev" ? "Developer mode: use the sign-in page to create a local user." : "Authentication is not configured yet."}</Notice>
      ) : (
        <div className="space-y-5">
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
                  <p className="urdu text-xs text-slate-500">{KIND_INFO[k].urdu}</p>
                  <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{KIND_INFO[k].blurb}</p>
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500">Modules: {KIND_INFO[kind].modules}</p>
          {googleEnabled && (
            <>
              <div onClickCapture={rememberChoice}><GoogleButton next="/onboarding" label="Sign up with Google" onError={setError} /></div>
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-400"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />or with email<span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /></div>
            </>
          )}
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Your name" htmlFor="name"><Input id="name" autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label={kind === "sme" || kind === "enterprise" ? "Business name" : "Workspace name"} htmlFor="biz"><Input id="biz" maxLength={120} value={business} onChange={(e) => setBusiness(e.target.value)} placeholder={kind === "sme" ? "e.g. Bilal General Store" : ""} /></Field>
            </div>
            <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Password" htmlFor="password" hint="At least 8 characters"><Input id="password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Turnstile onToken={setCaptcha} resetSignal={reset} action="signup" />
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" className="w-full" size="lg" disabled={busy}>{busy && <Spinner />}Create {KIND_INFO[kind].title.toLowerCase()} account</Button>
          </form>
          <p className="text-center text-sm text-slate-500">Already have an account? <Link href="/login" className="font-medium text-brand-700 hover:underline dark:text-brand-400">Sign in</Link></p>
        </div>
      )}
    </AuthLayout>
  );
}

export default function SignupPage() {
  return <SignupInner />;
}
