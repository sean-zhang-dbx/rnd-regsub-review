import { useCallback, useEffect, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
  reload: () => void;
}

/** Runs `fn` on mount, when `deps` change and on retry. `reload` refetches without clearing the data. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [attempt, setAttempt] = useState(0);
  const [silent, setSilent] = useState(false);
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });

  useEffect(() => {
    let live = true;
    setState((s) => (silent ? s : { data: null, loading: true, error: null }));
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
  }, [attempt, ...deps]);

  const retry = useCallback(() => {
    setSilent(false);
    setAttempt((n) => n + 1);
  }, []);
  const reload = useCallback(() => {
    setSilent(true);
    setAttempt((n) => n + 1);
  }, []);
  return { ...state, retry, reload };
}
