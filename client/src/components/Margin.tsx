import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Skeleton, Textarea } from '@databricks/appkit-ui/react';
import { postGenieAsk } from '../data/api';
import type { ImpactRow, SignoffRow, WordingCheckResult } from '../data/types';
import { docLabel, formatSignedAt, plural } from '../lib/format';
import { DbxLink } from '../lib/presenter';
import { useAsync } from '../lib/useAsync';
import type { AsyncState } from '../lib/useAsync';
import { ErrorNote } from './QueryBoundary';

type Tone = 'neutral' | 'recomputed' | 'attention';

const TONE: Record<Tone, string> = {
  neutral: 'border-l-border',
  recomputed: 'border-l-recomputed',
  attention: 'border-l-attention',
};

/** A comment in the review margin: named author, short body, links at the bottom. */
export function MarginComment({
  author,
  via,
  tone = 'neutral',
  children,
  links,
}: {
  author: string;
  via?: string;
  tone?: Tone;
  children: ReactNode;
  links?: ReactNode;
}) {
  return (
    <article className={`rounded-[var(--radius)] border border-border border-l-4 bg-page p-4 ${TONE[tone]}`}>
      <header className="mb-2">
        <h2 className="text-sm font-semibold text-ink">{author}</h2>
        {via ? <p className="text-xs text-ink-muted">{via}</p> : null}
      </header>
      <div className="space-y-2 text-sm leading-snug text-ink">{children}</div>
      {links ? <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">{links}</div> : null}
    </article>
  );
}

/* Rows for the other documents. Label row moves to "Sent to Labelling" on recompute. */
export function OtherDocuments({ rows, recomputed }: { rows: ImpactRow[]; recomputed: boolean }) {
  if (rows.length === 0) return null;
  return (
    <MarginComment author="Other documents" via="Sentences that cite the same table" tone={recomputed ? 'recomputed' : 'neutral'}>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.sentence_id} className="py-2 first:pt-0 last:pb-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">
                {docLabel(r.doc_type, r.section)}, sentence {r.seq}
              </span>
              {r.kind === 'label' ? (
                <span className={recomputed ? 'text-attention' : 'text-ink-muted'}>
                  {recomputed ? 'Sent to Labelling' : 'Not yet sent'}
                </span>
              ) : (
                <span className={recomputed ? 'text-recomputed' : 'text-ink-muted'}>
                  {recomputed ? 'Recomputed' : 'Old figure'}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-ink-muted">
              {recomputed ? (
                <>
                  <s className="text-unchanged">{r.old_value}</s> <span className="text-ink">{r.new_value}</span>
                </>
              ) : (
                r.old_value
              )}
            </div>
          </li>
        ))}
      </ul>
    </MarginComment>
  );
}

export function WordingComment({
  check,
  quote,
  flaggedId,
}: {
  check: AsyncState<WordingCheckResult[]>;
  quote: (sentenceId: string) => string;
  flaggedId?: string;
}) {
  const links = (
    <>
      <DbxLink linkKey="beat3_endpoint" label="Model endpoint in Databricks" />
      <DbxLink linkKey="beat3_traces" label="MLflow traces in Databricks" />
    </>
  );
  const via = 'Claude Sonnet 5.5 via Unity Gateway';

  if (check.loading) {
    return (
      <MarginComment author="Wording check" via={via} links={links}>
        <p className="text-ink-muted">Checking wording</p>
        <Skeleton className="h-4 w-4/5" />
      </MarginComment>
    );
  }
  if (check.error) {
    return (
      <MarginComment author="Wording check" via={via} tone="attention" links={links}>
        <ErrorNote title="The wording check did not finish." detail={check.error} />
        <p className="text-ink-muted">The recomputed figures are not affected. Run the check again to see the wording result.</p>
        <Button variant="outline" size="sm" onClick={check.retry}>
          Check wording again
        </Button>
      </MarginComment>
    );
  }
  const results = check.data ?? [];
  if (results.length === 0) {
    return (
      <MarginComment author="Wording check" via={via} links={links}>
        <p className="text-ink-muted">No sentences were sent to the check.</p>
      </MarginComment>
    );
  }
  const flagged = results.filter((r) => r.verdict === 'needs_writer');
  const cached = results.some((r) => r.cached);
  return (
    <MarginComment author="Wording check" via={via} tone={flagged.length > 0 ? 'attention' : 'recomputed'} links={links}>
      <p>
        {plural(results.length, 'sentence', 'sentences')} checked against the new figures.{' '}
        {flagged.length === 0 ? 'The wording still holds in all of them.' : `${flagged.length} may no longer hold.`}
      </p>
      {flagged.map((r) => (
        <div key={r.sentence_id} id={flaggedId === r.sentence_id ? 'flag' : undefined} className="space-y-1">
          <p className="font-serif text-[15px] italic text-ink-muted">{quote(r.sentence_id)}</p>
          <p>{r.reason}</p>
          <p className="text-xs text-ink-muted">Sent to the writer for review.</p>
        </div>
      ))}
      <p className="text-xs text-ink-muted">
        <span className="font-mono">{results[0].model}</span>
        {cached ? ', cached result' : ''}
      </p>
    </MarginComment>
  );
}

export const SAMPLE_QUESTION =
  'How many participants in the treatment arm met the primary endpoint after the restatement?';

export function GenieComment() {
  const [question, setQuestion] = useState(SAMPLE_QUESTION);
  const [asked, setAsked] = useState<string | null>(null);
  const answer = useAsync(() => postGenieAsk(asked ?? ''), asked !== null);

  return (
    <MarginComment
      author="Genie Agent"
      via="Regsub Review: LMN-301 certified tables"
      links={<DbxLink linkKey="beat4_genie" label="Genie Agent in Databricks" />}
    >
      <Textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={3}
        className="resize-none bg-page text-sm"
        aria-label="Question for the Genie Agent"
      />
      <Button
        size="sm"
        variant="outline"
        disabled={question.trim() === '' || answer.loading}
        onClick={() => {
          setAsked(question.trim());
          if (asked !== null) answer.retry();
        }}
      >
        Ask
      </Button>
      {asked !== null && answer.loading ? <p className="text-ink-muted">Asking the Genie Agent</p> : null}
      {answer.error ? (
        <>
          <ErrorNote title="The Genie Agent did not answer." detail={answer.error} />
          <Button size="sm" variant="outline" onClick={answer.retry}>
            Ask again
          </Button>
        </>
      ) : null}
      {answer.data ? (
        answer.data.answer_text.trim() === '' ? (
          <p className="text-ink-muted">The Genie Agent returned no answer. Rephrase the question and ask again.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-base font-semibold">{answer.data.answer_text}</p>
            <details className="group">
              <summary className="cursor-pointer text-xs text-cited underline underline-offset-4">Show SQL</summary>
              <pre className="mt-2 overflow-x-auto rounded-[var(--radius)] bg-muted p-2 font-mono text-xs leading-relaxed">
                {answer.data.sql}
              </pre>
            </details>
            <p className="text-xs text-ink-muted">
              Generated from the certified tables. Check the SQL before you rely on it.
            </p>
          </div>
        )
      ) : null}
    </MarginComment>
  );
}

export function ApproveComment({
  figureCount,
  ready,
  approving,
  approveError,
  onApprove,
  signoff,
  signoffLoading,
  signoffError,
}: {
  figureCount: number;
  ready: boolean;
  approving: boolean;
  approveError: string | null;
  onApprove: () => void;
  signoff: SignoffRow | null;
  signoffLoading: boolean;
  signoffError: string | null;
}) {
  const links = <DbxLink linkKey="beat4_signoffs" label="Sign-off table in Databricks" />;

  if (signoffLoading) {
    return (
      <MarginComment author="Sign-off" links={links}>
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
      </MarginComment>
    );
  }
  if (signoff) {
    return (
      <MarginComment author="Sign-off" tone="recomputed" links={links}>
        <p className="font-medium">Approved {plural(figureCount, 'figure', 'figures')}.</p>
        <p className="text-ink-muted">
          {signoff.reviewer}, {formatSignedAt(signoff.signed_at)}
        </p>
      </MarginComment>
    );
  }
  return (
    <MarginComment author="Sign-off" links={links}>
      <p className="text-ink-muted">
        {ready
          ? 'Approve the recomputed figures once the Genie Agent answer matches.'
          : 'Recompute the figures from source before you approve them.'}
      </p>
      {approveError ? <ErrorNote title="The sign-off was not recorded." detail={approveError} /> : null}
      {signoffError ? <ErrorNote title="The sign-off could not be read back." detail={signoffError} /> : null}
      <Button size="sm" disabled={!ready || approving || figureCount === 0} onClick={onApprove}>
        {approving ? 'Recording sign-off' : `Approve ${plural(figureCount, 'figure', 'figures')}`}
      </Button>
    </MarginComment>
  );
}
