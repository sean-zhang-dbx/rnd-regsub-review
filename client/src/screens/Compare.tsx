/* Sentences and their parts have no ids; the lists are fixed per render, so index keys are correct. */
/* eslint-disable react/no-array-index-key */
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { cn } from '@/lib/utils';
import { EmptyBlock, ErrorBlock, LoadingBlock, Panel } from '../components/States';
import { getCompare, pageImageUrl } from '../data/api';
import type { Compare as CompareData, ComparePage, Tick } from '../data/types';
import { useScorecard } from '../hooks/scorecard';
import { useAsync } from '../hooks/useAsync';
import { armLabel, rowWords, tlfLabel } from '../lib/format';
import { XRayMarker } from '../xray/XRay';

/*
 * The hero. Section 11.4.1 from the pod on the left, the submitted CSR page on the right, and a tick
 * between them for every figure. The tick column is the only animation in the app.
 */

const keyOf = (t: { sentence_idx: number; slot: string }) => `${t.sentence_idx}:${t.slot}`;

function reading(t: Tick): string {
  return `${tlfLabel(t.tlf)}, ${armLabel(t.column_name)}, ${rowWords(t.row_key)}: drafted ${t.drafted_value}, printed ${t.printed_value}`;
}

function TickMark({ match }: { match: boolean }) {
  return (
    <svg viewBox="0 0 18 18" className="size-[18px]" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label={match ? 'matches' : 'differs'}>
      {match ? (
        <path d="M3 9.5 L7.5 14 L15 4" stroke="var(--match)" className="tick-path" />
      ) : (
        <path d="M4 4 L14 14 M14 4 L4 14" stroke="var(--differs)" className="tick-path" />
      )}
    </svg>
  );
}

function usePrefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Reveals the ticks one by one, about 7 seconds in total, after a short pause. */
function useReveal(total: number, resetKey: string) {
  const reduced = usePrefersReducedMotion();
  const [count, setShown] = useState(0);
  useEffect(() => {
    if (total === 0 || reduced) return;
    const step = Math.min(700, Math.max(250, 7000 / total));
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        setShown((n) => {
          if (n + 1 >= total && timer) clearInterval(timer);
          return n + 1;
        });
      }, step);
    }, 1800);
    return () => {
      clearTimeout(start);
      if (timer) clearInterval(timer);
    };
  }, [total, resetKey, reduced]);
  return reduced ? total : count;
}

function PageView({ page, active, label }: { page: ComparePage; active: Tick | null; label: string }) {
  const el = active ? page.elements.find((e) => e.element_id === active.printed_element_id) : undefined;
  return (
    <div className="relative overflow-hidden rounded-control border border-border bg-card">
      <img src={pageImageUrl(page.image_path)} alt={label} className="block w-full" draggable={false} />
      {el && active?.printed_page === page.page ? (
        <div
          className="pointer-events-none absolute rounded-[2px] border-2 border-primary bg-primary/10"
          style={{ left: `${(el.x0 / page.width) * 100}%`, top: `${(el.y0 / page.height) * 100}%`, width: `${((el.x1 - el.x0) / page.width) * 100}%`, height: `${((el.y1 - el.y0) / page.height) * 100}%` }}
          data-testid="element-box"
        />
      ) : null}
    </div>
  );
}

function Body({ data, title }: { data: CompareData; title: string }) {
  const { ticks } = data;
  const shown = useReveal(ticks.length, data.section);
  const [hover, setHover] = useState<string | null>(null);
  const [pageNo, setPageNo] = useState<number | null>(null);
  const done = shown >= ticks.length;
  const indexOf = useMemo(() => new Map(ticks.map((t, i) => [keyOf(t), i])), [ticks]);
  const hoveredTick = hover ? ticks[indexOf.get(hover) ?? -1] : undefined;
  const current = done ? hoveredTick : (hoveredTick ?? ticks[Math.max(0, shown - 1)]);
  const matched = ticks.filter((t) => t.match).length;
  const tables = [...new Set(ticks.map((t) => tlfLabel(t.tlf)))];
  const pages = data.submitted.pages;
  const firstPage = ticks[0]?.printed_page ?? pages[0]?.page;
  const page = pages.find((p) => p.page === (hoveredTick?.printed_page ?? pageNo ?? firstPage)) ?? pages[0];

  return (
    <>
      <h1 className="min-h-[1.3em] max-w-[960px] text-[28px] leading-tight font-semibold tracking-[-0.01em]" aria-live="polite">
        {done ? (
          <>
            <span className={cn('num text-[27px] font-medium', matched < ticks.length && 'text-differs')}>{matched}</span> of <span className="num text-[27px] font-medium">{ticks.length}</span>{' '}
            figures in {data.section} match the submitted {tables.join(' and ')}.
          </>
        ) : (
          <span className="text-muted-foreground">
            Checking figure <span className="num">{Math.max(1, shown)}</span> of <span className="num">{ticks.length}</span> against the submitted CSR.
          </span>
        )}
      </h1>
      <p className="num mt-1 min-h-[1.5em] text-[13px] text-muted-foreground" data-testid="reading">
        {current && (shown > 0 || hoveredTick) ? reading(current) : ''}
      </p>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_minmax(380px,0.8fr)] items-start gap-5">
        <Panel className="shadow-page">
          <XRayMarker id="compare" />
          <header className="border-b border-border px-6 py-3 pr-12">
            <p className="text-[13px] text-muted-foreground">Drafted by the CSR Pod</p>
            <h2 className="text-[17px] font-semibold">
              <span className="num mr-2 text-[15px]">{data.section}</span>
              {title}
            </h2>
          </header>
          <div className="divide-y divide-border/60">
            {data.drafted.map((s, si) => {
              const own = ticks.filter((t) => t.sentence_idx === si);
              return (
                <div key={si} className="grid grid-cols-[minmax(0,1fr)_52px] items-center">
                  <p className="px-6 py-3 text-[16px] leading-[1.7]">
                    {s.parts.map((p, pi) => {
                      if ('text' in p) return <span key={pi}>{p.text}</span>;
                      const k = `${si}:${p.slot}`;
                      const t = ticks[indexOf.get(k) ?? -1];
                      const bad = t && !t.match;
                      return (
                        <span
                          key={pi}
                          tabIndex={0}
                          data-figure={k}
                          title={t ? reading(t) : undefined}
                          onMouseEnter={() => setHover(k)}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => setHover(k)}
                          onBlur={() => setHover(null)}
                          className={cn('num cursor-default rounded-[3px] px-[3px] py-px text-[14px]', bad ? 'bg-differs/10 text-differs' : 'bg-bound', hover === k && 'ring-2 ring-primary')}
                        >
                          {p.value}
                        </span>
                      );
                    })}
                    {s.interpretation ? <span className="ml-2 text-[12px] text-muted-foreground">Left for a person</span> : null}
                  </p>
                  <div className="flex flex-col items-center justify-center gap-1 py-2">
                    {own.map((t) => {
                      const i = indexOf.get(keyOf(t)) ?? 0;
                      const visible = i < shown;
                      return (
                        <span key={keyOf(t)} className="flex size-[22px] items-center justify-center" onMouseEnter={() => setHover(keyOf(t))} onMouseLeave={() => setHover(null)}>
                          {visible ? <TickMark match={t.match} /> : <span className="size-[7px] rounded-full bg-border" aria-hidden="true" />}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <div className="sticky top-0 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-[14px] font-medium">Submitted CSR</p>
            <div className="ml-auto flex gap-1" role="tablist" aria-label="Pages of the submitted CSR">
              {pages.map((p) => (
                <button
                  key={p.page}
                  type="button"
                  role="tab"
                  aria-selected={p.page === page?.page}
                  onClick={() => setPageNo(p.page)}
                  className={cn('num rounded-control border px-2 py-0.5 text-[12px]', p.page === page?.page ? 'border-primary bg-bound text-primary' : 'border-border bg-card text-muted-foreground hover:text-foreground')}
                >
                  p {p.page}
                </button>
              ))}
            </div>
          </div>
          <div className="shadow-page">
            {page ? <PageView page={page} active={current ?? null} label={`Submitted CSR, page ${page.page}`} /> : <EmptyBlock title="No page image">The parsed pages are not available.</EmptyBlock>}
          </div>
        </div>
      </div>

      <Panel className="mt-5 max-w-[1100px]">
        <header className="flex items-baseline gap-4 border-b border-border px-6 py-3">
          <h2 className="text-[17px] font-semibold">Wording</h2>
          <p className="num text-[15px]">Coverage {data.wording.coverage_score} of 5</p>
        </header>
        <div className="grid grid-cols-2 gap-8 px-6 py-4">
          <p className="text-[15px] leading-relaxed">{data.wording.notes}</p>
          <div>
            <h3 className="mb-1.5 text-[13px] font-medium text-muted-foreground">Left for a person</h3>
            {data.wording.left_for_person.length === 0 ? (
              <p className="text-[14px] text-muted-foreground">Nothing was left for a person in this section.</p>
            ) : (
              <ul className="list-disc space-y-1.5 pl-5 text-[15px] leading-snug marker:text-muted-foreground">
                {data.wording.left_for_person.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>
    </>
  );
}

export function Compare() {
  const [params] = useSearchParams();
  const section = params.get('section') ?? '11.4.1';
  const sc = useScorecard();
  const runId = sc.data?.run.run_id;
  const c = useAsync(() => getCompare(runId, section), [runId, section]);
  const title = sc.data?.rows.find((r) => r.section === section)?.title ?? '';
  return (
    <div className="mx-auto max-w-[1320px]">
      {c.loading || sc.loading ? (
        <LoadingBlock rows={7} />
      ) : c.error || !c.data ? (
        <ErrorBlock title={`Section ${section} could not be compared`} detail={c.error} onRetry={c.retry} />
      ) : c.data.ticks.length === 0 ? (
        <EmptyBlock
          title={`Section ${section} has no figures to check`}
          action={
            <Link to="/" className="mt-3 text-[14px] font-medium text-primary underline underline-offset-4">
              Back to the scorecard
            </Link>
          }
        >
          The wording score for this section is on the scorecard.
        </EmptyBlock>
      ) : (
        <Body key={c.data.section} data={c.data} title={title} />
      )}
    </div>
  );
}
