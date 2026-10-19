import { Button } from '@databricks/appkit-ui/react';
import { CircleCheck } from 'lucide-react';
import { useReview } from '../data/review';
import { TLF } from '../lib/format';

/** The hero action, the same on the QC log and in the viewer. Once done it becomes a status line. */
export function RecomputeButton({ size = 'lg' }: { size?: 'lg' | 'default' }) {
  const review = useReview();
  if (review.phase === 'done') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium whitespace-nowrap text-recomputed">
        <CircleCheck className="size-4" aria-hidden="true" />
        Recomputed from {TLF.efficacy_primary} v{review.sourceVersion ?? ''}
      </span>
    );
  }
  return (
    <Button size={size} className="shrink-0" onClick={review.start} disabled={review.phase === 'recomputing'}>
      {review.phase === 'recomputing'
        ? 'Recomputing from source'
        : review.phase === 'failed'
          ? 'Recompute again'
          : `Recompute from ${TLF.efficacy_primary} v4`}
    </Button>
  );
}
