import { useEffect, useState } from "react";

const cache = new Map<string, unknown>();

/** Fetch-once-per-session loader for GitHub resources (README, releases, contributors). */
export function useGitHubResource<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string | null; data?: T; error?: string }>({ key: null });

  useEffect(() => {
    if (!key) return;
    if (cache.has(key)) {
      setState({ key, data: cache.get(key) as T });
      return;
    }
    let cancelled = false;
    setState({ key });
    load().then(
      (data) => {
        cache.set(key, data);
        if (!cancelled) setState({ key, data });
      },
      (e) => !cancelled && setState({ key, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const fresh = state.key === key;
  const data = fresh ? state.data : undefined;
  const error = fresh ? state.error : undefined;
  // Loading until this key has settled — including the first render, before the effect runs.
  return { data, error, loading: !!key && data === undefined && error === undefined };
}
