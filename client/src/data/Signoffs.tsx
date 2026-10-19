import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useAnalyticsQuery } from '@databricks/appkit-ui/react';
import type { SignoffRow } from './types';

export interface SignoffReadback {
  loading: boolean;
  rows: SignoffRow[] | null;
  error: string | null;
}

function Probe({ onResult }: { onResult: (r: SignoffReadback) => void }) {
  const q = useAnalyticsQuery('signoffs', {});
  useEffect(() => {
    if (!q.loading) onResult({ loading: false, rows: q.data, error: q.error });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.loading, q.data, q.error]);
  return null;
}

/*
 * Reads `signoffs` once after a write. The probe mounts only while reading, so the shared
 * request cache is released each time and the next read goes back to the warehouse.
 */
export function useSignoffReadback(): { probe: ReactNode; read: () => void; result: SignoffReadback | null } {
  const [active, setActive] = useState(false);
  const [result, setResult] = useState<SignoffReadback | null>(null);
  const read = useCallback(() => {
    setResult({ loading: true, rows: null, error: null });
    setActive(true);
  }, []);
  const onResult = useCallback((r: SignoffReadback) => {
    setResult(r);
    setActive(false);
  }, []);
  return { probe: active ? <Probe onResult={onResult} /> : null, read, result };
}
