"use client";

import { getAccessToken } from "./auth";
import { browserStorage, clearSelection, readSelection, safeAppPath, sessionKeyFromToken, writeSelection } from "./workspace";

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

/** The workspace chosen in this sign-in session (see lib/workspace.ts). The server only honours it for members. */
export async function getSelectedWorkspace(): Promise<string | null> {
  return readSelection(browserStorage(), sessionKeyFromToken(await getAccessToken()));
}

/**
 * Open a workspace. Records the choice for this session, then reloads the app at `next`: the reload drops every
 * in-memory record, chart, Copilot conversation and in-flight request of the previous workspace, so nothing from it
 * can appear while the new one loads. The sign-in session itself is kept (no logout).
 */
export async function enterWorkspace(id: string, next = "/dashboard") {
  const ok = writeSelection(browserStorage(), sessionKeyFromToken(await getAccessToken()), id);
  window.location.assign(ok ? safeAppPath(next) : "/login");
}

/** Forget the choice (e.g. access was revoked) so the selection screen is shown again. */
export function forgetSelectedWorkspace() {
  clearSelection(browserStorage());
}

/** Auth + workspace headers for every API call (also used by downloads and the Copilot stream). */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const ws = readSelection(browserStorage(), sessionKeyFromToken(token));
  if (ws) headers["X-Workspace-Id"] = ws;
  return headers;
}

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", ...(await authHeaders()) };
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
      // access to the open workspace was removed while it was in use: go back to the selection screen
      if (apiErr.code === "workspace_not_found") window.dispatchEvent(new CustomEvent("findost:workspace_lost"));
    }
    throw apiErr;
  }
  return payload as T;
}

/** Download an authenticated file (CSV exports) through the browser. */
export async function downloadFile(path: string, filename: string) {
  const res = await fetch(`/api/v1${path}`, { headers: await authHeaders() });
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
