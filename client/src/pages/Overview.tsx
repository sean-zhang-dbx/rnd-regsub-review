import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Search } from 'lucide-react';
import { postSearchUntracked } from '../data/api';
import { useReview } from '../data/review';
import { useRestatementSummary, useUnchangedSentences } from '../data/queries';
import type { ImpactRow, UnchangedRow, UntrackedHit } from '../data/types';
import { FlipPair } from '../components/Document';
import { RecomputeButton } from '../components/RecomputeButton';
import { ErrorNote, QueryBoundary } from '../components/QueryBoundary';
import {
  CELL_LABEL,
  docLabel,
  docMeta,
  FIG_CELL,
  FIG_LABEL,
  formatClock,
  formatClockUtc,
  formatDateUtc,
  SEQUENCE,
  STUDY,
  TLF,
  tlfName,
} from '../lib/format';
import { DbxLink } from '../lib/presenter';
import { StatusPill, useStatusOf } from '../lib/status';
import type { QcStatus } from '../lib/status';

/* AI Search over the reference documents. The search box in the bar sets `q`; otherwise the old values. */
function useReferenceSearch(terms: string[]) {
  const key = JSON.stringify(terms);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ data: UntrackedHit[] | null; loading: boolean; error: string | null }>({
    data: null,
    loading: terms.length > 0,
    error: null,
  });
  useEffect(() => {
    if (terms.length === 0) return;
    let live = true;
    setState({ data: null, loading: true, error: null });
    postSearchUntracked(terms).then(
      (data) => live && setState({ data, loading: false, error: null }),
      (e: unknown) =>
        live && setState({ data: null, loading: false, error: e instanceof Error ? e.message : 'The request failed.' }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}
type ReferenceSearch = ReturnType<typeof useReferenceSearch>;

export function Overview() {
  const review = useReview();
  const [params] = useSearchParams();
  const location = useLocation();
  const typed = params.get('q')?.trim() ?? '';
  const oldValues = useMemo(() => [...new Set(review.impact.rows.map((r) => r.old_value))], [review.impact.rows]);
  const search = useReferenceSearch(typed ? [typed] : oldValues);

  useEffect(() => {
    if (location.hash === '#reference') document.getElementById('reference')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [location.hash, location.search, search.data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-page px-5 text-sm">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-ink-muted">
          <span>{STUDY}</span>
          <ChevronRight className="size-3.5" aria-hidden="true" />
          <span>{SEQUENCE}, original application</span>
          <ChevronRight className="size-3.5" aria-hidden="true" />
          <span className="font-medium text-ink">Numerical QC</span>
        </nav>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-attention-soft px-2.5 py-0.5 text-xs font-medium text-attention">In review</span>
          <span className="text-ink-muted">Planned submission 30 Oct 2026</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside aria-label="Dossier" className="w-72 shrink-0 overflow-y-auto border-r border-line bg-page">
          <DossierTree search={search} />
        </aside>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[76rem] space-y-5 p-6">
            <ChangeNotice />
            <QcLog />
            <Reference search={search} typed={typed} oldValues={oldValues} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Dossier tree ---------- */

const TREE: { module: string; title: string; docs: { docType: string; section: string; label: string }[] }[] = [
  { module: 'Module 1', title: 'Administrative information', docs: [{ docType: 'label', section: '14', label: '1.14 Prescribing Information' }] },
  {
    module: 'Module 2',
    title: 'Summaries',
    docs: [
      { docType: 'm25', section: '2.5', label: '2.5 Clinical Overview' },
      { docType: 'm27', section: '2.7.3', label: '2.7.3 Summary of Clinical Efficacy' },
    ],
  },
  { module: 'Module 5', title: 'Clinical study reports', docs: [{ docType: 'csr', section: '11.4.1', label: '5.3.5.1 LMN-301 CSR' }] },
];

const NEEDS_PERSON: QcStatus[] = ['writer', 'labelling'];

function TreeBadge({ statuses }: { statuses: QcStatus[] }) {
  if (statuses.length === 0) return null;
  const tone = statuses.some((s) => NEEDS_PERSON.includes(s))
    ? 'bg-attention-soft text-attention'
    : statuses.every((s) => s === 'recomputed' || s === 'approved')
      ? 'bg-recomputed-soft text-recomputed'
      : 'bg-open-soft text-ink';
  return <span className={`ml-auto rounded-full px-1.5 text-[11px] font-semibold leading-[18px] ${tone}`}>{statuses.length}</span>;
}

function DossierTree({ search }: { search: ReferenceSearch }) {
  const review = useReview();
  const statusOf = useStatusOf();
  const navigate = useNavigate();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const refDocs = [...new Set((search.data ?? []).map((h) => h.doc_title))];

  const toggle = (k: string) =>
    setClosed((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="py-3 text-[13px]">
      <div className="px-4 pb-2 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
        Dossier, {SEQUENCE}
      </div>
      {TREE.map((m) => {
        const open = !closed.has(m.module);
        return (
          <div key={m.module}>
            <button
              type="button"
              onClick={() => toggle(m.module)}
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-ink hover:bg-desk"
              aria-expanded={open}
            >
              {open ? <ChevronDown className="size-3.5 text-ink-muted" /> : <ChevronRight className="size-3.5 text-ink-muted" />}
              {open ? <FolderOpen className="size-4 text-cited" /> : <Folder className="size-4 text-cited" />}
              <span className="font-medium whitespace-nowrap">{m.module}</span>
              <span className="min-w-0 truncate text-ink-muted">{m.title}</span>
            </button>
            {open
              ? m.docs.map((d) => {
                  const rows = review.affected.filter((r) => r.section === d.section);
                  return (
                    <button
                      key={d.section}
                      type="button"
                      onClick={() => rows[0] && void navigate(`/review/${rows[0].sentence_id}`)}
                      className="flex w-full items-start gap-1.5 py-1.5 pr-3 pl-9 text-left text-ink hover:bg-cited-soft"
                    >
                      <FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                      <span className="min-w-0 leading-snug">{d.label}</span>
                      <TreeBadge statuses={rows.map(statusOf)} />
                    </button>
                  );
                })
              : null}
          </div>
        );
      })}
      <div className="mt-4 border-t border-line px-4 pt-3 pb-2 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
        Reference documents
      </div>
      {search.loading ? (
        <div className="space-y-2 px-4">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      ) : refDocs.length === 0 ? (
        <p className="px-4 text-ink-muted">None quote the old result.</p>
      ) : (
        refDocs.map((t) => (
          <a key={t} href="#reference" className="flex items-start gap-1.5 py-1.5 pr-3 pl-5 text-ink hover:bg-desk">
            <FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span className="min-w-0 leading-snug">{t}</span>
            <span className="ml-auto whitespace-nowrap rounded-full bg-attention-soft px-1.5 text-[11px] font-semibold leading-[18px] text-attention">
              Old result
            </span>
          </a>
        ))
      )}
    </div>
  );
}

/* ---------- Change notice ---------- */

function VersionPill({ v, current }: { v: number; current: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${current ? 'bg-cited-soft text-cited' : 'bg-open-soft text-ink-muted'}`}
    >
      v{v} {current ? 'Current' : 'Superseded'}
    </span>
  );
}

function ChangeNotice() {
  const summary = useRestatementSummary();
  return (
    <section aria-label="Change notice" className="rounded-[var(--radius)] border border-line border-l-4 border-l-attention bg-page px-5 py-4">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-xs font-medium text-attention">Change notice</div>
          <QueryBoundary
            query={summary}
            skeleton={<Skeleton className="mt-1 h-6 w-2/3" />}
            failed="The restatement could not be read."
            emptyTitle="No restatement found"
            emptyHint="The certified table has a single version, so nothing needs review."
          >
            {(rows) => {
              const s = rows[0];
              return (
                <>
                  <h1 className="mt-0.5 text-lg font-semibold text-ink">
                    {tlfName(s.table_name)} was re-delivered by {s.restated_by}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                    <VersionPill v={s.prev_version} current={false} />
                    <ChevronRight className="size-3.5" aria-hidden="true" />
                    <VersionPill v={s.curr_version} current />
                    <span className="ml-2">
                      {formatDateUtc(s.restated_at)}, {formatClockUtc(s.restated_at)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-ink">
                    The changed figures appear in CSR 11.4.1, Module 2.7.3, Module 2.5 and the label.
                  </p>
                </>
              );
            }}
          </QueryBoundary>
          <div className="mt-1">
            <DbxLink linkKey="beat1" label="Table history in Databricks" />
          </div>
        </div>
        <RecomputeButton />
      </div>
    </section>
  );
}

/* ---------- QC log ---------- */

type Filter = 'all' | 'open' | 'person' | 'recomputed' | 'approved';

const FILTERS: { key: Filter; label: string; match: (s: QcStatus) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'open', label: 'Ready for review', match: (s) => s === 'open' || s === 'checking' },
  { key: 'person', label: 'Needs a person', match: (s) => NEEDS_PERSON.includes(s) },
  { key: 'recomputed', label: 'Recomputed', match: (s) => s === 'recomputed' },
  { key: 'approved', label: 'Approved', match: (s) => s === 'approved' },
];

function QcLog() {
  const review = useReview();
  const statusOf = useStatusOf();
  const [filter, setFilter] = useState<Filter>('all');
  const statuses = review.affected.map(statusOf);

  return (
    <section aria-label="Numerical QC log" className="rounded-[var(--radius)] border border-line bg-page">
      <div className="flex items-end justify-between border-b border-line px-5 pt-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Numerical QC log</h2>
          <p className="text-sm text-ink-muted">Sentences that cite a changed cell of {TLF.efficacy_primary}</p>
          <div role="tablist" aria-label="Filter findings" className="mt-3 flex gap-1">
            {FILTERS.map((f) => {
              const n = statuses.filter(f.match).length;
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.key)}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2 text-sm ${active ? 'border-cited font-medium text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
                >
                  {f.label}
                  <span className={`rounded-full px-1.5 text-[11px] leading-[18px] ${active ? 'bg-cited text-page' : 'bg-open-soft text-ink-muted'}`}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {review.phase === 'failed' ? (
        <div className="px-5 pt-3">
          <ErrorNote title="The figures could not be recomputed from source." detail={review.failure} />
        </div>
      ) : null}

      <div className="px-5 pb-4">
        {review.impact.loading ? (
          <div className="space-y-2 pt-3">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : review.impact.error ? (
          <div className="pt-3">
            <ErrorNote title="The QC log could not be built." detail={review.impact.error} />
          </div>
        ) : review.affected.length === 0 ? (
          <p className="py-6 text-ink-muted">No sentence cites a figure that changed between the two versions.</p>
        ) : (
          <QcTable filter={FILTERS.find((f) => f.key === filter)!.match} />
        )}
        <Unchanged />
      </div>
    </section>
  );
}

const TH = 'bg-desk px-3 py-2 text-left text-xs font-semibold text-ink-muted';
const TD = 'px-3 py-2.5 align-top';

function QcTable({ filter }: { filter: (s: QcStatus) => boolean }) {
  const review = useReview();
  const statusOf = useStatusOf();
  const navigate = useNavigate();
  const order = Object.keys(FIG_LABEL);
  const figsOf = (id: string) =>
    review.impact.rows
      .filter((r) => r.sentence_id === id)
      .sort((a, b) => order.indexOf(a.fig_key) - order.indexOf(b.fig_key));
  const rows = review.affected.filter((r) => filter(statusOf(r)));

  return (
    <table className="mt-3 w-full table-fixed border-collapse text-sm">
      <colgroup>
        <col className="w-[14%]" />
        <col className="w-[32%]" />
        <col className="w-[18%]" />
        <col className="w-[16%]" />
        <col className="w-[7%]" />
        <col className="w-[13%]" />
      </colgroup>
      <thead>
        <tr className="border-y border-line">
          <th className={TH}>Location</th>
          <th className={TH}>Text says</th>
          <th className={TH}>Source cell</th>
          <th className={TH}>Finding</th>
          <th className={TH}>Owner</th>
          <th className={TH}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
              No finding has this status.
            </td>
          </tr>
        ) : (
          rows.map((r) => (
            <QcRow
              key={r.sentence_id}
              row={r}
              figs={figsOf(r.sentence_id)}
              status={statusOf(r)}
              onOpen={() => void navigate(`/review/${r.sentence_id}`)}
            />
          ))
        )}
      </tbody>
    </table>
  );
}

function QcRow({ row, figs, status, onOpen }: { row: ImpactRow; figs: ImpactRow[]; status: QcStatus; onOpen: () => void }) {
  const review = useReview();
  const done = review.phase === 'done';
  const verdict = review.verdicts.get(row.sentence_id);
  const flagged = status === 'writer';

  const first = figs[0];
  const cell = first ? FIG_CELL[first.fig_key] : undefined;
  const source = cell
    ? `${TLF.efficacy_primary}, ${cell.row}, ${CELL_LABEL[cell.column] ?? cell.column}`
    : TLF.efficacy_primary;
  const flip = (f: ImpactRow, i: number) => (
    <FlipPair
      prev={f.old_value}
      next={done ? (review.values?.[f.fig_key] ?? f.new_value) : null}
      order={i}
      animate={review.animated}
    />
  );
  const byKey = new Map(figs.map((f, i) => [f.fig_key, { f, i }]));
  const ciLow = byKey.get('ci_low');
  const ciHigh = byKey.get('ci_high');
  const parts = figs
    .filter((f) => f.fig_key !== 'ci_low' && f.fig_key !== 'ci_high')
    .map((f) => {
      const i = byKey.get(f.fig_key)?.i ?? 0;
      const pct = f.fig_key.endsWith('_rate') ? '%' : '';
      const ci =
        f.fig_key === 'diff' && ciLow && ciHigh ? (
          <>
            {' '}(95% CI {flip(ciLow.f, ciLow.i)} to {flip(ciHigh.f, ciHigh.i)})
          </>
        ) : null;
      return (
        <span key={f.fig_key}>
          {FIG_LABEL[f.fig_key] ?? f.fig_key} {flip(f, i)}
          {pct}
          {ci}
        </span>
      );
    });

  let finding = 'Value changed';
  if (row.kind === 'label') finding = 'Label text';
  if (flagged) finding = 'Wording may not hold';

  return (
    <tr
      className={`cursor-pointer border-b border-line hover:bg-cited-soft ${flagged ? 'bg-attention-soft/60' : ''}`}
      onClick={onOpen}
    >
      <td className={TD}>
        <Link
          to={`/review/${row.sentence_id}`}
          className="font-medium text-cited hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {docLabel(row.doc_type, row.section)}, sentence {row.seq}
        </Link>
        <div className="text-xs text-ink-muted">{docMeta(row.doc_type).draft}</div>
      </td>
      <td className={TD}>
        {parts.map((p, i) => (
          <span key={i}>
            {i > 0 ? '; ' : ''}
            {p}
          </span>
        ))}
      </td>
      <td className={`${TD} text-ink-muted`}>
        {source}
        {figs.length > 1 ? `, and ${figs.length - 1} more` : ''}
      </td>
      <td className={TD}>
        <span className={`whitespace-nowrap ${flagged ? 'font-medium text-attention' : ''}`}>{finding}</span>
        {flagged && verdict ? <p className="mt-1 max-w-xs text-[13px] leading-snug text-ink">{verdict.reason}</p> : null}
      </td>
      <td className={TD}>{row.kind === 'label' ? 'Labelling' : 'Writer'}</td>
      <td className={TD}>
        <StatusPill status={status} wrap />
      </td>
    </tr>
  );
}

function Unchanged() {
  const q = useUnchangedSentences();
  const [open, setOpen] = useState(false);

  if (q.loading) return <Skeleton className="mt-4 h-5 w-3/5" />;
  if (q.error) return <ErrorNote title="The unchanged sentences could not be listed." detail={q.error} />;
  if (!q.data || q.data.length === 0) return <p className="mt-4 text-sm text-ink-muted">No sentences cite Table 14.3.1.</p>;

  const places = [...new Set((q.data as UnchangedRow[]).map((u) => docLabel(u.doc_type, u.section)))];
  return (
    <div className="mt-3 text-sm text-ink-muted">
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

/* ---------- Reference documents (AI Search) ---------- */

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

function Reference({ search, typed, oldValues }: { search: ReferenceSearch; typed: string; oldValues: string[] }) {
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
  const terms = typed ? [typed] : oldValues;

  return (
    <section id="reference" aria-label="Reference documents" className="scroll-mt-4 rounded-[var(--radius)] border border-line bg-page">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Reference documents outside the dossier</h2>
          <p className="flex items-center gap-1.5 text-sm text-ink-muted">
            <Search className="size-3.5" aria-hidden="true" />
            {typed ? `AI Search for "${typed}"` : 'AI Search for the old result'}
          </p>
        </div>
        <div className="flex gap-x-4">
          <DbxLink linkKey="beat1_search" label="AI Search index in Databricks" />
          <DbxLink linkKey="beat1_volume" label="Source documents volume in Databricks" />
        </div>
      </div>
      <div className="px-5 py-4">
        {search.loading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-3/5" />
            <Skeleton className="h-16 w-full" />
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
            {typed ? `No reference document quotes "${typed}".` : 'No reference document still quotes the old result.'}
          </p>
        ) : (
          <>
            <table className="w-full table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[8%]" />
                <col />
              </colgroup>
              <thead>
                <tr className="border-y border-line">
                  <th className={TH}>Document</th>
                  <th className={TH}>Page</th>
                  <th className={TH}>Passage</th>
                </tr>
              </thead>
              <tbody>
                {docs.flatMap(([title, hits]) =>
                  hits.map((h, i) => (
                    <tr key={`${h.file_path}:${h.page}`} className="border-b border-line">
                      <td className={TD}>
                        {i === 0 ? (
                          <span className="flex items-start gap-1.5 font-medium text-ink">
                            <FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden="true" />
                            {title}
                          </span>
                        ) : null}
                      </td>
                      <td className={`${TD} text-ink-muted`}>{h.page}</td>
                      <td className={`${TD} font-serif text-[15px] leading-relaxed text-ink`}>
                        ...{highlight(trimSnippet(h.snippet), terms)}...
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
            {notifyError ? (
              <div className="mt-3">
                <ErrorNote title="Owners were not notified." detail={notifyError} />
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-4">
              {review.notified ? (
                <p className="text-sm font-medium text-recomputed">Owners notified at {formatClock(review.notified.at)}.</p>
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
          </>
        )}
      </div>
    </section>
  );
}
