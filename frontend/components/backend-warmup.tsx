"use client";

import { useEffect } from "react";

const KEY = "findost_warmup_at";

/** Wakes the API (and its database connection) while the visitor reads the page or solves the captcha, so the
 * first dashboard request does not pay the serverless cold start. At most once every two minutes per tab. */
export function BackendWarmup() {
  useEffect(() => {
    try {
      if (Date.now() - Number(sessionStorage.getItem(KEY) || 0) < 120_000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* storage unavailable: warm anyway */
    }
    fetch("/api/v1/warmup", { keepalive: true }).catch(() => undefined);
  }, []);
  return null;
}
