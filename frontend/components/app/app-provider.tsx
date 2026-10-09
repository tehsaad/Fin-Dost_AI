"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { Business, Feature, Me } from "@/lib/types";
import { Spinner } from "@/components/shared/feedback";

interface AppCtx {
  me: Me;
  business: Business;
  has: (f: Feature) => boolean;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const m = await api<Me>("/me");
      if (m.needs_onboarding || !m.business) {
        router.replace("/onboarding");
        return;
      }
      setMe(m);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      setError((e as Error).message);
    }
  }, [router, pathname]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onUnauthorized = () => router.replace("/login");
    const onOnboarding = () => router.replace("/onboarding");
    window.addEventListener("findost:unauthorized", onUnauthorized);
    window.addEventListener("findost:onboarding", onOnboarding);
    return () => {
      window.removeEventListener("findost:unauthorized", onUnauthorized);
      window.removeEventListener("findost:onboarding", onOnboarding);
    };
  }, [router]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">FinDost could not load your workspace.</p>
        <p className="max-w-md text-xs text-slate-500">{error}</p>
        <button onClick={() => { setError(null); load(); }} className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-slate-900">
          Try again
        </button>
      </div>
    );
  }
  if (!me?.business) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-slate-500">
        <Spinner /> Loading your workspace…
      </div>
    );
  }
  const business = me.business;
  return (
    <Ctx.Provider value={{ me, business, has: (f) => business.features.includes(f), refresh: load }}>
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
