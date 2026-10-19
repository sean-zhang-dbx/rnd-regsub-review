import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Skeleton } from '@databricks/appkit-ui/react';
import { useReview } from '../data/review';
import { useDocumentSection } from '../data/queries';
import { DocumentSentence, PageBoundary, sentenceText, toSentences } from '../components/Document';
import { ApproveComment, GenieComment, WordingComment } from '../components/Margin';
import { ErrorNote, QueryBoundary } from '../components/QueryBoundary';
import { docLabel, docTitle, DRAFT_LABEL, STUDY } from '../lib/format';

export function Section() {
  const { section = '11.4.1' } = useParams();
  const doc = useDocumentSection(section);
  const review = useReview();

  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const [pageEl, setPageEl] = useState<HTMLElement | null>(null);

  const { phase, values, sourceVersion, wording, verdicts, affected } = review;
  const done = phase === 'done';
  const affectedIds = affected.map((r) => r.sentence_id);
  const figureIds = affected.filter((r) => r.kind === 'figure').map((r) => r.sentence_id);

  const sentences = useMemo(() => toSentences(doc.data ?? []), [doc.data]);
  const flipIndex = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const s of sentences)
      for (const c of s.cites.values()) if (c.value_prev !== c.value_curr) m.set(c.citation_id, n++);
    return m;
  }, [sentences]);

  const here = affected.find((r) => r.section === section);
  const docType = here?.doc_type ?? 'csr';
  const heading = here ? `${section} ${here.section_title}` : section;
  const headerLabel = docLabel(docType, section);

  async function approve() {
    setApproving(true);
    setApproveError(null);
    try {
      await review.record(figureIds, 'approved');
      requestAnimationFrame(() => document.getElementById('signoff')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : 'The request failed.');
    } finally {
      setApproving(false);
    }
  }

  useEffect(() => {
    if (review.approved) document.getElementById('signoff')?.scrollIntoView({ block: 'nearest' });
  }, [review.approved]);

  const quote = (id: string) => {
    const s = sentences.find((x) => x.sentenceId === id);
    return s ? sentenceText(s, values ?? {}) : id;
  };
  const flaggedId = (wording.data ?? []).find((r) => r.verdict === 'needs_writer')?.sentence_id;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6 md:px-10">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/" className="text-sm text-cited underline underline-offset-4">
            QC log
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-ink">
            {STUDY} {docTitle(docType, section)}, {DRAFT_LABEL}
          </h1>
          <p className="text-sm text-ink-muted">
            {headerLabel}
            {here ? `, ${here.section_title}` : ''}
          </p>
        </div>
        <Button size="lg" onClick={review.start} disabled={phase === 'recomputing' || done}>
          {phase === 'recomputing'
            ? 'Recomputing from source'
            : done
              ? `Recomputed from version ${sourceVersion ?? ''}`.trim()
              : phase === 'failed'
                ? 'Recompute again'
                : 'Recompute from version 4'}
        </Button>
      </div>

      {phase === 'failed' ? (
        <div className="mb-4">
          <ErrorNote title="The figures could not be recomputed from source." detail={review.failure} />
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
            emptyHint="The section has no sentences in the document store yet. Go back to the QC log and open another row."
          >
            {() => (
              <PageBoundary.Provider value={pageEl}>
                <h2 className="doc-body mb-4 text-xl font-semibold text-ink">{heading}</h2>
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
                    />
                  ))}
                </p>
              </PageBoundary.Provider>
            )}
          </QueryBoundary>
        </section>

        <aside
          aria-label="Review comments"
          className="space-y-4 pt-2 lg:sticky lg:top-14 lg:max-h-[calc(100vh-72px)] lg:self-start lg:overflow-y-auto"
        >
          {done && affectedIds.length > 0 ? (
            <WordingComment check={wording} quote={quote} flaggedId={flaggedId} />
          ) : null}
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
