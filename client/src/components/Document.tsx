import { createContext, Fragment, useContext } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger, Skeleton } from '@databricks/appkit-ui/react';
import { useCitationDetail } from '../data/queries';
import type { DocumentSectionRow, WordingCheckResult } from '../data/types';
import { formatDateUtc, tlfName } from '../lib/format';
import { DbxLink } from '../lib/presenter';
import { ErrorNote } from './QueryBoundary';

/** The page element, so citation cards stay on the page and never cover the margin. */
export const PageBoundary = createContext<HTMLElement | null>(null);

/** Tick and tie: the figure under the pointer, shared by the document page and the TLF page. */
export const FigureFocus = createContext<{ focus: string | null; setFocus: (k: string | null) => void }>({
  focus: null,
  setFocus: () => undefined,
});

export interface SentenceModel {
  sentenceId: string;
  seq: number;
  template: string;
  affected: boolean;
  cites: Map<string, DocumentSectionRow>;
}

export function toSentences(rows: DocumentSectionRow[]): SentenceModel[] {
  const m = new Map<string, SentenceModel>();
  for (const r of rows) {
    const s = m.get(r.sentence_id) ?? {
      sentenceId: r.sentence_id,
      seq: r.seq,
      template: r.template,
      affected: false,
      cites: new Map<string, DocumentSectionRow>(),
    };
    if (r.fig_key) s.cites.set(r.fig_key, r);
    s.affected = s.affected || r.affected;
    m.set(r.sentence_id, s);
  }
  return [...m.values()].sort((a, b) => a.seq - b.seq);
}

/** Template with placeholders resolved to the given values (used for quotes in the margin). */
export function sentenceText(s: SentenceModel, values: Record<string, string>): string {
  return s.template.replace(/\{(\w+)\}/g, (_m, k: string) => values[k] ?? s.cites.get(k)?.value_curr ?? '');
}

interface DocumentSentenceProps {
  sentence: SentenceModel;
  recomputed: Record<string, string> | null;
  /** True from the click on "Recompute from source": figure widths are reserved so nothing jumps. */
  reserve: boolean;
  animate: boolean;
  sourceVersion: number | null;
  flipIndex: Map<string, number>;
  verdict: WordingCheckResult | undefined;
  /** The finding open in the viewer. */
  current?: boolean;
}

export function DocumentSentence({ sentence, recomputed, reserve, animate, sourceVersion, flipIndex, verdict, current }: DocumentSentenceProps) {
  const parts = sentence.template.split(/(\{\w+\})/g);
  const flagged = verdict?.verdict === 'needs_writer';

  const body = parts.map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    const row = m ? sentence.cites.get(m[1]) : undefined;
    if (!row) return <Fragment key={`${sentence.sentenceId}-${i}`}>{part}</Fragment>;
    return (
      <Figure
        key={`${sentence.sentenceId}-${row.citation_id}`}
        row={row}
        next={recomputed ? (recomputed[row.fig_key] ?? row.value_curr) : null}
        reserve={reserve}
        animate={animate}
        order={flipIndex.get(row.citation_id) ?? 0}
        sourceVersion={sourceVersion}
      />
    );
  });

  const text = (
    <span
      id={`s-${sentence.sentenceId}`}
      className={`box-decoration-clone ${flagged ? 'bg-attention-soft' : current ? 'bg-cited-soft/70' : ''}`}
    >
      {body}
    </span>
  );

  return (
    <>
      {flagged && verdict ? (
        <HoverCard openDelay={100}>
          <HoverCardTrigger asChild>
            <span tabIndex={0} className="cursor-help rounded-[var(--radius)]">
              {text}
              <span className="ml-1.5 inline-block rounded-[var(--radius)] bg-attention-soft px-1.5 align-middle font-sans text-xs font-medium text-attention">
                With the writer
              </span>
            </span>
          </HoverCardTrigger>
          <HoverCardContent className="w-80 font-sans text-sm" side="bottom" align="start">
            <p className="text-ink">{verdict.reason}</p>
            <p className="mt-2 text-xs text-ink-muted">Wording check{verdict.cached ? ', cached result' : ''}</p>
          </HoverCardContent>
        </HoverCard>
      ) : (
        text
      )}{' '}
    </>
  );
}

function Figure({
  row,
  next,
  reserve,
  animate,
  order,
  sourceVersion,
}: {
  row: DocumentSectionRow;
  next: string | null;
  reserve: boolean;
  animate: boolean;
  order: number;
  sourceVersion: number | null;
}) {
  const boundary = useContext(PageBoundary);
  const { focus, setFocus } = useContext(FigureFocus);
  const target = next ?? row.value_curr;
  const changed = row.value_prev !== target;
  const flipped = next !== null && changed;
  /* Old and new are both in the layout from the click, so the flip never moves the text. */
  const pending = changed && reserve && animate && !flipped;

  let face;
  if (changed && (flipped || reserve)) {
    face = (
      <span className="whitespace-nowrap">
        <s
          className={
            flipped
              ? `${animate ? 'figure-old-out ' : ''}text-unchanged decoration-unchanged`
              : 'border-b border-cited no-underline'
          }
          style={flipped ? (animate ? { animationDelay: `${order * 260}ms` } : undefined) : { textDecoration: 'none' }}
        >
          {row.value_prev}
        </s>
        <span
          className={flipped ? `${animate ? 'figure-new-in ' : ''}font-semibold text-recomputed` : 'invisible'}
          style={flipped && animate ? { animationDelay: `${order * 260}ms` } : undefined}
        >
          {' '}
          {flipped ? next : row.value_curr}
        </span>
      </span>
    );
  } else {
    face = <span>{next ?? row.value_prev}</span>;
  }

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span
          tabIndex={0}
          onMouseEnter={() => setFocus(row.fig_key)}
          onMouseLeave={() => setFocus(null)}
          onFocus={() => setFocus(row.fig_key)}
          onBlur={() => setFocus(null)}
          className={`cursor-help border-b decoration-cited hover:bg-cited-soft focus-visible:bg-cited-soft ${focus === row.fig_key ? 'bg-cited-soft' : ''} ${pending ? 'border-transparent' : 'border-cited'}`}
        >
          {face}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        className="w-[20rem] font-sans"
        side="bottom"
        align="start"
        collisionBoundary={boundary ?? undefined}
        collisionPadding={12}
      >
        <CitationCard citationId={row.citation_id} sourceVersion={sourceVersion} />
      </HoverCardContent>
    </HoverCard>
  );
}

/* Mounted only while the hover card is open, so it queries on demand. */
export function CitationCard({ citationId, sourceVersion }: { citationId: string; sourceVersion: number | null }) {
  const q = useCitationDetail(citationId);

  if (q.loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }
  if (q.error) return <ErrorNote title="The citation could not be read." detail={q.error} />;
  const d = q.data?.[0];
  if (!d) {
    return (
      <p className="text-sm text-ink-muted">
        This figure has no citation record, so it is not tied to a certified table.
      </p>
    );
  }
  const version = sourceVersion ?? d.table_version;
  return (
    <div className="space-y-2.5">
      <h3 className="text-sm font-semibold text-ink">
        {tlfName(d.source_table)}, version {version}
      </h3>
      <p className="text-sm text-ink-muted">
        Row {d.row_key}, column {d.column_name}
      </p>
      <p className="text-sm text-ink">
        Validated and released by {d.certified_by}, {formatDateUtc(d.certified_at)}
      </p>
      <details>
        <summary className="cursor-pointer text-xs text-cited underline underline-offset-4">Show query</summary>
        <pre className="mt-1.5 whitespace-pre-wrap break-all rounded-[var(--radius)] bg-muted p-2 font-mono text-xs leading-relaxed text-ink">
          {d.query_sql}
        </pre>
      </details>
      <DbxLink linkKey="beat2" label="Table lineage in Databricks" />
    </div>
  );
}

/** Old figure struck through, new figure after it. Used in the QC log, where the flip happens. */
export function FlipPair({ prev, next, order, animate }: { prev: string; next: string | null; order: number; animate: boolean }) {
  if (next === null || next === prev) return <span>{prev}</span>;
  return (
    <span className="whitespace-nowrap">
      <s
        className={`${animate ? 'figure-old-out ' : ''}text-unchanged`}
        style={animate ? { animationDelay: `${order * 200}ms` } : undefined}
      >
        {prev}
      </s>{' '}
      <span
        className={`${animate ? 'figure-new-in ' : ''}font-semibold text-recomputed`}
        style={animate ? { animationDelay: `${order * 200}ms` } : undefined}
      >
        {next}
      </span>
    </span>
  );
}
