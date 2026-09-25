"use client";

import { useEffect, useRef } from "react";

/** Refresh visible Sheet-backed data every 30s and when the user returns. */
export function useSheetAutoRefresh(refresh: () => void | Promise<unknown>) {
  const refreshRef = useRef(refresh);
  const busyRef = useRef(false);
  const lastRunRef = useRef(0);

  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== "visible" || busyRef.current) return;
      const now = Date.now();
      if (now - lastRunRef.current < 1500) return;
      lastRunRef.current = now;
      busyRef.current = true;
      void (async () => {
        try {
          await refreshRef.current();
        } catch {
          // Page loaders own visible error reporting; this is only a timer.
        } finally {
          busyRef.current = false;
        }
      })();
    };

    const timer = window.setInterval(run, 30_000);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", run);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", run);
    };
  }, []);
}
