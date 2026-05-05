import { useCallback, useEffect, useState } from "react";
import { initDb } from "./init";

type DbReadyState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

export function useDbReady() {
  const [state, setState] = useState<DbReadyState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    initDb()
      .then(() => {
        if (!cancelled) setState({ status: "ready" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Unknown database error";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, retry };
}
