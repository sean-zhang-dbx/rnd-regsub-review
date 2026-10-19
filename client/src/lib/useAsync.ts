import { useCallback, useEffect, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/** Runs `fn` on mount (and on retry) for server routes that read or compute. */
export function useAsync<T>(fn: () => Promise<T>, enabled = true): AsyncState<T> {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: enabled,
    error: null,
  });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState({ data: null, loading: true, error: null });
    fn().then(
      (data) => {
        if (live) setState({ data, loading: false, error: null });
      },
      (e: unknown) => {
        if (live) setState({ data: null, loading: false, error: e instanceof Error ? e.message : 'The request failed.' });
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
