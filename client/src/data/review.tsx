import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { REVIEWER_FULL } from '../lib/format';
import { postSignoff } from './api';
import type { SignoffAction } from './types';

/*
 * Review state comes from `review_signoffs` (the `signoffs` query), so a reload keeps it and
 * resetting the table resets the demo. The analytics plugin caches results by parameters, so each page
 * load sends a fresh nonce. Successful writes in this session are added locally at once.
 */
export interface ReviewRow {
  sentence_id: string;
  action: string;
  reviewer: string;
  signed_at: string;
}

interface Review {
  loading: boolean;
  error: string | null;
  recomputed: boolean;
  withWriter: boolean;
  approved: ReviewRow | null;
  notified: { count: number; at: string; reviewer: string } | null;
  record: (ids: string[], action: SignoffAction) => Promise<void>;
}

const ReviewContext = createContext<Review | null>(null);

export function ReviewProvider({ children }: { children: ReactNode }) {
  const [nonce] = useState(() => String(Date.now()));
  const q = useAnalyticsQuery('signoffs', { nonce: sql.string(nonce) });
  const [local, setLocal] = useState<ReviewRow[]>([]);

  const record = useCallback(async (ids: string[], action: SignoffAction) => {
    await postSignoff(ids, action);
    const signed_at = new Date().toISOString();
    setLocal((l) => [...ids.map((sentence_id) => ({ sentence_id, action, reviewer: REVIEWER_FULL, signed_at })), ...l]);
  }, []);

  const value = useMemo<Review>(() => {
    const rows: ReviewRow[] = [...local, ...(q.data ?? [])];
    const has = (a: string) => rows.some((r) => r.action === a);
    const approved = rows.find((r) => r.action === 'approved') ?? null;
    const owners = rows.filter((r) => r.action === 'notified_owner');
    let notified: Review['notified'] = null;
    if (owners.length > 0) {
      const newest = owners.reduce((a, b) => (a.signed_at >= b.signed_at ? a : b));
      const t = new Date(newest.signed_at).getTime();
      const batch = owners.filter((r) => Math.abs(new Date(r.signed_at).getTime() - t) < 5000);
      notified = { count: new Set(batch.map((r) => r.sentence_id)).size, at: newest.signed_at, reviewer: newest.reviewer };
    }
    return {
      loading: q.loading,
      error: q.error,
      recomputed: has('sent_to_labelling'),
      withWriter: has('sent_to_writer'),
      approved,
      notified,
      record,
    };
  }, [local, q.data, q.loading, q.error, record]);

  return <ReviewContext.Provider value={value}>{children}</ReviewContext.Provider>;
}

export function useReview(): Review {
  const v = useContext(ReviewContext);
  if (!v) throw new Error('useReview must be used inside ReviewProvider');
  return v;
}
