import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { ChevronLeft, ChevronRight, Minus, Plus, X } from 'lucide-react';
import { useReview } from '../data/review';
import { useDocumentSection, useRestatementSummary, useTlfTable } from '../data/queries';
import { DocumentSentence, FigureFocus, FlipPair, PageBoundary, sentenceText, toSentences } from '../components/Document';
import { DraftRun } from '../components/DraftRun';
import { AssistantDrawer, SUGGESTED } from '../components/Assistant';
import { ApproveComment, DRAFTABLE, MarginComment, WordingComment } from '../components/Margin';
import { ParsedPage } from '../components/ParsedPage';
import type { SourcePage } from '../data/types';
import { ErrorNote, QueryBoundary } from '../components/QueryBoundary';
import { RecomputeButton } from '../components/RecomputeButton';
import { TlfPage } from '../components/Tlf';
import {
  CELL_LABEL,
  docLabel,
  docMeta,
  FIG_CELL,
  FIG_LABEL,
  formatClockUtc,
  formatDateUtc,
  TLF,
} from '../lib/format';
import { DbxLink } from '../lib/presenter';
import { StatusPill, useStatusOf } from '../lib/status';

const ZOOMS = [0.8, 0.9, 1, 1.1, 1.25];

export function Viewer() {
  const { sentenceId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  /* Workflow step 2 shows the section as drafted against version 3, before the re-delivery and QC. */
  const drafting = searchParams.get('step') === 'draft';
  const review = useReview();
  const statusOf = useStatusOf();
  const { phase, values, sourceVersion, wording, verdicts, affected } = review;
  const done = phase === 'done';

  const idx = Math.max(0, affected.findIndex((r) => r.sentence_id === sentenceId));
  const finding = affected[idx];
  const section = finding?.section ?? '11.4.1';
  const meta = docMeta(finding?.doc_type ?? 'csr');
  const doc = useDocumentSection(section);
  const tlf = useTlfTable();
  const summary = useRestatementSummary();

  const [focus, setFocus] = useState<string | null>(null);
  const focusValue = useMemo(() => ({ focus, setFocus }), [focus]);
  const [zoom, setZoom] = useState(2);
  const [tlfVersion, setTlfVersion] = useState<3 | 4>(drafting ? 3 : 4);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [pageEl, setPageEl] = useState<HTMLElement | null>(null);
  const [sourcePage, setSourcePage] = useState<SourcePage | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const figureIds = affected.filter((r) => r.kind === 'figure').map((r) => r.sentence_id);
  const sentences = useMemo(() => toSentences(doc.data ?? []), [doc.data]);
  const flipIndex = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const s of sentences)
      for (const c of s.cites.values()) if (c.value_prev !== c.value_curr) m.set(c.citation_id, n++);
    return m;
  }, [sentences]);

  const order = Object.keys(FIG_LABEL);
  const figs = review.impact.rows
    .filter((r) => r.sentence_id === sentenceId)
    .sort((a, b) => order.indexOf(a.fig_key) - order.indexOf(b.fig_key));
  const currentKeys = useMemo(() => new Set(figs.map((f) => f.fig_key)), [figs]);

  /* Bring the open finding into view on the page. */
  useEffect(() => {
    if (sentences.length > 0) document.getElementById(`s-${sentenceId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [sentenceId, sentences.length]);

  useEffect(() => {
    if (review.approved) document.getElementById('signoff')?.scrollIntoView({ block: 'nearest' });
  }, [review.approved]);

  useEffect(() => {
    setTlfVersion(drafting ? 3 : 4);
    if (drafting) {
      const t = setTimeout(() => {
        document.getElementById('drafting')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }, 400);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [drafting]);

  async function approve() {
    setApproving(true);
    setApproveError(null);
    try {
      await review.record(figureIds, 'approved');
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : 'The request failed.');
    } finally {
      setApproving(false);
    }
  }

  /* The flagged sentence may sit in another section: quote it when it is on this page, else name it. */
  const quote = (id: string) => {
    const s = sentences.find((x) => x.sentenceId === id);
    if (s) return sentenceText(s, values ?? {});
    const r = affected.find((x) => x.sentence_id === id);
    return r ? `${docLabel(r.doc_type, r.section)}, sentence ${r.seq}` : id;
  };
  const flaggedId = (wording.data ?? []).find((r) => r.verdict === 'needs_writer')?.sentence_id;
  const go = (i: number) => {
    const r = affected[i];
    if (r) void navigate(`/review/${r.sentence_id}`);
  };

  const s0 = summary.data?.[0];
  const certified = s0
    ? `Re-delivered by ${s0.restated_by}, ${formatDateUtc(s0.restated_at)} ${formatClockUtc(s0.restated_at)}.`
    : '';

  return (
    <FigureFocus.Provider value={focusValue}>
      <div className="flex h-full flex-col">
        {/* Viewer header, as in a document-management viewer */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-page px-4">
          <Link to="/" aria-label="Close the viewer" className="grid size-8 place-items-center rounded-[var(--radius)] text-ink-muted hover:bg-desk hover:text-ink">
            <X className="size-5" />
          </Link>
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[15px]">
            <Link to="/" className="text-ink-muted hover:text-cited hover:underline">
              QC log
            </Link>
            <span className="text-ink-muted">/</span>
            <span className="truncate font-medium text-ink">
              {meta.title}, {meta.draft}
            </span>
          </nav>
          {drafting ? (
            <span className="rounded-full bg-cited-soft px-2.5 py-0.5 text-xs font-medium text-cited">Drafting, against Table 14.2.1 v3</span>
          ) : (
            <span className="rounded-full bg-attention-soft px-2.5 py-0.5 text-xs font-medium text-attention">In review</span>
          )}
          <div className="flex-1" />
          {drafting ? null : <RecomputeButton size="default" />}
          <div className={`items-center gap-1 rounded-[var(--radius)] border border-line pl-3 text-sm text-ink ${drafting ? 'hidden' : 'flex'}`}>
            <span className="pr-1 whitespace-nowrap">
              Finding {idx + 1} of {affected.length || '-'}
            </span>
            <button type="button" aria-label="Previous finding" disabled={idx <= 0} onClick={() => go(idx - 1)} className="grid size-8 place-items-center border-l border-line text-ink-muted hover:bg-desk disabled:opacity-40">
              <ChevronLeft className="size-4" />
            </button>
            <button type="button" aria-label="Next finding" disabled={idx >= affected.length - 1} onClick={() => go(idx + 1)} className="grid size-8 place-items-center border-l border-line text-ink-muted hover:bg-desk disabled:opacity-40">
              <ChevronRight className="size-4" />
            </button>
          </div>
        </header>

        {phase === 'failed' ? (
          <div className="border-b border-line bg-page px-4 py-2">
            <ErrorNote title="The figures could not be recomputed from source." detail={review.failure} />
          </div>
        ) : null}

        <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_23rem]">
          {/* Document page */}
          <section aria-label={`${meta.title} page`} className="flex min-h-0 flex-col border-r border-line">
            <PaneBar>
              <span className="truncate font-medium text-ink">
                {finding ? `${docLabel(finding.doc_type, section)} ${finding.section_title}` : section}
              </span>
              <div className="flex items-center gap-3 text-ink-muted">
                <span className="whitespace-nowrap">Page {meta.page}</span>
                <div className="flex items-center">
                  <IconButton label="Zoom out" disabled={zoom === 0} onClick={() => setZoom((z) => z - 1)}>
                    <Minus className="size-3.5" />
                  </IconButton>
                  <span className="w-11 text-center tabular-nums">{Math.round(ZOOMS[zoom] * 100)}%</span>
                  <IconButton label="Zoom in" disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => z + 1)}>
                    <Plus className="size-3.5" />
                  </IconButton>
                </div>
              </div>
            </PaneBar>
            <div className="min-h-0 flex-1 overflow-auto bg-desk p-6">
              <div ref={setPageEl} className="mx-auto max-w-[44rem] bg-page shadow-page" style={{ zoom: ZOOMS[zoom] }}>
                <div className="flex justify-between border-b border-line px-12 pt-6 pb-2 text-[11px] text-ink-muted">
                  <span>{meta.title}</span>
                  <span>{meta.draft}, Confidential</span>
                </div>
                <div className="px-12 py-8">
                  <QueryBoundary
                    query={doc}
                    skeleton={
                      <div className="space-y-3">
                        <Skeleton className="h-6 w-1/2" />
                        <Skeleton className="h-5 w-full" />
                        <Skeleton className="h-5 w-full" />
                        <Skeleton className="h-5 w-4/5" />
                      </div>
                    }
                    failed="This section could not be read."
                    emptyTitle={`No text for section ${section}`}
                    emptyHint="The section has no sentences in the document store yet. Close the viewer and open another finding."
                  >
                    {() => (
                      <PageBoundary.Provider value={pageEl}>
                        <h2 className="doc-body mb-4 text-xl font-semibold text-ink">
                          {section} {finding?.section_title}
                        </h2>
                        <p className="doc-body text-ink">
                          {sentences.map((s) => (
                            <DocumentSentence
                              key={s.sentenceId}
                              sentence={s}
                              recomputed={values}
                              reserve={phase !== 'idle'}
                              animate={review.animated}
                              sourceVersion={sourceVersion}
                              flipIndex={flipIndex}
                              verdict={verdicts.get(s.sentenceId)}
                              current={s.sentenceId === sentenceId}
                            />
                          ))}
                        </p>
                      </PageBoundary.Provider>
                    )}
                  </QueryBoundary>
                </div>
                <div className="pb-5 text-center text-[11px] text-ink-muted">Page {meta.page}</div>
              </div>
            </div>
          </section>

          {/* Source table page */}
          <section aria-label={`${TLF.efficacy_primary} output`} className="flex min-h-0 flex-col border-r border-line">
            {sourcePage ? (
              <>
                <PaneBar>
                  <span className="truncate font-medium text-ink">
                    {sourcePage.doc_title}, page {sourcePage.page}
                  </span>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSourcePage(null)}>
                    Back to {TLF.efficacy_primary}
                  </Button>
                </PaneBar>
                <div className="min-h-0 flex-1 overflow-auto bg-desk px-4 py-6">
                  <ParsedPage page={sourcePage} />
                  <div className="mx-auto mt-2 max-w-[34rem]">
                    <DbxLink linkKey="beat2_parsed" label="Parsed elements in Databricks" />
                  </div>
                </div>
              </>
            ) : (
            <>
            <PaneBar>
              <span className="truncate font-medium text-ink">
                {TLF.efficacy_primary}
                <span className="hidden min-[1400px]:inline"> Primary efficacy</span>
              </span>
              <div role="radiogroup" aria-label="Table version" className="flex overflow-hidden rounded-[var(--radius)] border border-line text-xs">
                {([3, 4] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={tlfVersion === v}
                    onClick={() => setTlfVersion(v)}
                    className={`px-2.5 py-1 whitespace-nowrap ${tlfVersion === v ? 'bg-cited text-page' : 'bg-page text-ink-muted hover:bg-desk'}`}
                  >
                    v{v}
                    <span className="hidden min-[1400px]:inline"> {v === 4 ? 'Current' : 'Superseded'}</span>
                  </button>
                ))}
              </div>
            </PaneBar>
            <div className="min-h-0 flex-1 overflow-auto bg-desk px-4 py-6">
              <QueryBoundary
                query={tlf}
                skeleton={<Skeleton className="mx-auto h-80 w-full max-w-[34rem]" />}
                failed={`${TLF.efficacy_primary} could not be read.`}
                emptyTitle={`${TLF.efficacy_primary} is empty`}
                emptyHint="The certified table returned no cells."
              >
                {(cells) => (
                  <TlfPage
                    cells={cells}
                    version={tlfVersion}
                    matched={done}
                    animate={review.animated}
                    currentKeys={currentKeys}
                    certified={certified}
                  />
                )}
              </QueryBoundary>
              <div className="mx-auto mt-3 flex max-w-[34rem] flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                {tlfVersion === 4 ? (
                  done ? (
                    <Legend tone="bg-recomputed-soft border-recomputed" label="Changed cell, the text now matches" />
                  ) : (
                    <Legend tone="bg-attention-soft border-attention" label="Changed cell, the text still quotes version 3" />
                  )
                ) : (
                  <span>Version 3 is the table the draft was written from.</span>
                )}
                <DbxLink linkKey="beat2" label="Table lineage in Databricks" />
              </div>
            </div>
            </>
            )}
          </section>

          {/* Information panel */}
          <aside aria-label="Information" className="flex min-h-0 flex-col bg-page">
            <div className="flex h-10 shrink-0 items-center border-b border-line px-4 text-[15px] font-semibold text-ink">Information</div>
            <div className="min-h-0 flex-1 overflow-y-auto">
            {finding && !drafting ? (
              <div className="border-b border-line px-4 py-4">
                <h2 className="text-sm font-semibold text-ink">Finding</h2>
                <dl className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-ink-muted">Location</dt>
                  <dd className="text-ink">
                    {docLabel(finding.doc_type, section)}, sentence {finding.seq}
                  </dd>
                  <dt className="text-ink-muted">Owner</dt>
                  <dd className="text-ink">{finding.kind === 'label' ? 'Labelling' : 'Writer'}</dd>
                  <dt className="self-center text-ink-muted">QC status</dt>
                  <dd>
                    <StatusPill status={statusOf(finding)} />
                  </dd>
                  <dt className="text-ink-muted">Source cells</dt>
                  <dd className="space-y-0.5 text-ink">
                    {figs.map((f, i) => {
                      const c = FIG_CELL[f.fig_key];
                      return (
                        <div
                          key={f.fig_key}
                          onMouseEnter={() => setFocus(f.fig_key)}
                          onMouseLeave={() => setFocus(null)}
                          className={`flex justify-between gap-2 rounded-[2px] px-1 -mx-1 ${focus === f.fig_key ? 'bg-cited-soft' : ''}`}
                        >
                          <span className="text-ink-muted">
                            {c ? `${c.row}, ${CELL_LABEL[c.column] ?? c.column}` : f.fig_key}
                          </span>
                          <FlipPair prev={f.old_value} next={done ? (values?.[f.fig_key] ?? f.new_value) : null} order={i} animate={review.animated} />
                        </div>
                      );
                    })}
                  </dd>
                </dl>
              </div>
            ) : null}
            {done && affected.length > 0 ? <WordingComment check={wording} quote={quote} flaggedId={flaggedId} /> : null}
            {DRAFTABLE.has(section) && drafting ? <DraftRun key={section} highlight={drafting} section={section} onFocus={setFocus} onShowSource={setSourcePage} onFilled={(v) => setTlfVersion(v === 3 ? 3 : 4)} /> : null}
            <div className="px-4 py-4">
              <h2 className="text-sm font-semibold text-ink">Version history, {TLF.efficacy_primary}</h2>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-muted">
                    <th className="py-1.5 font-semibold">Version</th>
                    <th className="py-1.5 font-semibold">Status</th>
                    <th className="py-1.5 font-semibold">Delivered</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-line">
                    <td className="py-1.5">4</td>
                    <td className="py-1.5">
                      <span className="rounded-full bg-cited-soft px-2 py-0.5 text-xs font-medium text-cited">Current</span>
                    </td>
                    <td className="py-1.5 text-ink-muted">
                      {s0 ? `${formatDateUtc(s0.restated_at)} ${formatClockUtc(s0.restated_at)}` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1.5">3</td>
                    <td className="py-1.5">
                      <span className="rounded-full bg-open-soft px-2 py-0.5 text-xs font-medium text-ink-muted">Superseded</span>
                    </td>
                    <td className="py-1.5 text-ink-muted">Before the restatement</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-2">
                <DbxLink linkKey="beat1" label="Table history in Databricks" />
              </div>
            </div>
            </div>
            {/* Ask and approve stay in view while the panel above scrolls (not while drafting). */}
            <div className={`max-h-[60%] shrink-0 overflow-y-auto border-t border-line shadow-[0_-6px_12px_-8px_rgba(16,24,40,0.18)] ${drafting ? 'hidden' : ''}`}>
              <MarginComment author="Reviewer assistant" via="Genie Agent and AI Search">
                <p className="text-ink-muted">Ask about the results in the certified tables or about what the source documents say.</p>
                <Button size="sm" variant="outline" onClick={() => setAssistantOpen(true)}>
                  Open the assistant
                </Button>
              </MarginComment>
              <ApproveComment
                figureCount={figureIds.length}
                recomputed={done}
                answered={answered}
                approving={approving}
                approveError={approveError}
                onApprove={() => void approve()}
                approved={review.approved}
                version={sourceVersion}
              />
            </div>
          </aside>
          <AssistantDrawer
            open={assistantOpen}
            onClose={() => setAssistantOpen(false)}
            onShowSource={setSourcePage}
            onAnswered={() => setAnswered(true)}
            initialQuestion={SUGGESTED[0]}
          />
        </div>
      </div>
    </FigureFocus.Provider>
  );
}

function PaneBar({ children }: { children: ReactNode }) {
  return <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line bg-page px-4 text-sm">{children}</div>;
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="icon" aria-label={label} disabled={disabled} onClick={onClick} className="size-7 text-ink-muted">
      {children}
    </Button>
  );
}

function Legend({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block size-3 rounded-[2px] border ${tone}`} aria-hidden="true" />
      {label}
    </span>
  );
}
