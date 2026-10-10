import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ getAccessToken: async () => "test-token" }));
const { api, ApiError, errorMessage } = await import("./api");

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(body === null ? null : JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllGlobals());

/** Resolves to the error a promise rejected with; fails the test if it resolved instead. */
async function failure(p: Promise<unknown>): Promise<InstanceType<typeof ApiError>> {
  try {
    await p;
  } catch (e) {
    return e as InstanceType<typeof ApiError>;
  }
  throw new Error("expected the request to fail");
}

describe("api()", () => {
  it("sends the bearer token and returns parsed JSON on success", async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await expect(api("/me")).resolves.toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/me");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("never resolves on a server error: it throws the server's code and message", async () => {
    vi.stubGlobal("fetch", respond(422, { error: { code: "overpayment", message: "Payment exceeds the outstanding Rs. 500" } }));
    const err = await failure(api("/receivables/x/payments", { body: { amount_paisa: 1 } }));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("overpayment");
    expect(errorMessage(err)).toBe("Payment exceeds the outstanding Rs. 500");
  });

  it("turns validation details into a readable message", async () => {
    vi.stubGlobal("fetch", respond(422, { error: { code: "validation_error", message: "Request validation failed",
      details: [{ field: "amount_paisa", message: "Input should be greater than 0" }] } }));
    const err = await failure(api("/transactions", { body: {} }));
    expect(errorMessage(err)).toBe("amount_paisa: Input should be greater than 0");
  });

  it("reports an unreachable server as a network error, not success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const err = await failure(api("/dashboard"));
    expect(err.code).toBe("network_error");
  });

  it("handles non-JSON error bodies (e.g. a proxy 502) without crashing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 502 })));
    const err = await failure(api("/dashboard"));
    expect(err.status).toBe(502);
    expect(err.message).toBe("Request failed (502)");
  });
});
