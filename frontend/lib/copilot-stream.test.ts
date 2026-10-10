import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ getAccessToken: async () => "test-token" }));
const { askCopilot, buildHistory, parseSse, HISTORY_TURNS } = await import("./copilot-stream");

afterEach(() => vi.unstubAllGlobals());

const req = { question: "cash?", language: "en" as const, context: null, history: [] };

function streamResponse(chunks: string[]) {
  const enc = new TextEncoder();
  const body = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("parseSse", () => {
  it("returns complete events and keeps the partial tail", () => {
    const { events, rest } = parseSse('event: status\ndata: {"stage":"understanding"}\n\nevent: answer\ndata: {"a"');
    expect(events).toEqual([{ event: "status", data: '{"stage":"understanding"}' }]);
    expect(rest).toBe('event: answer\ndata: {"a"');
  });
});

describe("buildHistory", () => {
  it("keeps only the last 8 user/assistant messages and drops errors", () => {
    const msgs = Array.from({ length: 6 }, (_, i) => [
      { role: "user" as const, text: `q${i}` },
      { role: "bot" as const, answer: { answer: `a${i}` } },
      { role: "error" as const, text: "oops" },
    ]).flat();
    const h = buildHistory(msgs);
    expect(h).toHaveLength(HISTORY_TURNS);
    expect(h[0]).toEqual({ role: "user", text: "q2" });
    expect(h.at(-1)).toEqual({ role: "assistant", text: "a5" });
  });
});

describe("askCopilot", () => {
  it("reports each stage then resolves with the answer, even across chunk boundaries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([
      'event: status\ndata: {"stage":"understanding"}\n\nevent: sta',
      'tus\ndata: {"stage":"calculating"}\n\n',
      'event: answer\ndata: {"intent":"balance","answer":"Rs. 1"}\n\n',
    ])));
    const stages: string[] = [];
    const a = await askCopilot(req, (s) => stages.push(s));
    expect(stages).toEqual(["understanding", "calculating"]);
    expect(a.answer).toBe("Rs. 1");
  });

  it("falls back to the JSON endpoint when the stream route is missing", async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith("/stream")
      ? new Response("not found", { status: 404 })
      : new Response(JSON.stringify({ intent: "balance", answer: "Rs. 2" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const a = await askCopilot(req, () => undefined);
    expect(a.answer).toBe("Rs. 2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("turns an error event into a readable error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse(['event: error\ndata: {"code":"internal_error","message":"try again"}\n\n'])));
    await expect(askCopilot(req, () => undefined)).rejects.toThrow("try again");
  });
});
