"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/shared/button";
import { Field, Input } from "@/components/shared/form";
import { Notice, Spinner } from "@/components/shared/feedback";
import { getSupabase } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSupabase()?.auth.getSession().then(({ data }) => setReady(Boolean(data.session)));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The two passwords do not match.");
    setBusy(true);
    const { error: err } = (await getSupabase()?.auth.updateUser({ password })) ?? { error: new Error("Not configured") };
    setBusy(false);
    if (err) return setError(err.message);
    router.replace("/dashboard");
  };

  return (
    <AuthLayout title="Choose a new password" subtitle="You opened a password reset link from FinDost.">
      {ready === false ? (
        <Notice tone="warning">This reset link has expired or was already used. Request a new one from the sign-in page.</Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="New password" hint="At least 8 characters" htmlFor="rp-pass"><Input id="rp-pass" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field label="Repeat new password" htmlFor="rp-confirm"><Input id="rp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" className="w-full" disabled={busy || ready === null}>{busy && <Spinner />}Save new password</Button>
        </form>
      )}
    </AuthLayout>
  );
}
