/* Sentences and their parts have no ids; the lists are fixed per render, so index keys are correct. */
/* eslint-disable react/no-array-index-key */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { cn } from '@/lib/utils';
import { EmptyBlock, ErrorBlock, LoadingBlock, Panel } from '../components/States';
import { getCompare, pageImageUrl } from '../data/api';
import type { Compare as CompareData, ComparePage, Tick } from '../data/types';
import { useScorecard } from '../hooks/scorecard';
import { useAsync } from '../hooks/useAsync';
import { rowWords, tlfLabel } from '../lib/format';
import { XRayMarker } from '../xray/XRay';

/*
 * The hero. Section 11.4.1 from the pod on the left, the submitted CSR page on the right, and a tick
 * between them for every figure. The tick column is the only animation in the app.
 */

const keyOf = (t: { sentence_idx: number; slot: string }) => `${t.sentence_idx}:${t.slot}`;

/** The reading of one figure from the tick's own labels, without repeats. */
function reading(t: Tick): string {
  // TLF row labels use "Group: statistic" (for example "Baseline: mean"); the callout already ends the label with a colon.
  const row = (t.row_label || rowWords(t.row_key)).replace(/: /g, ' ');
  const parts = [tlfLabel(t.tlf), t.column_label, row].filter((p, i, all): p is string => !!p && all.indexOf(p) === i);
  return `${parts.join(', ')}: drafted ${t.drafted_value}, printed ${t.printed_value}`;
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

/** Reveals the ticks one by one, about 6 seconds in total, starting as soon as the data is on screen. */
const REVEAL_MS = 6000;
function useReveal(total: number, resetKey: string) {
  const reduced = usePrefersReducedMotion();
  const [count, setShown] = useState(0);
  useEffect(() => {
    if (total === 0 || reduced) return;
    const step = Math.min(380, Math.max(140, REVEAL_MS / total));
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      timer = setInterval(() => {
        setShown((n) => {
          if (n + 1 >= total && timer) clearInterval(timer);
          return n + 1;
        });
      }, step);
    }, 250);
    return () => {
      clearTimeout(start);
      if (timer) clearInterval(timer);
    };
  }, [total, resetKey, reduced]);
  return reduced ? total : count;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

type Rect = { x: number; y: number; w: number; h: number };

/** A window onto the page image: shows `crop` scaled to the frame width, and optionally a box around `box`. One <img>, so hovering never reloads it. */
function Frame({ page, src, label, crop, box, outline, testid }: { page: ComparePage; src: string; label: string; crop: Rect; box: Rect | null; outline?: Rect | null; testid: string }) {
  return (
    <div className="relative overflow-hidden rounded-control bg-card ring-1 ring-border" style={{ aspectRatio: `${crop.w} / ${crop.h}` }} data-testid={testid}>
      <div className="absolute" style={{ width: `${(page.width / crop.w) * 100}%`, left: `${-(crop.x / crop.w) * 100}%`, top: `${-(crop.y / crop.h) * 100}%` }}>
        <img src={src} alt={label} className="block w-full" draggable={false} />
        {outline ? (
          <div
            className="pointer-events-none absolute rounded-[2px] border border-primary/30"
            style={{ left: `${clamp01(outline.x / page.width) * 100}%`, top: `${clamp01(outline.y / page.height) * 100}%`, width: `${(outline.w / page.width) * 100}%`, height: `${(outline.h / page.height) * 100}%` }}
            data-testid="element-outline"
          />
        ) : null}
        {box ? (
          <div
            className="pointer-events-none absolute rounded-[2px] border-2 border-primary bg-primary/10"
            style={{ left: `${clamp01(box.x / page.width) * 100}%`, top: `${clamp01(box.y / page.height) * 100}%`, width: `${(box.w / page.width) * 100}%`, height: `${(box.h / page.height) * 100}%` }}
            data-testid="element-box"
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The submitted page. At rest it shows whole. While a figure is hovered it crops to the table element that holds the
 * printed cell, scaled to the panel width. The cell box comes from `printed_box` (the printed token, from the PDF text
 * layer); without it only a faint outline of the table element is drawn, never an estimate. A second strip magnifies the
 * line of the box with one line of context above and below.
 */
function PageView({ page, active, label }: { page: ComparePage; active: Tick | null; label: string }) {
  const src = pageImageUrl(page.image_path);
  const el = active && active.printed_page === page.page ? page.elements.find((e) => e.element_id === active.printed_element_id) : undefined;
  const whole: Rect = { x: 0, y: 0, w: page.width, h: page.height };
  if (!el || !active) {
    return (
      <div className="space-y-2">
        <Frame page={page} src={src} label={label} crop={whole} box={null} testid="page-whole" />
      </div>
    );
  }

  const padX = page.width * 0.012;
  const padY = page.height * 0.012;
  const x0 = Math.max(0, el.x0 - padX);
  const y0 = Math.max(0, el.y0 - padY);
  const crop: Rect = { x: x0, y: y0, w: Math.min(page.width, el.x1 + padX) - x0, h: Math.min(page.height, el.y1 + padY) - y0 };
  const outline: Rect = { x: el.x0, y: el.y0, w: el.x1 - el.x0, h: el.y1 - el.y0 };
  const pb = active.printed_box;
  let box: Rect | null = null;
  let strip: Rect | null = null;
  if (pb && pb.x1 > pb.x0 && pb.y1 > pb.y0) {
    box = { x: pb.x0 * page.width, y: pb.y0 * page.height, w: (pb.x1 - pb.x0) * page.width, h: (pb.y1 - pb.y0) * page.height };
    /* The box's line plus one line of context above and below, centred on the box, so the frame (which takes the crop's own aspect ratio) never clips it. */
    const line = Math.max(box.h, page.height * 0.008);
    const mid = box.y + box.h / 2;
    const half = Math.min(line * 1.6, mid, page.height - mid);
    const sx = Math.max(0, Math.min(el.x0, box.x) - padX);
    /* Full table width, so text after the box on the same line (for example "(0.82)") is not cut off. */
    strip = { x: sx, y: mid - half, w: Math.min(page.width, Math.max(el.x1, box.x + box.w) + padX) - sx, h: half * 2 };
  }
  return (
    <div className="space-y-2">
      <Frame page={page} src={src} label={label} crop={crop} box={box} outline={outline} testid="page-zoom" />
      {strip ? <Frame page={page} src={src} label={`${label}, the line of the printed cell`} crop={strip} box={box} testid="page-strip" /> : null}
    </div>
  );
}

/** The reading of one figure, next to the figure it belongs to. */
function Callout({ t }: { t: Tick }) {
  const ref = useRef<HTMLSpanElement>(null);
  /* Keep the callout inside the draft panel, so it never covers the page column on the right. */
  useLayoutEffect(() => {
    const el = ref.current;
    const panel = el?.closest('[data-draft-panel]');
    if (!el || !panel) return;
    const over = el.getBoundingClientRect().right - (panel.getBoundingClientRect().right - 8);
    const room = el.getBoundingClientRect().left - (panel.getBoundingClientRect().left + 8);
    el.style.transform = over > 0 ? `translateX(${-Math.min(over, Math.max(0, room))}px)` : '';
  }, [t]);
  return (
    <span ref={ref} role="tooltip" data-testid="callout" className={cn('num pointer-events-none absolute top-full left-0 z-20 mt-1 w-max max-w-[360px] rounded-control border bg-card px-2.5 py-1.5 text-[13px] leading-snug font-normal whitespace-normal shadow-page', t.match ? 'border-border' : 'border-differs/50 text-differs')}>
      {reading(t)}
    </span>
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
  const matched = ticks.filter((t) => t.match).length;
  const tables = [...new Set(ticks.map((t) => tlfLabel(t.tlf)))];
  const pages = data.submitted.pages;
  /* Warm the page images so the first hover does not wait for them. */
  useEffect(() => {
    pages.forEach((p) => {
      new Image().src = pageImageUrl(p.image_path);
    });
  }, [pages]);
  const firstPage = ticks[0]?.printed_page ?? pages[0]?.page;
  const page = pages.find((p) => p.page === (hoveredTick?.printed_page ?? pageNo ?? firstPage)) ?? pages[0];

  return (
    <>
      <h1 className="min-h-[1.3em] max-w-[1100px] text-[28px] leading-tight font-semibold tracking-[-0.01em]" aria-live="polite">
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
      <button
        type="button"
        onClick={() => document.getElementById('wording')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        className="mt-1 text-[14px] font-medium text-primary underline underline-offset-4"
      >
        Wording
      </button>

      <div className="mt-4 grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] items-start gap-5">
        <Panel className="shadow-page" data-draft-panel="">
          <XRayMarker id="compare" />
          <header className="border-b border-border px-6 py-3 pr-12">
            <p className="text-[13px] text-muted-foreground">Drafted by the CSR Pod</p>
            <h2 className="text-[17px] font-semibold">
              <span className="num mr-2 text-[15px]">{data.section}</span>
              {title}
            </h2>
          </header>
          <div className="divide-y divide-border/60">
            {data.drafted.map((s, si) => (
              <p key={si} className="px-6 py-3 text-[16px] leading-[1.9]">
                {s.parts.map((p, pi) => {
                  if ('text' in p) return <span key={pi}>{p.text}</span>;
                  const k = `${si}:${p.slot}`;
                  const t = ticks[indexOf.get(k) ?? -1];
                  const bad = t && !t.match;
                  const visible = t ? (indexOf.get(k) ?? 0) < shown : false;
                  return (
                    <span key={pi} className="relative whitespace-nowrap">
                      <span
                        tabIndex={0}
                        data-figure={k}
                        onMouseEnter={() => setHover(k)}
                        onMouseLeave={() => setHover(null)}
                        onFocus={() => setHover(k)}
                        onBlur={() => setHover(null)}
                        className={cn('num cursor-default rounded-[3px] px-[3px] py-px text-[14px]', bad ? 'bg-differs/10 text-differs' : 'bg-bound', hover === k && 'ring-2 ring-primary')}
                      >
                        {p.value}
                      </span>
                      <span className="inline-flex size-[20px] items-center justify-center align-middle" data-tick={k} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}>
                        {t && visible ? <TickMark match={t.match} /> : <span className="size-[5px] rounded-full bg-border" aria-hidden="true" />}
                      </span>
                      {t && hover === k ? <Callout t={t} /> : null}
                    </span>
                  );
                })}
                {s.interpretation ? <span className="ml-2 text-[12px] text-muted-foreground">Left for a person</span> : null}
              </p>
            ))}
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
            {page ? <PageView page={page} active={hoveredTick ?? null} label={`Submitted CSR, page ${page.page}`} /> : <EmptyBlock title="No page image">The parsed pages are not available.</EmptyBlock>}
          </div>
        </div>
      </div>

      <Panel className="mt-5 scroll-mt-4" id="wording">
        <header className="flex items-baseline gap-4 border-b border-border px-6 py-3">
          <h2 className="text-[17px] font-semibold">Wording</h2>
          <p className="num text-[15px]">Coverage {data.wording.coverage_score ?? "not scored"}{data.wording.coverage_score === null ? "" : " of 5"}</p>
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
  const c = useAsync(() => getCompare(section), [section]);
  const title = sc.data?.rows.find((r) => r.section === section)?.title ?? '';
  return (
    <div className="w-full max-w-[1760px]">
      {c.loading ? (
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
