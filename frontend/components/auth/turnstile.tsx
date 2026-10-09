"use client";

import { useEffect, useRef } from "react";

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

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!window.__turnstileLoading) {
    window.__turnstileLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Could not load the captcha"));
      document.head.appendChild(s);
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
