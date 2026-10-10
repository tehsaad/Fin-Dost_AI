"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Terminal } from "lucide-react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { captchaEnabled, Turnstile, useCaptchaToken } from "@/components/auth/turnstile";
import { GoogleButton, googleEnabled } from "@/components/auth/google-button";
import { Button } from "@/components/shared/button";
import { Field, Input, Select } from "@/components/shared/form";
import { Notice, Spinner } from "@/components/shared/feedback";
import { authMode, setDevToken } from "@/lib/auth";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { PrivateDemo } from "@/components/auth/private-demo";
import { useQueryParam } from "@/lib/use-query-param";

function safeNext(n: string | null) {
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/workspaces";
}

function DevLogin({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("sme@demo.findost.app");
  const [kind, setKind] = useState("sme");
  const [err, setErr] = useState<string | null>(null);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch("/api/dev-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, kind }) });
    if (!res.ok) return setErr("Developer sign-in is disabled.");
    setDevToken((await res.json()).access_token);
    router.replace(next);
  };
  return (
    <form onSubmit={go} className="space-y-4 rounded-lg border border-dashed border-amber-400 p-4">
      <p className="flex items-center gap-2 text-xs font-semibold text-amber-700"><Terminal className="h-4 w-4" /> Local developer sign-in (no Supabase)</p>
      <Field label="Email" htmlFor="dev-email"><Input id="dev-email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Account type for new users" htmlFor="dev-kind">
        <Select id="dev-kind" value={kind} onChange={(e) => setKind(e.target.value)}><option value="sme">SME</option><option value="enterprise">Enterprise</option><option value="household">Household</option><option value="student">Student</option></Select>
      </Field>
      {err && <Notice tone="danger">{err}</Notice>}
      <Button type="submit" className="w-full">Continue</Button>
    </form>
  );
}

function LoginInner() {
  const router = useRouter();
  const next = safeNext(useQueryParam("next"));
  const errorParam = useQueryParam("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { token: captcha, onToken: setCaptcha, ready: captchaReady } = useCaptchaToken();
  const [reset, setReset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (errorParam) setError(errorParam); }, [errorParam]);
  const [busy, setBusy] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resent, setResent] = useState(false);

  const resend = async () => {
    if (captchaEnabled && !captcha) return setError("Complete the security check, then press resend.");
    const { error: err } = (await getSupabase()?.auth.resend({ type: "signup", email: email.trim(),
      options: { captchaToken: captcha ?? undefined, emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` } }))
      ?? { error: new Error("Sign-in is not configured.") };
    setReset((r) => r + 1);
    if (err) return setError(err.message);
    setResent(true);
    setError(null);
  };

  useEffect(() => {
    if (authMode !== "supabase") return;
    getSupabase()?.auth.getSession().then(({ data }) => { if (data.session) router.replace(next); });
  }, [router, next]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const supabase = getSupabase();
    if (!supabase) return setError("Sign-in is not configured.");
    setBusy(true);
    const captchaToken = await captchaReady();  // pressed before the security check finished: wait for it
    if (captchaEnabled && !captchaToken) {
      setBusy(false);
      return setError("Please complete the security check.");
    }
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password, options: { captchaToken: captchaToken ?? undefined } });
    setBusy(false);
    if (err) {
      setReset((r) => r + 1);
      const notConfirmed = /not confirmed/i.test(err.message);
      setUnconfirmed(notConfirmed);
      setError(err.message === "Invalid login credentials" ? "Email or password is incorrect."
        : notConfirmed ? "Please confirm your email first: open the link we sent you." : err.message);
      return;
    }
    router.replace(next);
    router.refresh();
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your FinDost workspace. Your account type decides which modules you see.">
      {authMode === "dev" ? <DevLogin next={next} /> : !supabaseConfigured ? (
        <Notice tone="warning">Authentication is not configured yet (missing Supabase settings).</Notice>
      ) : (
        <div className="space-y-5">
          {googleEnabled && (
            <>
              <GoogleButton next={next} onError={setError} />
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-slate-400"><span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />or with email<span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" /></div>
            </>
          )}
          <form onSubmit={submit} className="space-y-4" noValidate>
            <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Password" htmlFor="password"><Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Turnstile onToken={setCaptcha} resetSignal={reset} action="login" />
            {error && <Notice tone="danger">{error}</Notice>}
            {unconfirmed && !resent && <Button type="button" variant="outline" className="w-full" onClick={resend}>Resend confirmation email</Button>}
            {resent && <Notice tone="success">Confirmation email sent to {email}. Check your inbox and spam folder.</Notice>}
            <Button type="submit" className="w-full" size="lg" disabled={busy}>{busy && <Spinner />}Sign in</Button>
            <p className="text-right text-xs"><Link href="/forgot-password" className="text-slate-500 hover:text-brand-700 hover:underline">Forgot password?</Link></p>
          </form>
          <p className="text-center text-sm text-slate-500">New to FinDost? <Link href="/signup" className="font-medium text-brand-700 hover:underline dark:text-brand-400">Create an account</Link></p>
          <PrivateDemo />
        </div>
      )}
    </AuthLayout>
  );
}

export default function LoginPage() {
  return <LoginInner />;
}
