"use client";

import { getAccessToken } from "./auth";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Options = { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal };

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const token = await getAccessToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "network_error", "Cannot reach the FinDost server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  let payload: unknown = null;
  const text = await res.text();
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
    const apiErr = new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? `Request failed (${res.status})`, err?.details);
    if (typeof window !== "undefined") {
      if (res.status === 401) window.dispatchEvent(new CustomEvent("findost:unauthorized"));
      if (apiErr.code === "onboarding_required") window.dispatchEvent(new CustomEvent("findost:onboarding"));
    }
    throw apiErr;
  }
  return payload as T;
}

/** Download an authenticated file (CSV exports) through the browser. */
export async function downloadFile(path: string, filename: string) {
  const token = await getAccessToken();
  const res = await fetch(`/api/v1${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, "download_failed", "Download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "validation_error" && Array.isArray(e.details) && e.details.length) {
      return (e.details as { field: string; message: string }[]).map((d) => `${d.field}: ${d.message}`).join("; ");
    }
    return e.message;
  }
  return (e as Error)?.message ?? "Something went wrong";
}
