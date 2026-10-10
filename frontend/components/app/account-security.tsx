"use client";

import { useState } from "react";
import { Button } from "@/components/shared/button";
import { Field, Input } from "@/components/shared/form";
import { Notice, Spinner } from "@/components/shared/feedback";
import { authMode } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { getSupabase } from "@/lib/supabase/client";

/** Private demo -> real account (link an email), or change password for signed-up users. */
export function AccountSecurity({ isAnonymous, expiresOn }: { isAnonymous: boolean; expiresOn: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (authMode !== "supabase") return null;

  const keep = async () => {
    setMsg(null);
    if (!email.includes("@")) return setMsg({ tone: "danger", text: "Enter a valid email." });
    setBusy(true);
    const { error } = (await getSupabase()?.auth.updateUser({ email: email.trim() },
      { emailRedirectTo: `${window.location.origin}/auth/callback?next=/settings` })) ?? { error: new Error("Not configured") };
    setBusy(false);
    setMsg(error ? { tone: "danger", text: error.message }
      : { tone: "success", text: `Confirmation link sent to ${email}. Open it, then set a password here so you can sign in from any device.` });
  };

  const changePassword = async () => {
    setMsg(null);
    if (password.length < 8) return setMsg({ tone: "danger", text: "Use at least 8 characters." });
    setBusy(true);
    const { error } = (await getSupabase()?.auth.updateUser({ password })) ?? { error: new Error("Not configured") };
    setBusy(false);
    setPassword("");
    setMsg(error ? { tone: "danger", text: error.message } : { tone: "success", text: "Password updated." });
  };

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-3 dark:border-slate-800">
      {isAnonymous ? (
        <>
          <p className="text-xs text-slate-600 dark:text-slate-300">This is a <strong>private demo</strong>{expiresOn ? `, deleted on ${formatDate(expiresOn, "long")}` : ""}. Add your email to keep it as a free account.</p>
          <Field label="Email" htmlFor="keep-email"><Input id="keep-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Button type="button" size="sm" onClick={keep} disabled={busy}>{busy && <Spinner />}Keep this workspace</Button>
        </>
      ) : (
        <>
          <Field label="New password" hint="At least 8 characters" htmlFor="new-pass"><Input id="new-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Button type="button" size="sm" variant="outline" onClick={changePassword} disabled={busy}>{busy && <Spinner />}Change password</Button>
        </>
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
