import { createContext, Fragment, useContext } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger, Skeleton } from '@databricks/appkit-ui/react';
import { useCitationDetail } from '../data/queries';
import type { DocumentSectionRow, WordingCheckResult } from '../data/types';
import { formatDateUtc } from '../lib/format';
import { DbxLink } from '../lib/presenter';
import { ErrorNote } from './QueryBoundary';

/** The page element, so citation cards stay on the page and never cover the margin. */
export const PageBoundary = createContext<HTMLElement | null>(null);

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
  sourceVersion: number | null;
  flipIndex: Map<string, number>;
  verdict: WordingCheckResult | undefined;
}

export function DocumentSentence({ sentence, recomputed, reserve, sourceVersion, flipIndex, verdict }: DocumentSentenceProps) {
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
        order={flipIndex.get(row.citation_id) ?? 0}
        sourceVersion={sourceVersion}
      />
    );
  });

  const text = <span className={flagged ? 'bg-attention-soft' : undefined}>{body}</span>;

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
  order,
  sourceVersion,
}: {
  row: DocumentSectionRow;
  next: string | null;
  reserve: boolean;
  order: number;
  sourceVersion: number | null;
}) {
  const boundary = useContext(PageBoundary);
  const target = next ?? row.value_curr;
  const changed = row.value_prev !== target;
  const flipped = next !== null && changed;
  /* Old value, a space, new value: reserve that width before the values arrive. */
  const widthCh = row.value_prev.length + 0.5 + row.value_curr.length;

  let face;
  if (changed && (flipped || reserve)) {
    face = (
      <span className="inline-block whitespace-nowrap" style={{ minWidth: `${widthCh}ch` }}>
        <s
          className={flipped ? 'figure-old-out text-unchanged decoration-unchanged' : undefined}
          style={flipped ? { animationDelay: `${order * 260}ms` } : undefined}
        >
          {row.value_prev}
        </s>{' '}
        <span
          className={flipped ? 'figure-new-in rounded-[2px] px-0.5 font-semibold text-recomputed' : 'invisible'}
          style={flipped ? { animationDelay: `${300 + order * 260}ms` } : undefined}
        >
          {flipped ? next : row.value_curr}
        </span>
      </span>
    );
  } else {
    face = <span>{next ?? row.value_prev}</span>;
  }
  /* The reserved, not yet flipped state shows the old value as plain text, not struck through. */
  if (changed && reserve && !flipped) {
    face = (
      <span className="inline-block whitespace-nowrap" style={{ minWidth: `${widthCh}ch` }}>
        {row.value_prev}
      </span>
    );
  }

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <span
          tabIndex={0}
          className="cursor-help border-b border-cited decoration-cited hover:bg-cited-soft focus-visible:bg-cited-soft"
        >
          {face}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        className="w-[22rem] font-sans"
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
function CitationCard({ citationId, sourceVersion }: { citationId: string; sourceVersion: number | null }) {
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
  const table = d.source_table.split('.').pop() ?? d.source_table;
  const version = sourceVersion ?? d.table_version;
  return (
    <div className="space-y-2.5">
      <h3 className="text-sm font-semibold text-ink">
        <span className="font-mono text-[0.95em]">{table}</span>, version {version}
      </h3>
      <p className="text-sm text-ink-muted">
        Row <span className="font-mono text-xs text-ink">{d.row_key}</span>, column{' '}
        <span className="font-mono text-xs text-ink">{d.column_name}</span>
      </p>
      <p className="text-sm text-ink">
        Certified by {d.certified_by}, {formatDateUtc(d.certified_at)}
      </p>
      <pre className="whitespace-pre-wrap break-all rounded-[var(--radius)] bg-muted p-2 font-mono text-xs leading-relaxed text-ink">
        {d.query_sql}
      </pre>
      <DbxLink linkKey="beat2" label="Table lineage in Databricks" />
    </div>
  );
}
