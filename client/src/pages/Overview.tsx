import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { postSearchUntracked } from '../data/api';
import { useImpactList, useRestatementSummary, useUnchangedSentences } from '../data/queries';
import type { ImpactKind, ImpactRow, UnchangedRow, UntrackedHit } from '../data/types';
import { ErrorNote, QueryBoundary } from '../components/QueryBoundary';
import { docLabel, formatClockUtc, formatDateUtc, plural } from '../lib/format';
import { DbxLink } from '../lib/presenter';
import { useAsync } from '../lib/useAsync';

const KIND_STYLE: Record<ImpactKind, { bar: string; tag: string }> = {
  figure: { bar: 'bg-recomputed-soft border-recomputed', tag: 'Recomputed' },
  prose: { bar: 'bg-attention-soft border-attention', tag: 'Needs the writer' },
  label: { bar: 'bg-attention-soft border-attention', tag: 'Sent to Labelling' },
};

/* Sentences, deduplicated: the query may return one row per cited figure. */
function bySentence(rows: ImpactRow[]): ImpactRow[] {
  const seen = new Map<string, ImpactRow>();
  for (const r of rows) if (!seen.has(r.sentence_id)) seen.set(r.sentence_id, r);
  return [...seen.values()].sort((a, b) => a.seq - b.seq);
}

function barWidth(seq: number): string {
  return `${62 + ((seq * 23) % 36)}%`;
}

export function Overview() {
  const summary = useRestatementSummary();
  const impact = useImpactList();

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 md:px-10">
      <section aria-label="Restatement" className="max-w-3xl">
        <QueryBoundary
          query={summary}
          skeleton={<Skeleton className="h-8 w-4/5" />}
          failed="The restatement could not be read."
          emptyTitle="No restatement found"
          emptyHint="The certified table has a single version, so nothing needs review."
        >
          {(rows) => {
            const s = rows[0];
            return (
              <h1 className="text-2xl font-medium leading-snug text-ink">
                <span className="font-mono text-[0.9em]">{s.table_name}</span> was restated by {s.restated_by} at{' '}
                {formatClockUtc(s.restated_at)} on {formatDateUtc(s.restated_at)} (version {s.prev_version} to{' '}
                {s.curr_version}).
              </h1>
            );
          }}
        </QueryBoundary>

        <div className="mt-3 text-lg leading-relaxed text-ink">
          {impact.loading ? (
            <div className="space-y-2">
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-2/3" />
            </div>
          ) : impact.error ? (
            <ErrorNote title="The affected sentences could not be listed." detail={impact.error} />
          ) : (
            <ImpactSentence rows={bySentence(impact.data ?? [])} />
          )}
        </div>
        <div className="mt-2">
          <DbxLink linkKey="beat1" label="Table history in Databricks" />
        </div>
      </section>

      <section aria-label="Affected documents" className="mt-8">
        <QueryBoundary
          query={impact}
          skeleton={
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-52 rounded-[var(--radius-page)]" />
              ))}
            </div>
          }
          failed="The affected documents could not be shown."
          emptyTitle="No sentences are affected"
          emptyHint="No cited figure changed between the two table versions."
        >
          {(rows) => <MiniPages rows={bySentence(rows)} />}
        </QueryBoundary>
      </section>

      <Unchanged />

      {impact.data && impact.data.length > 0 ? (
        <Untracked oldValues={[...new Set(impact.data.map((r) => r.old_value))]} />
      ) : null}

      <div className="mt-10 flex justify-end">
        <Button asChild size="lg">
          <Link to="/section/11.4.1">Open CSR 11.4.1</Link>
        </Button>
      </div>
    </div>
  );
}

function ImpactSentence({ rows }: { rows: ImpactRow[] }) {
  const sections = new Set(rows.map((r) => `${r.doc_type}:${r.section}`)).size;
  const figures = rows.filter((r) => r.kind === 'figure').length;
  const writer = rows.filter((r) => r.kind === 'prose').length;
  const labelling = rows.filter((r) => r.kind === 'label').length;
  return (
    <p>
      {plural(rows.length, 'sentence', 'sentences')} in {plural(sections, 'section', 'sections')} use the changed
      figures. {figures} {figures === 1 ? 'is' : 'are'} recomputed and waiting for approval, {writer}{' '}
      {writer === 1 ? 'needs' : 'need'} the writer, and {labelling} {labelling === 1 ? 'has' : 'have'} been sent to
      Labelling.
    </p>
  );
}

function MiniPages({ rows }: { rows: ImpactRow[] }) {
  const order: ImpactRow['doc_type'][] = ['csr', 'm27', 'm25', 'label'];
  const groups = useMemo(() => {
    const m = new Map<string, ImpactRow[]>();
    for (const r of rows) {
      const k = `${r.doc_type}:${r.section}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.values()].sort((a, b) => order.indexOf(a[0].doc_type) - order.indexOf(b[0].doc_type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {groups.map((g) => {
        const first = g[0];
        const isCsr = first.doc_type === 'csr';
        const page = (
          <div className="flex h-full min-h-52 flex-col gap-3 rounded-[var(--radius-page)] bg-page p-4 shadow-page">
            <div>
              <div className="text-sm font-semibold text-ink">{docLabel(first.doc_type, first.section)}</div>
              <div className="text-xs text-ink-muted">{first.section_title}</div>
            </div>
            <ul className="flex flex-1 flex-col gap-2.5">
              {g.map((r) => (
                <li key={r.sentence_id}>
                  <div
                    className={`h-2.5 border-l-2 ${KIND_STYLE[r.kind].bar}`}
                    style={{ width: barWidth(r.seq) }}
                    aria-hidden="true"
                  />
                  <div className={`mt-1 text-xs ${r.kind === 'figure' ? 'text-recomputed' : 'text-attention'}`}>
                    {KIND_STYLE[r.kind].tag}
                  </div>
                </li>
              ))}
            </ul>
            <div className="text-xs text-ink-muted">{plural(g.length, 'sentence', 'sentences')}</div>
          </div>
        );
        return (
          <li key={`${first.doc_type}:${first.section}`}>
            {isCsr ? (
              <Link
                to={`/section/${first.section}`}
                className="block h-full rounded-[var(--radius-page)] transition-shadow hover:ring-2 hover:ring-cited"
                aria-label={`Open ${docLabel(first.doc_type, first.section)}`}
              >
                {page}
              </Link>
            ) : (
              page
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Unchanged() {
  const q = useUnchangedSentences();
  const [open, setOpen] = useState(false);

  return (
    <section aria-label="Unchanged sentences" className="mt-8 max-w-3xl">
      {q.loading ? (
        <Skeleton className="h-6 w-3/5" />
      ) : q.error ? (
        <ErrorNote title="The unchanged sentences could not be listed." detail={q.error} />
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-ink-muted">No sentences are listed as unchanged.</p>
      ) : (
        <>
          <p className="text-unchanged">
            {plural(q.data.length, 'safety sentence', 'safety sentences')} cite other tables and{' '}
            {q.data.length === 1 ? 'is' : 'are'} unchanged.{' '}
            <Button
              variant="link"
              className="h-auto p-0 align-baseline text-cited"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {open ? 'Hide' : 'Show'}
            </Button>
          </p>
          {open ? <UnchangedList rows={q.data} /> : null}
        </>
      )}
    </section>
  );
}

function UnchangedList({ rows }: { rows: UnchangedRow[] }) {
  const groups = new Map<string, UnchangedRow[]>();
  for (const r of rows) {
    const k = `${r.doc_type}:${r.section}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return (
    <ul className="mt-2 divide-y divide-border rounded-[var(--radius)] bg-page/60 text-sm text-unchanged">
      {[...groups.values()].map((g) => (
        <li key={`${g[0].doc_type}:${g[0].section}`} className="flex items-baseline justify-between px-3 py-2">
          <span>
            {docLabel(g[0].doc_type, g[0].section)}, {plural(g.length, 'sentence', 'sentences')}
          </span>
          <span className="font-mono text-xs">{g[0].source_table}</span>
        </li>
      ))}
    </ul>
  );
}

function highlight(snippet: string, olds: string[]) {
  const terms = olds.flatMap((o) => o.split(/[()]/).map((t) => t.trim())).filter((t) => t.length > 2);
  const pattern = new RegExp(`(${[...terms, 'two-thirds'].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return snippet.split(pattern).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-attention-soft px-0.5 text-ink">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function Untracked({ oldValues }: { oldValues: string[] }) {
  const search = useAsync(() => postSearchUntracked(oldValues));
  const [notified, setNotified] = useState(false);

  const docs = useMemo(() => {
    const m = new Map<string, UntrackedHit[]>();
    for (const h of search.data ?? []) m.set(h.doc_title, [...(m.get(h.doc_title) ?? []), h]);
    return [...m.entries()];
  }, [search.data]);

  return (
    <section aria-label="Documents outside the dossier" className="mt-10 max-w-3xl">
      {search.loading ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-4/5" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : search.error ? (
        <div className="space-y-2">
          <ErrorNote title="The search outside the dossier did not finish." detail={search.error} />
          <Button variant="outline" size="sm" onClick={search.retry}>
            Search again
          </Button>
        </div>
      ) : docs.length === 0 ? (
        <p className="text-ink-muted">
          AI Search found no document outside the dossier that still quotes the old result.
        </p>
      ) : (
        <>
          <p className="text-lg leading-relaxed text-ink">
            Outside the dossier, AI Search found {plural(docs.length, 'document', 'documents')} that still{' '}
            {docs.length === 1 ? 'quotes' : 'quote'} the old result.
          </p>
          <ul className="mt-3 space-y-3">
            {docs.map(([title, hits]) => (
              <li key={title} className="rounded-[var(--radius-page)] bg-page p-4 shadow-page">
                <div className="text-sm font-semibold text-ink">{title}</div>
                {hits.map((h) => (
                  <div key={`${h.file_path}:${h.page}`} className="mt-2 border-l-2 border-border pl-3">
                    <div className="text-xs text-ink-muted">Page {h.page}</div>
                    <p className="font-serif text-[15px] leading-relaxed text-ink">
                      ...{highlight(h.snippet, oldValues)}...
                    </p>
                  </div>
                ))}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center gap-4">
            <Button variant="outline" size="sm" disabled={notified} onClick={() => setNotified(true)}>
              {notified ? 'Owners notified' : 'Notify owners'}
            </Button>
            <p className="text-sm text-ink-muted">Nothing outside the dossier is rewritten.</p>
          </div>
          <div className="mt-2">
            <DbxLink linkKey="beat1_search" label="AI Search index in Databricks" />
          </div>
        </>
      )}
    </section>
  );
}
