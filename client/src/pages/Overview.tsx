import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { postSearchUntracked } from '../data/api';
import { useReview } from '../data/review';
import { useImpactList, useRestatementSummary, useUnchangedSentences } from '../data/queries';
import type { ImpactRow, UnchangedRow, UntrackedHit } from '../data/types';
import { ErrorNote, QueryBoundary } from '../components/QueryBoundary';
import type { QueryState } from '../components/QueryBoundary';
import { docLabel, formatClockUtc, formatDateUtc, formatClock } from '../lib/format';
import { DbxLink } from '../lib/presenter';
import { useAsync } from '../lib/useAsync';

interface BarState {
  bar: string;
  tag: string;
  tagClass: string;
}

const CITED: BarState = { bar: 'bg-cited-soft border-cited', tag: 'Can be recomputed', tagClass: 'text-cited' };
const GREEN = (tag: string): BarState => ({ bar: 'bg-recomputed-soft border-recomputed', tag, tagClass: 'text-recomputed' });
const AMBER = (tag: string): BarState => ({ bar: 'bg-attention-soft border-attention', tag, tagClass: 'text-attention' });

interface Stage {
  recomputed: boolean;
  approved: boolean;
  withWriter: boolean;
}

function stateOf(kind: string, st: Stage): BarState {
  if (kind === 'label') return AMBER(st.recomputed ? 'Sent to Labelling' : 'Goes to Labelling');
  if (kind === 'prose') return AMBER(st.withWriter ? 'With the writer' : 'May need the writer');
  if (st.approved) return GREEN('Approved');
  return st.recomputed ? GREEN('Recomputed') : CITED;
}

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
  const unchanged = useUnchangedSentences();
  const review = useReview();

  return (
    <div className="mx-auto max-w-5xl px-6 py-10 md:px-10">
      <section aria-label="Restatement" className="max-w-3xl">
        <QueryBoundary
          query={summary}
          skeleton={
            <p className="min-h-[3.75rem] text-2xl font-medium leading-snug text-ink-muted">
              Reading the restatement from <span className="font-mono text-[0.9em]">efficacy_primary</span>...
            </p>
          }
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
          ) : review.loading ? (
            <Skeleton className="h-6 w-full" />
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
          {(rows) => <MiniPages rows={bySentence(rows)} unchanged={unchanged.data ?? []} />}
        </QueryBoundary>
      </section>

      <Unchanged q={unchanged} />

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

/* Names the documents rather than counting them; the mini pages below show the sentences. */
function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function ImpactSentence({ rows }: { rows: ImpactRow[] }) {
  const review = useReview();
  const order: string[] = ['csr', 'm27', 'm25', 'label'];
  const places = [...new Map(rows.map((r) => [`${r.doc_type}:${r.section}`, r])).values()]
    .sort((a, b) => order.indexOf(a.doc_type) - order.indexOf(b.doc_type))
    .map((r) => (r.doc_type === 'label' ? 'the label' : docLabel(r.doc_type, r.section)));
  const prose = rows.find((r) => r.kind === 'prose');
  const writerLine = prose
    ? ` The writer has a sentence in ${docLabel(prose.doc_type, prose.section)} whose wording may no longer hold.`
    : '';

  if (!review.recomputed) {
    return <p>The changed figures appear in {joinNames(places)}.</p>;
  }
  return (
    <p>
      {review.approved
        ? 'The recomputed figures are approved.'
        : 'The recomputed figures are waiting for your approval.'}{' '}
      Labelling has the label sentence.
      {review.withWriter ? writerLine : ' The wording is being checked against the new figures.'}
    </p>
  );
}

function MiniPages({ rows, unchanged }: { rows: ImpactRow[]; unchanged: UnchangedRow[] }) {
  const review = useReview();
  const stage: Stage = { recomputed: review.recomputed, approved: review.approved !== null, withWriter: review.withWriter };
  const order: string[] = ['csr', 'm27', 'm25', 'label'];
  const groups = useMemo(() => {
    const m = new Map<string, ImpactRow[]>();
    for (const r of rows) {
      const k = `${r.doc_type}:${r.section}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.values()].sort((a, b) => order.indexOf(a[0].doc_type) - order.indexOf(b[0].doc_type));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  const unchangedIn = (r: ImpactRow) =>
    unchanged.filter((u) => u.doc_type === r.doc_type && u.section === r.section);

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
              {g.map((r) => {
                const bar = stateOf(r.kind, stage);
                return (
                <li key={r.sentence_id}>
                  <div
                    className={`h-2.5 border-l-2 ${bar.bar}`}
                    style={{ width: barWidth(r.seq) }}
                    aria-hidden="true"
                  />
                  <div className={`mt-1 text-xs ${bar.tagClass}`}>
                    {bar.tag}
                  </div>
                </li>
                );
              })}
              {unchangedIn(first).map((u, i) => (
                <li key={u.sentence_id}>
                  <div
                    className="h-2.5 border-l-2 border-unchanged bg-muted"
                    style={{ width: barWidth(i + 3) }}
                    aria-hidden="true"
                  />
                </li>
              ))}
            </ul>
            {unchangedIn(first).length > 0 ? (
              <div className="text-xs text-unchanged">
                Safety sentences unchanged
              </div>
            ) : null}
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

function Unchanged({ q }: { q: QueryState<UnchangedRow> }) {
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
            Safety sentences cite other tables and are unchanged.{' '}
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
            {docLabel(g[0].doc_type, g[0].section)}
          </span>
          <span className="font-mono text-xs">{g[0].source_table}</span>
        </li>
      ))}
    </ul>
  );
}

/* Snippets arrive cut mid-word and sometimes with their own dots; start and end on whole words. */
function trimSnippet(snippet: string): string {
  const t = snippet.replace(/^[.\s…]+|[.\s…]+$/g, '');
  const start = /^\S*\s/.exec(t)?.[0].length ?? 0;
  const end = t.lastIndexOf(' ');
  return t.slice(start, end > start ? end : undefined);
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
  const review = useReview();
  const [notifying, setNotifying] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);

  async function notify(paths: string[]) {
    setNotifying(true);
    setNotifyError(null);
    try {
      await review.record(paths, 'notified_owner');
    } catch (e) {
      setNotifyError(e instanceof Error ? e.message : 'The request failed.');
    } finally {
      setNotifying(false);
    }
  }

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
            AI Search found the old result quoted in documents outside the dossier.
          </p>
          <ul className="mt-3 space-y-3">
            {docs.map(([title, hits]) => (
              <li key={title} className="rounded-[var(--radius-page)] bg-page p-4 shadow-page">
                <div className="text-sm font-semibold text-ink">{title}</div>
                {hits.map((h) => (
                  <div key={`${h.file_path}:${h.page}`} className="mt-2 border-l-2 border-border pl-3">
                    <div className="text-xs text-ink-muted">Page {h.page}</div>
                    <p className="font-serif text-[15px] leading-relaxed text-ink">
                      ...{highlight(trimSnippet(h.snippet), oldValues)}...
                    </p>
                  </div>
                ))}
              </li>
            ))}
          </ul>
          {notifyError ? (
            <div className="mt-3">
              <ErrorNote title="Owners were not notified." detail={notifyError} />
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-4">
            {review.notified ? (
              <p className="text-sm font-medium text-recomputed">
                Owners notified at {formatClock(review.notified.at)}.
              </p>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={notifying}
                onClick={() => void notify([...new Set((search.data ?? []).map((h) => h.file_path))])}
              >
                {notifying ? 'Notifying owners' : 'Notify owners'}
              </Button>
            )}
            <p className="text-sm text-ink-muted">Nothing outside the dossier is rewritten.</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <DbxLink linkKey="beat1_search" label="AI Search index in Databricks" />
            <DbxLink linkKey="beat1_volume" label="Source documents volume in Databricks" />
          </div>
        </>
      )}
    </section>
  );
}
