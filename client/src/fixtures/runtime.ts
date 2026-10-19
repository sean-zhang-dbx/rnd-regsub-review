import { useEffect, useState } from 'react';

export interface QueryState<T> {
  data: T[] | null;
  loading: boolean;
  error: string | null;
}

/** `?fixture=loading|empty|error` forces a state so every data component can be checked. */
function forcedState(): 'loading' | 'empty' | 'error' | null {
  const v = new URLSearchParams(window.location.search).get('fixture');
  return v === 'loading' || v === 'empty' || v === 'error' ? v : null;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fixtureRoute<T>(value: T, ms: number): Promise<T> {
  await delay(ms);
  if (forcedState() === 'error') throw new Error('Fixture error: the request failed.');
  return value;
}

export function useFixtureQuery<T>(get: () => T[], ms = 450, enabled = true, dep = 0): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ data: null, loading: enabled, error: null });
  useEffect(() => {
    if (!enabled) return;
    const forced = forcedState();
    if (forced === 'loading') return;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(() => {
      if (forced === 'error') setState({ data: null, loading: false, error: 'Fixture error: the query failed.' });
      else if (forced === 'empty') setState({ data: [], loading: false, error: null });
      else setState({ data: get(), loading: false, error: null });
    }, ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, dep]);
  return state;
}
