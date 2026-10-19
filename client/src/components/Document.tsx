import { Fragment } from 'react';
import { HoverCard, HoverCardContent, HoverCardTrigger, Skeleton } from '@databricks/appkit-ui/react';
import { useCitationDetail } from '../data/queries';
import type { DocumentSectionRow, WordingCheckResult } from '../data/types';
import { formatDateUtc } from '../lib/format';
import { DbxLink } from '../lib/presenter';
import { ErrorNote } from './QueryBoundary';

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
  sourceVersion: number | null;
  flipIndex: Map<string, number>;
  checking: boolean;
  verdict: WordingCheckResult | undefined;
}

export function DocumentSentence({ sentence, recomputed, sourceVersion, flipIndex, checking, verdict }: DocumentSentenceProps) {
  const parts = sentence.template.split(/(\{\w+\})/g);
  const flagged = verdict?.verdict === 'needs_writer';

  const body = parts.map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    if (!m) return <Fragment key={i}>{part}</Fragment>;
    const row = sentence.cites.get(m[1]);
    if (!row) return <Fragment key={i}>{part}</Fragment>;
    return (
      <Figure
        key={i}
        row={row}
        next={recomputed ? (recomputed[row.fig_key] ?? row.value_curr) : null}
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
            <span tabIndex={0} className="cursor-help rounded-[var(--radius)] decoration-attention">
              {text}
              <span className="ml-1.5 inline-block rounded-[var(--radius)] bg-attention-soft px-1.5 align-middle font-sans text-xs font-medium text-attention">
                Needs the writer
              </span>
            </span>
          </HoverCardTrigger>
          <HoverCardContent className="w-80 font-sans text-sm" side="bottom" align="start">
            <p className="text-ink">{verdict.reason}</p>
            <p className="mt-2 text-xs text-ink-muted">
              Wording check, <span className="font-mono">{verdict.model}</span>
              {verdict.cached ? ', cached result' : ''}
            </p>
          </HoverCardContent>
        </HoverCard>
      ) : (
        text
      )}
      {checking && sentence.affected ? (
        <span className="ml-1.5 inline-block rounded-[var(--radius)] border border-border px-1.5 align-middle font-sans text-xs text-ink-muted">
          Checking wording
        </span>
      ) : null}{' '}
    </>
  );
}

function Figure({
  row,
  next,
  order,
  sourceVersion,
}: {
  row: DocumentSectionRow;
  next: string | null;
  order: number;
  sourceVersion: number | null;
}) {
  const changed = row.value_prev !== (next ?? row.value_curr);
  const flipped = next !== null && changed;

  const face = flipped ? (
    <span className="whitespace-nowrap">
      <s
        className="figure-old-out text-unchanged decoration-unchanged"
        style={{ animationDelay: `${order * 260}ms` }}
      >
        {row.value_prev}
      </s>{' '}
      <span
        className="figure-new-in rounded-[2px] px-0.5 font-semibold text-recomputed"
        style={{ animationDelay: `${300 + order * 260}ms` }}
      >
        {next}
      </span>
    </span>
  ) : (
    <span>{next ?? row.value_prev}</span>
  );

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
      <HoverCardContent className="w-96 font-sans" side="bottom" align="start">
        <CitationCard citationId={row.citation_id} sourceVersion={flipped ? sourceVersion : null} />
      </HoverCardContent>
    </HoverCard>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 text-sm">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
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
  return (
    <div className="space-y-3">
      <dl className="space-y-1.5">
        <Field label="Table">
          <span className="font-mono text-xs" title={d.source_table}>
            {table}
          </span>
        </Field>
        <Field label="Row, column">
          <span className="font-mono text-xs">
            {d.row_key}, {d.column_name}
          </span>
        </Field>
        <Field label="Table version">
          {sourceVersion !== null && sourceVersion !== d.table_version ? (
            <>
              {sourceVersion} <span className="text-ink-muted">(cited at {d.table_version})</span>
            </>
          ) : (
            d.table_version
          )}
        </Field>
        <Field label="Certified">
          by {d.certified_by}, {formatDateUtc(d.certified_at)}
        </Field>
      </dl>
      <pre className="whitespace-pre-wrap break-all rounded-[var(--radius)] bg-muted p-2 font-mono text-xs leading-relaxed text-ink">
        {d.query_sql}
      </pre>
      <DbxLink linkKey="beat2" label="Table lineage in Databricks" />
    </div>
  );
}
