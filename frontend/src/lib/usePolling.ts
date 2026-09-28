"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Poll `fetcher` every `intervalMs`, pausing while the tab is hidden.
 * `fetcher` must be stable (module-level or memoised), or polling restarts every render.
 * Returns the latest data, the latest error (cleared on success) and a manual refresh.
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await fetcher());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
    }
  }, [fetcher]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const tick = async () => {
      if (document.visibilityState === "visible") await refresh();
      if (!cancelled) timer = setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [intervalMs, refresh]);

  return { data, error, refresh };
}
