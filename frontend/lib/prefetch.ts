/**
 * Which GET requests a page will make first, so they can start while the app is still checking the account
 * (/me) instead of after it. Paths must match the pages' own requests exactly; a request that is not used is
 * simply discarded (lib/hooks.ts).
 */
import type { Feature } from "./types";

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The dashboard's data request for a period of `range` days ending today (same as the page builds it). */
export function dashboardPath(range = "30") {
  const to = new Date();
  const local = new Date(to.getTime() - to.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return `/dashboard?from=${shiftDate(local, -(Number(range) - 1))}&to=${local}`;
}

/** The workflow tiles on the dashboard, by module. */
export const WORKFLOW_PANEL_PATHS: Partial<Record<Feature, string>> = {
  actions: "/actions", controls: "/controls", budget: "/budgets", goals: "/goals",
};

/** First requests of the main pages (before the account is known). */
export function initialRequests(pathname: string): string[] {
  switch (pathname) {
    case "/dashboard": return [dashboardPath()];
    case "/forecast": return ["/forecast?horizon=30"];
    case "/alerts": return ["/alerts"];
    case "/reports": return ["/reports/financial"];
    case "/actions": return ["/actions"];
    default: return [];
  }
}

/** Requests that depend on the workspace's modules, started as soon as /me has answered. */
export function requestsAfterAccount(pathname: string, features: Feature[]): string[] {
  if (pathname !== "/dashboard") return [];
  return features.map((f) => WORKFLOW_PANEL_PATHS[f]).filter((p): p is string => Boolean(p));
}
