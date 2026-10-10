"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app/app-provider";
import { api, errorMessage } from "@/lib/api";
import type { AccountSettings } from "@/lib/types";

/**
 * The "AI assistance" preference, saved to the server the moment it changes.
 * Starts from the workspace already loaded (never a hard-coded `false`), confirms against /account/settings,
 * and ignores that confirmation if the user toggled in the meantime so a slow response can't undo a click.
 */
export function useAiAssistance() {
  const { business, refresh } = useApp();
  const [enabled, setEnabled] = useState<boolean>(business.ai_consent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = useRef(0);

  useEffect(() => {
    setEnabled(business.ai_consent);
  }, [business.ai_consent]);

  useEffect(() => {
    const seen = changed.current;
    const ctrl = new AbortController();
    api<AccountSettings>("/account/settings", { signal: ctrl.signal })
      .then((s) => { if (changed.current === seen) setEnabled(s.ai_assistance_enabled); })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, []);

  const setAi = useCallback(async (value: boolean) => {
    const seq = ++changed.current;
    const before = enabled;
    setEnabled(value);
    setSaving(true);
    setError(null);
    try {
      const s = await api<AccountSettings>("/account/settings", { method: "PUT", body: { ai_assistance_enabled: value } });
      if (seq === changed.current) setEnabled(s.ai_assistance_enabled);
      await refresh();
      return true;
    } catch (e) {
      if (seq === changed.current) setEnabled(before);
      setError(errorMessage(e));
      return false;
    } finally {
      if (seq === changed.current) setSaving(false);
    }
  }, [enabled, refresh]);

  return { enabled, setAi, saving, error };
}
