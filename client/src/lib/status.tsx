import type { ImpactRow, WordingCheckResult } from '../data/types';
import { useReview } from '../data/review';

/* One QC status per finding, shared by the QC log, the dossier tree and the viewer. */
export type QcStatus = 'open' | 'checking' | 'writer' | 'labelling' | 'recomputed' | 'approved';

export const STATUS_LABEL: Record<QcStatus, string> = {
  open: 'Ready for review',
  checking: 'Checking wording',
  writer: 'With the writer',
  labelling: 'Sent to Labelling',
  recomputed: 'Recomputed',
  approved: 'Approved',
};

const PILL: Record<QcStatus, string> = {
  open: 'bg-open-soft text-ink',
  checking: 'bg-open-soft text-ink-muted',
  writer: 'bg-attention-soft text-attention',
  labelling: 'bg-attention-soft text-attention',
  recomputed: 'bg-recomputed-soft text-recomputed',
  approved: 'bg-recomputed text-page',
};

export function statusOf(
  row: ImpactRow,
  s: { done: boolean; approved: boolean; wordingLoading: boolean; verdict?: WordingCheckResult },
): QcStatus {
  if (row.kind === 'label') return s.done ? 'labelling' : 'open';
  if (row.kind === 'prose') {
    if (!s.done) return 'open';
    if (s.wordingLoading) return 'checking';
    return s.verdict?.verdict === 'needs_writer' ? 'writer' : 'recomputed';
  }
  if (s.approved) return 'approved';
  return s.done ? 'recomputed' : 'open';
}

/** The Vault-style status pill. */
export function StatusPill({ status, wrap = false }: { status: QcStatus; wrap?: boolean }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium ${wrap ? 'rounded-[10px] leading-snug' : 'whitespace-nowrap rounded-full'} ${PILL[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Status of each finding from the shared review state. */
export function useStatusOf(): (row: ImpactRow) => QcStatus {
  const review = useReview();
  const done = review.phase === 'done';
  const approved = !!review.approved;
  return (row) =>
    statusOf(row, {
      done,
      approved,
      wordingLoading: done && review.wording.loading,
      verdict: review.verdicts.get(row.sentence_id),
    });
}
