import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { postWordingCheck } from '../data/api';
import { useReview } from '../data/review';
import { useDocumentSection, useImpactList, useRecomputeFigures } from '../data/queries';
import type { ImpactRow, RecomputeRow } from '../data/types';
import { DocumentSentence, PageBoundary, sentenceText, toSentences } from '../components/Document';
import { ApproveComment, GenieComment, OtherDocuments, WordingComment } from '../components/Margin';
import { ErrorNote, QueryBoundary } from '../components/QueryBoundary';
import { docLabel } from '../lib/format';
import { useAsync } from '../lib/useAsync';

type Phase = 'idle' | 'recomputing' | 'done' | 'failed';

/* Mounted only while recomputing, so the query runs when the reviewer clicks. */
function RecomputeRunner({ onDone, onFail }: { onDone: (rows: RecomputeRow[]) => void; onFail: (msg: string) => void }) {
  const q = useRecomputeFigures();
  useEffect(() => {
    if (q.error) onFail(q.error);
    else if (q.data && !q.loading) onDone(q.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, q.error, q.loading]);
  return null;
}

export function Section() {
  const { section = '11.4.1' } = useParams();
  const doc = useDocumentSection(section);
  const impact = useImpactList();

  const [phase, setPhase] = useState<Phase>('idle');
  const [failure, setFailure] = useState<string | null>(null);
  const [recomputeRows, setRecomputeRows] = useState<RecomputeRow[] | null>(null);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const review = useReview();
  const [answered, setAnswered] = useState(false);
  const [pageEl, setPageEl] = useState<HTMLElement | null>(null);

  const affected: ImpactRow[] = useMemo(() => {
    const seen = new Map<string, ImpactRow>();
    for (const r of impact.data ?? []) if (!seen.has(r.sentence_id)) seen.set(r.sentence_id, r);
    return [...seen.values()];
  }, [impact.data]);
  const affectedIds = affected.map((r) => r.sentence_id);
  const figureIds = affected.filter((r) => r.kind === 'figure').map((r) => r.sentence_id);
  const labelIds = affected.filter((r) => r.kind === 'label').map((r) => r.sentence_id);
  const others = affected.filter((r) => !(r.doc_type === 'csr' && r.section === section));

  const recomputed = useMemo(() => {
    if (!recomputeRows) return null;
    return Object.fromEntries(recomputeRows.map((r) => [r.fig_key, r.value]));
  }, [recomputeRows]);
  const sourceVersion = recomputeRows?.[0]?.source_version ?? null;

  const done = phase === 'done';
  const wording = useAsync(() => postWordingCheck(affectedIds), done && affectedIds.length > 0);
  const verdicts = new Map((wording.data ?? []).map((r) => [r.sentence_id, r]));

  /* Record the hand-offs the moment they happen. The route names the reviewer. */
  useEffect(() => {
    if (!done || labelIds.length === 0 || review.loading || review.recomputed) return;
    review.record(labelIds, 'sent_to_labelling').catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, review.loading]);
  useEffect(() => {
    const ids = (wording.data ?? []).filter((r) => r.verdict === 'needs_writer').map((r) => r.sentence_id);
    if (ids.length > 0 && !review.withWriter) review.record(ids, 'sent_to_writer').catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wording.data]);

  /* After a reload the review table already says the figures were recomputed: show that state. */
  useEffect(() => {
    if (review.recomputed && phase === 'idle') setPhase('recomputing');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.recomputed]);

  const sentences = useMemo(() => toSentences(doc.data ?? []), [doc.data]);
  const flipIndex = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const s of sentences)
      for (const c of s.cites.values()) if (c.value_prev !== c.value_curr) m.set(c.citation_id, n++);
    return m;
  }, [sentences]);

  const title = impact.data?.find((r) => r.section === section);
  const heading = title ? `${section} ${title.section_title}` : section;
  const headerLabel = title ? docLabel(title.doc_type, section) : `Section ${section}`;


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

  const quote = (id: string) => {
    const s = sentences.find((x) => x.sentenceId === id);
    return s ? sentenceText(s, recomputed ?? {}) : id;
  };
  const flaggedId = (wording.data ?? []).find((r) => r.verdict === 'needs_writer')?.sentence_id;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6 md:px-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-4">
          <Link to="/" className="text-sm text-cited underline underline-offset-4">
            Overview
          </Link>
          <h1 className="text-lg font-semibold text-ink">
            {headerLabel}
            {title ? <span className="ml-2 font-normal text-ink-muted">{title.section_title}</span> : null}
          </h1>
        </div>
        <Button
          size="lg"
          onClick={() => {
            setFailure(null);
            setPhase('recomputing');
          }}
          disabled={phase === 'recomputing' || done}
        >
          {phase === 'recomputing'
            ? 'Recomputing from source'
            : done
              ? `Recomputed from version ${sourceVersion ?? ''}`.trim()
              : phase === 'failed'
                ? 'Recompute again'
                : 'Recompute from source'}
        </Button>
      </div>

      {phase === 'recomputing' ? (
        <RecomputeRunner
          onDone={(rows) => {
            setRecomputeRows(rows);
            setPhase('done');
          }}
          onFail={(msg) => {
            setFailure(msg);
            setPhase('failed');
          }}
        />
      ) : null}
      {phase === 'failed' ? (
        <div className="mb-4">
          <ErrorNote title="The figures could not be recomputed from source." detail={failure} />
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <section
          ref={setPageEl}
          aria-label={`${headerLabel} text`}
          className="min-h-[28rem] rounded-[var(--radius-page)] bg-page px-8 py-10 shadow-page md:px-14 lg:self-start"
        >
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
            emptyHint="The section has no sentences in the document store yet. Go back to the overview and open CSR 11.4.1."
          >
            {() => (
              <PageBoundary.Provider value={pageEl}>
                <h2 className="doc-body mb-4 text-xl font-semibold text-ink">{heading}</h2>
                <p className="doc-body text-ink">
                  {sentences.map((s) => (
                    <DocumentSentence
                      key={s.sentenceId}
                      sentence={s}
                      recomputed={recomputed}
                      reserve={phase !== 'idle'}
                      sourceVersion={sourceVersion}
                      flipIndex={flipIndex}
                      verdict={verdicts.get(s.sentenceId)}
                    />
                  ))}
                </p>
              </PageBoundary.Provider>
            )}
          </QueryBoundary>
        </section>

        <aside aria-label="Review comments" className="space-y-4">
          {done && affectedIds.length > 0 ? (
            <WordingComment check={wording} quote={quote} flaggedId={flaggedId} />
          ) : null}
          {impact.loading ? (
            <Skeleton className="h-40 w-full" />
          ) : impact.error ? (
            <ErrorNote title="The other documents could not be listed." detail={impact.error} />
          ) : (
            <OtherDocuments rows={others} all={impact.data ?? []} recomputed={done} approved={review.approved !== null} />
          )}
          <GenieComment onAnswered={() => setAnswered(true)} />
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
        </aside>
      </div>
    </div>
  );
}
