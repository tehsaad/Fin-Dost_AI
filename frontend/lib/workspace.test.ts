import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSelection, readSelection, safeAppPath, SELECTION_KEY, sessionKeyFromToken, writeSelection } from "./workspace";

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: object) => `${b64url({ alg: "ES256" })}.${b64url(claims)}.signature`;

describe("workspace selection is bound to the sign-in session", () => {
  const sessionA = sessionKeyFromToken(jwt({ sub: "user-1", session_id: "s-aaa", iat: 1 }));
  const sameSessionRefreshed = sessionKeyFromToken(jwt({ sub: "user-1", session_id: "s-aaa", iat: 999 }));
  const nextSignIn = sessionKeyFromToken(jwt({ sub: "user-1", session_id: "s-bbb", iat: 2 }));
  const otherUser = sessionKeyFromToken(jwt({ sub: "user-2", session_id: "s-aaa", iat: 1 }));

  it("keeps the choice across token refreshes and tabs of the same session", () => {
    const store = new MemoryStorage();
    expect(writeSelection(store, sessionA, "ws-company")).toBe(true);
    expect(readSelection(store, sessionA)).toBe("ws-company");
    expect(sameSessionRefreshed).toBe(sessionA);
    expect(readSelection(store, sameSessionRefreshed)).toBe("ws-company");
  });

  it("asks again after a new sign-in or for a different person on the same browser", () => {
    const store = new MemoryStorage();
    writeSelection(store, sessionA, "ws-company");
    expect(readSelection(store, nextSignIn)).toBeNull();
    expect(readSelection(store, otherUser)).toBeNull();
  });

  it("has no choice before the user picks one, and none after it is cleared", () => {
    const store = new MemoryStorage();
    expect(readSelection(store, sessionA)).toBeNull();
    writeSelection(store, sessionA, "ws-own");
    clearSelection(store);
    expect(readSelection(store, sessionA)).toBeNull();
    expect(store.getItem(SELECTION_KEY)).toBeNull();
  });

  it("ignores the old unbound value so the last-used workspace is never opened silently", () => {
    const store = new MemoryStorage();
    store.setItem("findost_workspace", "ws-from-an-old-version");
    expect(readSelection(store, sessionA)).toBeNull();
    expect(store.getItem("findost_workspace")).toBeNull();
  });

  it("uses subject + issue time for local developer tokens and rejects malformed tokens", () => {
    expect(sessionKeyFromToken(jwt({ sub: "dev-x", iat: 123 }))).toBe("dev-x:123");
    expect(sessionKeyFromToken("not-a-jwt")).toBeNull();
    expect(sessionKeyFromToken(null)).toBeNull();
    expect(readSelection(new MemoryStorage(), null)).toBeNull();
  });

  it("only allows same-site destinations after choosing", () => {
    expect(safeAppPath("/budget?month=2026-10")).toBe("/budget?month=2026-10");
    expect(safeAppPath("//evil.example")).toBe("/dashboard");
    expect(safeAppPath("https://evil.example")).toBe("/dashboard");
    expect(safeAppPath("/workspaces")).toBe("/dashboard");
    expect(safeAppPath(null)).toBe("/dashboard");
  });
});

describe("api client and switching", () => {
  const token = jwt({ sub: "user-1", session_id: "s-aaa", iat: 1 });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  async function load() {
    const store = new MemoryStorage();
    const assign = vi.fn();
    vi.stubGlobal("window", { localStorage: store, location: { assign }, dispatchEvent: vi.fn() });
    vi.doMock("./auth", () => ({ getAccessToken: async () => token }));
    const mod = await import("./api");
    return { ...mod, store, assign };
  }

  it("sends no workspace header until one is chosen, then sends the chosen one", async () => {
    const { authHeaders, enterWorkspace } = await load();
    expect((await authHeaders())["X-Workspace-Id"]).toBeUndefined();
    await enterWorkspace("ws-company", "/budget");
    expect((await authHeaders())["X-Workspace-Id"]).toBe("ws-company");
  });

  it("switching reloads the app at the new destination (dropping the old workspace's in-memory data) without signing out", async () => {
    const { enterWorkspace, assign, authHeaders } = await load();
    await enterWorkspace("ws-own", "/dashboard");
    await enterWorkspace("ws-company", "/dashboard");
    expect(assign).toHaveBeenLastCalledWith("/dashboard");
    const h = await authHeaders();
    expect(h.Authorization).toBe(`Bearer ${token}`);
    expect(h["X-Workspace-Id"]).toBe("ws-company");
  });

  it("a revoked workspace triggers the selection screen", async () => {
    const { api } = await load();
    const events: string[] = [];
    (window.dispatchEvent as unknown as ReturnType<typeof vi.fn>).mockImplementation((e: Event) => { events.push(e.type); return true; });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "workspace_not_found", message: "Workspace not found" } }), { status: 404 })));
    await expect(api("/dashboard")).rejects.toMatchObject({ code: "workspace_not_found" });
    expect(events).toContain("findost:workspace_lost");
  });
});
