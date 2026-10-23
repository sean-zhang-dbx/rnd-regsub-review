import { Link } from 'react-router';
import { cn } from '@/lib/utils';
import { EmptyBlock, ErrorBlock, LoadingBlock, Panel } from '../components/States';
import type { ScoreRow } from '../data/types';
import { useScorecard } from '../hooks/scorecard';
import { formatDuration } from '../lib/format';
import { XRayMarker } from '../xray/XRay';

export const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_240px_96px_104px_150px] items-center gap-4';

export function rowTarget(r: ScoreRow) {
  return r.status === 'differs' ? '/redelivery' : `/compare?section=${encodeURIComponent(r.section)}`;
}

export function ScoreHead() {
  return (
    <div className={cn(ROW_GRID, 'border-b border-border px-5 py-2.5 text-[13px] text-muted-foreground')}>
      <span>Section</span>
      <span>Figures match the submitted CSR</span>
      <span>Coverage</span>
      <span>For a person</span>
      <span>Owner</span>
    </div>
  );
}

/** One row of the strip. Agreement is quiet ink; a difference is the only rust on the page. */
export function ScoreLine({ r, to }: { r: ScoreRow; to?: string }) {
  const differs = r.status === 'differs';
  const pct = r.figures_total ? (r.figures_matched / r.figures_total) * 100 : 0;
  const body = (
    <>
      <span className="flex min-w-0 items-baseline gap-3">
        <span className={cn('num w-14 shrink-0 text-[14px]', differs && 'font-medium text-differs')}>{r.section}</span>
        <span className={cn('truncate text-[15px]', differs ? 'font-semibold text-differs' : 'text-foreground')}>{r.title}</span>
      </span>
      <span className="flex items-center gap-3">
        {r.figures_total > 0 ? (
          <>
            <span className="relative h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-differs/30" aria-hidden="true">
              <span className="absolute inset-y-0 left-0 bg-match/55" style={{ width: `${pct}%` }} />
              {differs ? <span className="absolute inset-y-0 right-0 bg-differs" style={{ width: `${100 - pct}%` }} /> : null}
            </span>
            <span className={cn('num text-[14px]', differs && 'font-medium text-differs')}>
              {r.figures_matched}/{r.figures_total}
            </span>
            {differs ? <span className="text-[13px] font-medium text-differs">{r.figures_total - r.figures_matched} differ</span> : null}
          </>
        ) : (
          <span className="text-[13px] text-muted-foreground">No figures</span>
        )}
      </span>
      <span className="num text-[14px]">{r.coverage_score === null ? "not scored" : `${r.coverage_score} of 5`}</span>
      <span className="num text-[14px]">{r.needs_person}</span>
      <span className="truncate text-[14px] text-muted-foreground">{r.department}</span>
    </>
  );
  const cls = cn(ROW_GRID, 'relative border-b border-border/70 px-5 py-2 last:border-b-0', differs && 'bg-differs/[0.06]');
  return to ? (
    <Link to={to} className={cn(cls, 'group cursor-pointer transition-colors hover:bg-accent focus-visible:bg-accent')}>
      <svg viewBox="0 0 16 16" className="absolute top-1/2 right-0.5 size-4 -translate-y-1/2 text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3.5 L10.5 8 L6 12.5" />
      </svg>
      {differs ? <span className="absolute inset-y-0 left-0 w-[3px] bg-differs" aria-hidden="true" /> : null}
      {body}
    </Link>
  ) : (
    <div className={cls}>
      {differs ? <span className="absolute inset-y-0 left-0 w-[3px] bg-differs" aria-hidden="true" /> : null}
      {body}
    </div>
  );
}

export function Scorecard() {
  const sc = useScorecard();
  const d = sc.data;
  return (
    <div className="w-full max-w-[1760px]">
      {sc.loading ? (
        <LoadingBlock rows={8} />
      ) : sc.error || !d ? (
        <ErrorBlock title="The scorecard could not be loaded" detail={sc.error} onRetry={sc.retry} />
      ) : d.rows.length === 0 ? (
        <EmptyBlock title="No finished run yet">The scorecard appears once the pod has drafted the CSR.</EmptyBlock>
      ) : (
        <>
          <h1 className="max-w-[1020px] text-[30px] leading-[1.25] font-semibold tracking-[-0.01em] text-balance">
            The CSR Pod drafted this report from an empty ICH E3 template in {formatDuration(d.headline.wall_ms)}, with each figure filled from a certified table.
          </h1>
          <p className="mt-3 text-[16px] text-muted-foreground">
            Figures that match the submitted CSR:{' '}
            <span className="num font-medium text-foreground">
              {d.headline.figures_matched} of {d.headline.figures_total}
            </span>
            {d.headline.redraft ? (
              <>
                . {d.headline.redraft.sections.length === 1 ? `Section ${d.headline.redraft.sections[0]} was` : `Sections ${d.headline.redraft.sections.join(', ')} were`} redrafted in{' '}
                {formatDuration(d.headline.redraft.wall_ms)} after Biostatistics re-delivered Table 14-5.01
              </>
            ) : null}
            .
          </p>
          <Panel className="mt-7">
            <XRayMarker id="scorecard" />
            <ScoreHead />
            <div>
              {d.rows.map((r) => (
                <ScoreLine key={r.section} r={r} to={rowTarget(r)} />
              ))}
            </div>
          </Panel>
          <p className="mt-3 text-[13px] text-muted-foreground">Sections 12.4 and 12.5 (laboratory and vital signs) are not part of this demo.</p>
        </>
      )}
    </div>
  );
}
