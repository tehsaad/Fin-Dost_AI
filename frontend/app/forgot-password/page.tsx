"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthLayout } from "@/components/auth/auth-layout";
import { captchaEnabled, Turnstile } from "@/components/auth/turnstile";
import { Button } from "@/components/shared/button";
import { Field, Input } from "@/components/shared/form";
import { Notice, Spinner } from "@/components/shared/feedback";
import { getSupabase } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [reset, setReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.includes("@")) return setError("Enter the email you signed up with.");
    if (captchaEnabled && !captcha) return setError("Please complete the security check.");
    const supabase = getSupabase();
    if (!supabase) return setError("Sign-in is not configured.");
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      captchaToken: captcha ?? undefined, redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    setReset((r) => r + 1);
    if (err) return setError(err.message);
    setSent(true); // shown even if the email is unknown, so accounts cannot be discovered this way
  };

  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new one.">
      {sent ? (
        <Notice tone="success">If an account exists for {email}, a reset link is on its way. It expires after 1 hour.</Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="fp-email"><Input id="fp-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Turnstile onToken={setCaptcha} resetSignal={reset} action="recover" />
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" className="w-full" disabled={busy}>{busy && <Spinner />}Send reset link</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link href="/login" className="font-medium text-brand-700 hover:underline">Back to sign in</Link></p>
    </AuthLayout>
  );
}
