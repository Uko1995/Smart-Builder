"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

type QueryState<T> = {
  status: "loading" | "error" | "ready";
  data: T | null;
  error: string | null;
  reload: () => void;
};

export function useQuery<T>(path: string): QueryState<T> {
  const [nonce, setNonce] = useState(0);
  const [status, setStatus] = useState<QueryState<T>["status"]>("loading");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    api<T>(path)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setStatus("ready");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setError(reason instanceof Error ? reason.message : "The request failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { status, data, error, reload };
}
