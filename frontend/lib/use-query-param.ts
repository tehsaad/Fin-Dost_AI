"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/**
 * Read a URL query parameter without opting the page out of static rendering (unlike useSearchParams, which
 * needs a Suspense boundary and leaves the page blank until its JavaScript has loaded). Returns null while the
 * server-rendered HTML is shown, then the real value right after the page becomes interactive.
 */
export function useQueryParam(name: string): string | null {
  return useSyncExternalStore(subscribe, () => new URLSearchParams(window.location.search).get(name), () => null);
}
