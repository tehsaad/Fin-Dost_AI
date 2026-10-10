"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TURNSTILE_SRC } from "./turnstile-src";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
    __turnstileLoading?: Promise<void>;
  }
}

const SRC = TURNSTILE_SRC;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!window.__turnstileLoading) {
    window.__turnstileLoading = new Promise((resolve, reject) => {
      // Pages with a captcha start this download in their HTML (CaptchaPreload); reuse that script if present.
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
      const s = existing ?? document.createElement("script");
      const started = Date.now();
      const ready = () => {
        if (window.turnstile) return resolve();
        if (Date.now() - started > 20_000) return reject(new Error("Could not load the captcha"));
        setTimeout(ready, 50);
      };
      s.addEventListener("load", ready);
      s.addEventListener("error", () => reject(new Error("Could not load the captcha")));
      if (!existing) {
        s.src = SRC;
        s.async = true;
        document.head.appendChild(s);
      } else {
        ready(); // it may already have loaded before this listener was attached
      }
    });
  }
  return window.__turnstileLoading;
}

/** Cloudflare Turnstile captcha. Tokens are single-use: bump `resetSignal` after each attempt. */
export function Turnstile({ onToken, resetSignal = 0, action = "auth" }: { onToken: (t: string | null) => void; resetSignal?: number; action?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        widget.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          action,
          theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
          callback: (t: string) => cb.current(t),
          "expired-callback": () => cb.current(null),
          "error-callback": () => cb.current(null),
        });
      })
      .catch(() => cb.current(null));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, action]);

  useEffect(() => {
    if (resetSignal && widget.current && window.turnstile) {
      window.turnstile.reset(widget.current);
      cb.current(null);
    }
  }, [resetSignal]);

  if (!siteKey) return null;
  return <div ref={ref} className="min-h-[65px]" aria-label="Security check" />;
}

export const captchaEnabled = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);

/**
 * The latest captcha token for a form. `ready()` lets a form that is submitted before Cloudflare has finished its
 * check wait a few seconds for the token instead of failing ("complete the security check"). The captcha is still
 * required: without a token the form shows the same error as before.
 */
export function useCaptchaToken() {
  const [token, setToken] = useState<string | null>(null);
  const latest = useRef<string | null>(null);
  const onToken = useCallback((t: string | null) => {
    latest.current = t;
    setToken(t);
  }, []);
  const ready = useCallback(async (timeoutMs = 20_000): Promise<string | null> => {
    const started = Date.now();
    while (captchaEnabled && !latest.current && Date.now() - started < timeoutMs) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return latest.current;
  }, []);
  return { token, onToken, ready };
}
