"use client";

import { getSupabase, supabaseConfigured } from "./supabase/client";

/** "dev" lets local development run without Supabase (tokens are minted by /api/dev-token). */
export const authMode: "supabase" | "dev" =
  process.env.NEXT_PUBLIC_AUTH_MODE === "dev" ? "dev" : "supabase";

const DEV_KEY = "findost_dev_token";

export async function getAccessToken(): Promise<string | null> {
  if (authMode === "dev") {
    try {
      return window.localStorage.getItem(DEV_KEY);
    } catch {
      return null;
    }
  }
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function setDevToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(DEV_KEY, token);
    else window.localStorage.removeItem(DEV_KEY);
  } catch {
    /* storage unavailable */
  }
}

export async function signOut() {
  if (authMode === "dev") {
    setDevToken(null);
    return;
  }
  await getSupabase()?.auth.signOut();
}

export function authReady(): boolean {
  return authMode === "dev" || supabaseConfigured;
}
