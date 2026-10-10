"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthLayout } from "@/components/auth/auth-layout";
import { Button } from "@/components/shared/button";
import { Notice, Spinner } from "@/components/shared/feedback";
import { api, enterWorkspace, errorMessage } from "@/lib/api";

interface Preview { workspace: string | null; role: string; expires_at: string; email_matches: boolean }

function InviteInner() {
  const token = useSearchParams().get("token") ?? "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return setError("This link has no invitation token.");
    api<Preview>(`/invitations/${encodeURIComponent(token)}`).then(setPreview).catch((e) => setError(errorMessage(e)));
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ workspace_id: string }>("/invitations/accept", { body: { token } });
      // Joining adds this workspace next to the user's own account; nothing in their own account changes.
      await enterWorkspace(r.workspace_id, "/dashboard");
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Workspace invitation" subtitle="Join a company's FinDost workspace">
      {error && <Notice tone="danger">{error}</Notice>}
      {!preview && !error && <p className="flex items-center gap-2 text-sm text-slate-500"><Spinner /> Checking the invitation…</p>}
      {preview && (
        <div className="space-y-4">
          <p className="text-sm text-slate-700 dark:text-slate-300">You are invited to <strong>{preview.workspace}</strong> as <strong>{preview.role}</strong>. The invitation expires on {new Date(preview.expires_at).toLocaleDateString("en-GB")}.</p>
          {preview.email_matches ? (
            <Button className="w-full" onClick={accept} disabled={busy}>{busy && <Spinner />}Accept and open the workspace</Button>
          ) : (
            <Notice tone="warning">This invitation was sent to a different email address. Sign out and sign in (or sign up) with the invited email, then open the link again.</Notice>
          )}
        </div>
      )}
      <p className="mt-4 text-center text-sm"><Link href="/workspaces" className="text-brand-700 hover:underline">Go to my workspaces</Link></p>
    </AuthLayout>
  );
}

export default function InvitePage() {
  return <Suspense><InviteInner /></Suspense>;
}
