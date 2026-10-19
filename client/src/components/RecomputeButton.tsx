import { Button } from '@databricks/appkit-ui/react';
import { useReview } from '../data/review';
import { TLF } from '../lib/format';

/** The hero action, the same on the QC log and in the viewer. */
export function RecomputeButton({ size = 'lg' }: { size?: 'lg' | 'default' }) {
  const review = useReview();
  const done = review.phase === 'done';
  return (
    <Button size={size} className="shrink-0" onClick={review.start} disabled={review.phase === 'recomputing' || done}>
      {review.phase === 'recomputing'
        ? 'Recomputing from source'
        : done
          ? `Recomputed from ${TLF.efficacy_primary} v${review.sourceVersion ?? ''}`
          : review.phase === 'failed'
            ? 'Recompute again'
            : `Recompute from ${TLF.efficacy_primary} v4`}
    </Button>
  );
}
