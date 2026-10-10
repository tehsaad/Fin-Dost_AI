import { afterEach, describe, expect, it, vi } from "vitest";
import { dashboardPath, initialRequests, requestsAfterAccount } from "./prefetch";

describe("early requests match what the pages ask for", () => {
  it("dashboard: the same 30-day path the page builds", () => {
    expect(initialRequests("/dashboard")).toEqual([dashboardPath("30")]);
    expect(dashboardPath()).toMatch(/^\/dashboard\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
  });

  it("only pages with a known first request are prefetched", () => {
    expect(initialRequests("/forecast")).toEqual(["/forecast?horizon=30"]);
    expect(initialRequests("/settings")).toEqual([]);
    expect(initialRequests("/team")).toEqual([]);
  });

  it("workflow tiles follow the workspace's modules and only on the dashboard", () => {
    expect(requestsAfterAccount("/dashboard", ["ledger", "actions", "controls", "budget"])).toEqual(["/actions", "/controls", "/budgets"]);
    expect(requestsAfterAccount("/dashboard", ["ledger", "budget", "goals"])).toEqual(["/budgets", "/goals"]);
    expect(requestsAfterAccount("/forecast", ["actions"])).toEqual([]);
  });
});

describe("prefetched responses", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); });

  async function load() {
    const apiMock = vi.fn(async (path: string) => ({ path }));
    vi.doMock("./api", () => ({ api: apiMock }));
    vi.stubGlobal("window", {});
    const hooks = await import("./hooks");
    return { ...hooks, apiMock };
  }

  it("start one request per path and are used at most once", async () => {
    const { prefetchApi, takePrefetched, apiMock } = await load();
    prefetchApi("/dashboard?x");
    prefetchApi("/dashboard?x");
    expect(apiMock).toHaveBeenCalledTimes(1);
    await expect(takePrefetched("/dashboard?x")).resolves.toEqual({ path: "/dashboard?x" });
    expect(takePrefetched("/dashboard?x")).toBeNull();
    expect(takePrefetched("/never-prefetched")).toBeNull();
  });

  it("expire after a few seconds so stale data is never shown", async () => {
    vi.useFakeTimers();
    const { prefetchApi, takePrefetched } = await load();
    prefetchApi("/alerts");
    vi.advanceTimersByTime(16_000);
    expect(takePrefetched("/alerts")).toBeNull();
  });

  it("an unused failed prefetch does not raise", async () => {
    const apiMock = vi.fn(async () => { throw new Error("offline"); });
    vi.doMock("./api", () => ({ api: apiMock }));
    vi.stubGlobal("window", {});
    const { prefetchApi } = await import("./hooks");
    expect(() => prefetchApi("/dashboard")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
