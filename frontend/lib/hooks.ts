"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

const PREFETCH_TTL_MS = 15_000;
const prefetched = new Map<string, { promise: Promise<unknown>; at: number }>();

/**
 * Start a GET early (e.g. while the account is still loading) so the page's useApi() can use the same response
 * instead of waiting for a second round trip. Each prefetched response is used at most once and only for a few
 * seconds; switching workspace reloads the app, which clears this cache.
 */
export function prefetchApi(path: string) {
  if (typeof window === "undefined") return;
  const hit = prefetched.get(path);
  if (hit && Date.now() - hit.at < PREFETCH_TTL_MS) return;
  const promise = api(path);
  promise.catch(() => undefined); // an unused failed prefetch must not raise; useApi reports errors it receives
  prefetched.set(path, { promise, at: Date.now() });
}

export function takePrefetched<T>(path: string): Promise<T> | null {
  const hit = prefetched.get(path);
  prefetched.delete(path);
  return hit && Date.now() - hit.at < PREFETCH_TTL_MS ? (hit.promise as Promise<T>) : null;
}

export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(path));
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    // the first load may reuse a request started early; reload() always asks the server again
    (version === 0 ? takePrefetched<T>(path) ?? api<T>(path, { signal: ctrl.signal }) : api<T>(path, { signal: ctrl.signal }))
      .then((d) => mounted.current && setData(d))
      .catch((e) => {
        if ((e as Error).name !== "AbortError" && mounted.current) setError(e as Error);
      })
      .finally(() => mounted.current && setLoading(false));
    return () => ctrl.abort();
  }, [path, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading, reload, setData };
}
