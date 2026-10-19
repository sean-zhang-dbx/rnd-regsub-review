import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { postSearchUntracked } from '../data/api';
import { useReview } from '../data/review';
import { useRestatementSummary, useUnchangedSentences } from '../data/queries';
import type { ImpactRow, UnchangedRow, UntrackedHit } from '../data/types';
import { FlipPair } from '../components/Document';
import { ErrorNote, QueryBoundary } from '../components/QueryBoundary';
import {
  docLabel,
  FIG_CELL,
  formatClock,
  formatClockUtc,
  formatDateUtc,
  TLF,
  tlfName,
} from '../lib/format';
import { DbxLink } from '../lib/presenter';
import { useAsync } from '../lib/useAsync';

export function Overview() {
  const summary = useRestatementSummary();
  const unchanged = useUnchangedSentences();
  const review = useReview();
  const done = review.phase === 'done';
  const oldValues = [...new Set(review.impact.rows.map((r) => r.old_value))];

  return (
    <div className="mx-auto max-w-6xl px-6 py-6 md:px-10">
      <div className="rounded-[var(--radius-page)] bg-page px-8 py-6 shadow-page">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-h-[3.25rem] max-w-3xl">
            <QueryBoundary
              query={summary}
              skeleton={
                <p className="text-lg font-semibold text-ink-muted">
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
                  <h1 className="text-lg font-semibold leading-snug text-ink">
                    {tlfName(s.table_name)} re-delivered by {s.restated_by}, version {s.prev_version} to{' '}
                    {s.curr_version}, {formatDateUtc(s.restated_at)} {formatClockUtc(s.restated_at)}
                  </h1>
                );
              }}
            </QueryBoundary>
            <p className="mt-1 text-sm text-ink-muted">Numerical QC log for {`LMN-301`}</p>
            <div className="mt-1">
              <DbxLink linkKey="beat1" label="Table history in Databricks" />
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button size="lg" onClick={review.start} disabled={review.phase === 'recomputing' || done}>
              {review.phase === 'recomputing'
                ? 'Recomputing from source'
                : done
                  ? `Recomputed from version ${review.sourceVersion ?? ''}`.trim()
                  : review.phase === 'failed'
                    ? 'Recompute again'
                    : 'Recompute from version 4'}
            </Button>
          </div>
        </header>

        {review.phase === 'failed' ? (
          <div className="mt-3">
            <ErrorNote title="The figures could not be recomputed from source." detail={review.failure} />
          </div>
        ) : null}

        <section aria-label="Numerical QC log" className="mt-4">
          {review.impact.loading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : review.impact.error ? (
            <ErrorNote title="The QC log could not be built." detail={review.impact.error} />
          ) : review.affected.length === 0 ? (
            <p className="py-6 text-ink-muted">No sentence cites a figure that changed between the two versions.</p>
          ) : (
            <QcTable />
          )}
        </section>

        <Unchanged q={unchanged} />
      </div>

      {review.impact.rows.length > 0 ? <Untracked oldValues={oldValues} /> : null}
    </div>
  );
}

const TH = 'border-b border-ink/30 px-2 py-2 text-left text-xs font-semibold text-ink-muted';
const TD = 'px-2 py-2 align-top';

function QcTable() {
  const review = useReview();
  const navigate = useNavigate();
  const done = review.phase === 'done';
  const approved = review.approved !== null;

  const order = Object.keys(FIG_CELL);
  const figsOf = (id: string) =>
    review.impact.rows
      .filter((r) => r.sentence_id === id)
      .sort((a, b) => order.indexOf(a.fig_key) - order.indexOf(b.fig_key));

  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className={TH}>Location</th>
          <th className={TH}>Text says</th>
          <th className={TH}>Source cell</th>
          <th className={TH}>Finding</th>
          <th className={TH}>Owner</th>
          <th className={TH}>Status</th>
        </tr>
      </thead>
      <tbody>
        {review.affected.map((r) => (
          <QcRow
            key={r.sentence_id}
            row={r}
            figs={figsOf(r.sentence_id)}
            done={done}
            approved={approved}
            onOpen={() => void navigate(`/section/${r.section}`)}
          />
        ))}
      </tbody>
    </table>
  );
}

function QcRow({
  row,
  figs,
  done,
  approved,
  onOpen,
}: {
  row: ImpactRow;
  figs: ImpactRow[];
  done: boolean;
  approved: boolean;
  onOpen: () => void;
}) {
  const review = useReview();
  const verdict = review.verdicts.get(row.sentence_id);
  const flagged = done && verdict?.verdict === 'needs_writer';
  const checking = done && row.kind === 'prose' && review.wording.loading;

  const first = figs[0];
  const cell = first ? FIG_CELL[first.fig_key] : undefined;
  const source = cell ? `${TLF.efficacy_primary}, ${cell.row}, ${cell.column}` : TLF.efficacy_primary;

  let finding = 'Value changed';
  if (row.kind === 'label') finding = 'Label text';
  if (flagged) finding = 'Wording may not hold';

  let status = 'Open';
  let statusClass = 'text-ink-muted';
  if (row.kind === 'label') {
    if (done) {
      status = 'Sent to Labelling';
      statusClass = 'text-attention';
    }
  } else if (row.kind === 'prose') {
    if (checking) status = 'Checking wording';
    else if (flagged) {
      status = 'With the writer';
      statusClass = 'text-attention';
    } else if (done) {
      status = 'Recomputed';
      statusClass = 'text-recomputed';
    }
  } else if (approved) {
    status = 'Approved';
    statusClass = 'text-recomputed';
  } else if (done) {
    status = 'Recomputed';
    statusClass = 'text-recomputed';
  }

  return (
    <tr
      className={`cursor-pointer border-b border-border hover:bg-cited-soft ${flagged ? 'bg-attention-soft' : ''}`}
      onClick={onOpen}
    >
      <td className={`${TD} whitespace-nowrap`}>
        <Link
          to={`/section/${row.section}`}
          className="text-cited underline underline-offset-4"
          onClick={(e) => e.stopPropagation()}
        >
          {docLabel(row.doc_type, row.section)}, sentence {row.seq}
        </Link>
      </td>
      <td className={TD}>
        {figs.map((f, i) => (
          <span key={f.fig_key}>
            {i > 0 ? ', ' : ''}
            <FlipPair
              prev={f.old_value}
              next={done ? (review.values?.[f.fig_key] ?? f.new_value) : null}
              order={i}
              animate={review.animated}
            />
          </span>
        ))}
      </td>
      <td className={`${TD} text-ink-muted`}>
        {source}
        {figs.length > 1 ? ` +${figs.length - 1}` : ''}
      </td>
      <td className={TD}>
        <span className={flagged ? 'font-medium text-attention' : undefined}>{finding}</span>
        {flagged && verdict ? <p className="mt-1 max-w-xs text-[13px] leading-snug text-ink">{verdict.reason}</p> : null}
      </td>
      <td className={TD}>{row.kind === 'label' ? 'Labelling' : 'Writer'}</td>
      <td className={`${TD} whitespace-nowrap ${statusClass}`}>{status}</td>
    </tr>
  );
}

function Unchanged({ q }: { q: { data: UnchangedRow[] | null; loading: boolean; error: string | null } }) {
  const [open, setOpen] = useState(false);

  if (q.loading) return <Skeleton className="mt-4 h-6 w-3/5" />;
  if (q.error) return <ErrorNote title="The unchanged sentences could not be listed." detail={q.error} />;
  if (!q.data || q.data.length === 0) return <p className="mt-4 text-sm text-ink-muted">No sentences cite Table 14.3.1.</p>;

  const places = [...new Set(q.data.map((u) => docLabel(u.doc_type, u.section)))];
  return (
    <div className="mt-4 text-sm text-unchanged">
      <p>
        Safety text citing {tlfName('safety_overview')}: no change{' '}
        <Button
          variant="link"
          className="h-auto p-0 align-baseline text-cited"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Show'}
        </Button>
      </p>
      {open ? <p className="mt-1">{places.join(', ')}</p> : null}
    </div>
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
