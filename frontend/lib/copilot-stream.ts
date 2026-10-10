"use client";

import { api, ApiError, authHeaders } from "./api";
import type { CopilotAnswer, CopilotContext, CopilotStage, CopilotTurn } from "./types";

/** How many earlier chat messages are sent with each question (the API refuses more). */
export const HISTORY_TURNS = 8;

export interface CopilotRequest {
  question: string;
  language: "en" | "ur";
  context: CopilotContext | null;
  history: CopilotTurn[];
}

type SseEvent = { event: string; data: string };

/** Split a Server-Sent Events buffer into complete events and the unfinished remainder. */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: SseEvent[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (data.length) events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

/** The last `HISTORY_TURNS` messages as plain text (errors are left out). */
export function buildHistory(messages: ({ role: "user"; text: string } | { role: "bot"; answer: { answer: string } } | { role: "error"; text: string })[]): CopilotTurn[] {
  const turns: CopilotTurn[] = [];
  for (const m of messages) {
    if (m.role === "user") turns.push({ role: "user", text: m.text.slice(0, 1000) });
    else if (m.role === "bot") turns.push({ role: "assistant", text: m.answer.answer.slice(0, 1000) });
  }
  return turns.slice(-HISTORY_TURNS);
}

/**
 * Ask the copilot over the streaming endpoint, reporting progress stages as they arrive.
 * Falls back to the plain JSON endpoint when streaming isn't available (old proxy, no ReadableStream).
 */
export async function askCopilot(req: CopilotRequest, onStage: (stage: CopilotStage) => void, signal?: AbortSignal): Promise<CopilotAnswer> {
  const headers: Record<string, string> = { Accept: "text/event-stream", "Content-Type": "application/json", ...(await authHeaders()) };
  let res: Response | null = null;
  try {
    res = await fetch("/api/v1/copilot/stream", { method: "POST", headers, body: JSON.stringify(req), signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    res = null;
  }
  const streamable = res?.ok && res.body && (res.headers.get("content-type") ?? "").includes("text/event-stream");
  if (!res || !streamable) {
    // No stream (network hiccup, proxy without streaming, or a refusal): the JSON endpoint gives the same
    // answer, and reports refusals (auth, validation, feature) with the usual error handling.
    onStage("calculating");
    return api<CopilotAnswer>("/copilot/query", { body: req, signal });
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const { events, rest } = parseSse(done ? buffer + "\n\n" : buffer);
    buffer = rest;
    for (const ev of events) {
      const data = JSON.parse(ev.data);
      if (ev.event === "status") onStage(data.stage as CopilotStage);
      else if (ev.event === "answer") return data as CopilotAnswer;
      else if (ev.event === "error") throw new ApiError(data.code === "ai_quota" ? 429 : 500, data.code, data.message);
    }
    if (done) break;
  }
  throw new ApiError(0, "stream_ended", "The answer was cut off. Please ask again.");
}
