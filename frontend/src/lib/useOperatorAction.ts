"use client";

import { useCallback, useState } from "react";
import { ApiError } from "./api";
import { useAuth } from "./auth";

export interface ActionMessage {
  tone: "ok" | "error";
  text: string;
}

/**
 * Runs an operator action (an authenticated API call) and tracks busy state and the
 * resulting message. A 401 means the session expired, so the UI drops back to signed-out.
 */
export function useOperatorAction(onDone?: () => void) {
  const { invalidate } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessage | null>(null);

  const run = useCallback(
    async (action: () => Promise<unknown>, success: string) => {
      setBusy(true);
      setMessage(null);
      try {
        await action();
        setMessage({ tone: "ok", text: success });
        onDone?.();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) invalidate();
        setMessage({ tone: "error", text: e instanceof Error ? e.message : String(e) });
      } finally {
        setBusy(false);
      }
    },
    [invalidate, onDone],
  );

  return { busy, message, run };
}
