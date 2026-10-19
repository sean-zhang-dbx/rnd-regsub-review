import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import { REVIEWER_FULL } from '../lib/format';
import { postSignoff, postWordingCheck } from './api';
import { useImpactList, useRecomputeFigures } from './queries';
import { useAsync } from '../lib/useAsync';
import type { AsyncState } from '../lib/useAsync';
import type { ImpactRow, RecomputeRow, SignoffAction, WordingCheckResult } from './types';

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
  /* Recompute and wording check, shared by the log and the document. */
  phase: 'idle' | 'recomputing' | 'done' | 'failed';
  failure: string | null;
  /** True only when the reviewer clicked in this session, so the flip plays once. */
  animated: boolean;
  start: () => void;
  values: Record<string, string> | null;
  sourceVersion: number | null;
  wording: AsyncState<WordingCheckResult[]>;
  verdicts: Map<string, WordingCheckResult>;
  /** One row per affected sentence, in document order. */
  affected: ImpactRow[];
  impact: { loading: boolean; error: string | null; rows: ImpactRow[] };
}

/* Mounted only while recomputing, so the query runs when the reviewer clicks. */
function RecomputeRunner({ onDone, onFail }: { onDone: (rows: RecomputeRow[]) => void; onFail: (msg: string) => void }) {
  const q = useRecomputeFigures();
  useEffect(() => {
    if (q.error) onFail(q.error);
    else if (q.data && !q.loading) onDone(q.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, q.error, q.loading]);
  return null;
}

const ReviewContext = createContext<Review | null>(null);

export function ReviewProvider({ children }: { children: ReactNode }) {
  const [nonce] = useState(() => String(Date.now()));
  const q = useAnalyticsQuery('signoffs', { nonce: sql.string(nonce) });
  const [local, setLocal] = useState<ReviewRow[]>([]);
  const impactQ = useImpactList();
  const [phase, setPhase] = useState<Review['phase']>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [animated, setAnimated] = useState(false);
  const [recomputeRows, setRecomputeRows] = useState<RecomputeRow[] | null>(null);

  const record = useCallback(async (ids: string[], action: SignoffAction) => {
    await postSignoff(ids, action);
    const signed_at = new Date().toISOString();
    setLocal((l) => [...ids.map((sentence_id) => ({ sentence_id, action, reviewer: REVIEWER_FULL, signed_at })), ...l]);
  }, []);

  const affected = useMemo(() => {
    const seen = new Map<string, ImpactRow>();
    for (const r of impactQ.data ?? []) if (!seen.has(r.sentence_id)) seen.set(r.sentence_id, r);
    return [...seen.values()];
  }, [impactQ.data]);
  const affectedIds = affected.map((r) => r.sentence_id);
  const done = phase === 'done';
  const wording = useAsync(() => postWordingCheck(affectedIds, !animated), done && affectedIds.length > 0);
  const verdicts = useMemo(() => new Map((wording.data ?? []).map((r) => [r.sentence_id, r])), [wording.data]);
  const values = useMemo(
    () => (recomputeRows ? Object.fromEntries(recomputeRows.map((r) => [r.fig_key, r.value])) : null),
    [recomputeRows],
  );
  const sourceVersion = recomputeRows?.[0]?.source_version ?? null;
  const start = useCallback(() => {
    setAnimated(true);
    setFailure(null);
    setPhase('recomputing');
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
      phase,
      failure,
      animated,
      start,
      values,
      sourceVersion,
      wording,
      verdicts,
      affected,
      impact: { loading: impactQ.loading, error: impactQ.error, rows: impactQ.data ?? [] },
    };
  }, [local, q.data, q.loading, q.error, record, phase, failure, animated, start, values, sourceVersion, wording, verdicts, affected, impactQ.data, impactQ.loading, impactQ.error]);

  /* After a reload the review table already says the figures were recomputed: show that state, no flip. */
  useEffect(() => {
    if (value.recomputed && phase === 'idle') setPhase('recomputing');
  }, [value.recomputed, phase]);

  /* Record the hand-offs the moment they happen. The route names the reviewer. */
  const labelIds = affected.filter((r) => r.kind === 'label').map((r) => r.sentence_id);
  useEffect(() => {
    if (!done || labelIds.length === 0 || q.loading || value.recomputed) return;
    record(labelIds, 'sent_to_labelling').catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, q.loading]);
  useEffect(() => {
    const ids = (wording.data ?? []).filter((r) => r.verdict === 'needs_writer').map((r) => r.sentence_id);
    if (ids.length > 0 && !value.withWriter) record(ids, 'sent_to_writer').catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wording.data]);

  return (
    <ReviewContext.Provider value={value}>
      {phase === 'recomputing' ? (
        <RecomputeRunner
          onDone={(rows) => {
            setRecomputeRows(rows);
            setPhase('done');
          }}
          onFail={(msg) => {
            setFailure(msg);
            setPhase('failed');
          }}
        />
      ) : null}
      {children}
    </ReviewContext.Provider>
  );
}

export function useReview(): Review {
  const v = useContext(ReviewContext);
  if (!v) throw new Error('useReview must be used inside ReviewProvider');
  return v;
}
