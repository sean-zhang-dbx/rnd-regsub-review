import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Textarea } from '@databricks/appkit-ui/react';
import { postDraftSection, postGenieAsk } from '../data/api';
import type { GenieAnswer, WordingCheckResult } from '../data/types';
import { CELL_LABEL, FIG_CELL, formatClock, formatDay, TLF, WORDING_SERVICE } from '../lib/format';
import { DbxLink } from '../lib/presenter';
import { useAsync } from '../lib/useAsync';
import type { AsyncState } from '../lib/useAsync';
import { ErrorNote } from './QueryBoundary';

type Tone = 'neutral' | 'recomputed' | 'attention';

const TONE: Record<Tone, string> = {
  neutral: 'border-l-transparent',
  recomputed: 'border-l-recomputed',
  attention: 'border-l-attention',
};

/** A section of the viewer's Information panel: named author, short body, links at the bottom. */
export function MarginComment({
  author,
  via,
  tone = 'neutral',
  children,
  links,
  id,
}: {
  id?: string;
  author: string;
  via?: string;
  tone?: Tone;
  children: ReactNode;
  links?: ReactNode;
}) {
  return (
    <article id={id} className={`scroll-mt-2 border-b border-l-[3px] border-b-line px-4 py-4 ${TONE[tone]}`}>
      <header className="mb-2">
        <h2 className="text-sm font-semibold text-ink">{author}</h2>
        {via ? <p className="text-xs text-ink-muted">{via}</p> : null}
      </header>
      <div className="space-y-2 text-sm text-ink [&_p]:leading-5">{children}</div>
      {links ? <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">{links}</div> : null}
    </article>
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
      <DbxLink linkKey="beat3_endpoint" label="Gateway inference table" />
      <DbxLink linkKey="beat3_traces" label="MLflow traces in Databricks" />
    </>
  );
  const via = 'Claude Sonnet 5.5 via Unity Gateway';

  if (check.loading) {
    return (
      <MarginComment author="Wording check" via={via} links={links}>
        <p className="text-ink-muted">Checking wording</p>
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
      {flagged.length === 0 ? <p>The wording still holds wherever a figure changed.</p> : null}
      {flagged.map((r) => (
        <div key={r.sentence_id} id={flaggedId === r.sentence_id ? 'flag' : undefined} className="space-y-1">
          <p className="line-clamp-2 font-serif text-[15px] italic leading-snug text-ink-muted" title={quote(r.sentence_id)}>
            {quote(r.sentence_id)}
          </p>
          <p>{r.reason}</p>
        </div>
      ))}
      <p className="text-xs text-ink-muted">
        <span className="font-mono" title={WORDING_SERVICE}>
          wording_check
        </span>{' '}
        via Unity Gateway
        {cached ? ' Cached result.' : ''}
      </p>
    </MarginComment>
  );
}

/** Sections the drafting model has an outline for (server/routes/draftSection.ts). */
export const DRAFTABLE = new Set(['11.4.1', '2.7.3']);

export function DraftComment({
  section,
  onFocus,
  onDrafted,
}: {
  section: string;
  onFocus: (figKey: string | null) => void;
  onDrafted: (sourceVersion: number) => void;
}) {
  const [run, setRun] = useState(0);
  const draft = useAsync(() => postDraftSection(section), run > 0);
  const d = draft.data;

  /* Show the table at the version the draft was written against, so the chips match its cells. */
  useEffect(() => {
    if (d) onDrafted(d.source_version);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  const via = 'Claude Sonnet 5.5 via Unity Gateway';
  const links = (
    <>
      <DbxLink linkKey="beat3_traces" label="MLflow traces in Databricks" />
      <DbxLink linkKey="beat2_drafts" label="Stored drafts in Databricks" />
    </>
  );
  const typed = d?.typed_numbers ?? [];
  return (
    <MarginComment author="Drafting" via={via} tone={d ? (typed.length > 0 ? 'attention' : 'recomputed') : 'neutral'} links={links}>
      {!d ? (
        <p>
          The model drafts this section from its outline and writes a placeholder for each figure. SQL fills each one in
          from {TLF.efficacy_primary}, so every figure is tied to its cell from the start.
        </p>
      ) : null}
      {draft.loading ? <p className="text-ink-muted">Drafting from the outline</p> : null}
      {draft.error ? <ErrorNote title="The draft did not finish." detail={draft.error} /> : null}
      {d ? (
        <>
          <ol className="list-decimal space-y-1.5 pl-4 font-serif text-[14px] leading-snug">
            {d.sentences.map((s, i) => (
              <li key={i}>
                {s.parts.map((p, j) =>
                  'slot' in p ? (
                    <span
                      key={j}
                      onMouseEnter={() => onFocus(p.slot)}
                      onMouseLeave={() => onFocus(null)}
                      title={`${TLF.efficacy_primary}, ${FIG_CELL[p.slot]?.row ?? ''}, ${CELL_LABEL[FIG_CELL[p.slot]?.column ?? ''] ?? p.slot}, version ${d.source_version}`}
                      className="rounded-[2px] bg-cited-soft px-0.5 font-medium text-cited"
                    >
                      {p.value}
                    </span>
                  ) : (
                    <span key={j}>{p.text}</span>
                  ),
                )}
              </li>
            ))}
          </ol>
          <p>
            {d.figure_count} figures, each filled from a cell of {TLF.efficacy_primary} version {d.source_version}.{' '}
            {typed.length === 0
              ? 'The model typed no figures itself.'
              : `The model typed ${typed.join(', ')} itself, so ${typed.length === 1 ? 'that number is' : 'those numbers are'} not tied to a cell.`}
          </p>
          {d.cached ? <p className="text-xs text-ink-muted">Stored draft. The model did not answer in time.</p> : null}
        </>
      ) : null}
      {!draft.loading ? (
        <Button size="sm" variant="outline" onClick={() => setRun((n) => n + 1)}>
          {d || draft.error ? 'Draft again' : 'Draft this section'}
        </Button>
      ) : null}
    </MarginComment>
  );
}

export const SAMPLE_QUESTION =
  'How many participants in the treatment arm met the primary endpoint after the restatement?';

function stripMarkdown(t: string): string {
  return t
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/(\*\*|__|\*|`)/g, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Headline: the figure the reviewer asked for. Falls back to the first sentence of the answer. */
function scalar(v: unknown): string | null {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
}

function answerParts(a: GenieAnswer): { head: string; note: string } {
  const text = stripMarkdown(a.answer_text);
  const r = a.rows[0];
  const resp = scalar(r?.responders);
  const n = scalar(r?.n);
  if (resp !== null && n !== null) {
    const pct = Number(scalar(r?.rate_pct));
    const rate = Number.isNaN(pct) || scalar(r?.rate_pct) === null ? '' : ` (${pct.toFixed(1)}%)`;
    return { head: `${resp} of ${n}${rate}`, note: text };
  }
  const m = /(\d+) of (\d+)(?: participants)?(?: \(([\d.]+)%\))?/.exec(text);
  if (m) return { head: m[3] ? `${m[1]} of ${m[2]} (${m[3]}%)` : `${m[1]} of ${m[2]}`, note: text };
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return { head: first, note: text === first ? '' : text };
}

export function GenieComment({ onAnswered }: { onAnswered: () => void }) {
  const [question, setQuestion] = useState(SAMPLE_QUESTION);
  const [asked, setAsked] = useState<string | null>(null);
  const answer = useAsync(() => postGenieAsk(asked ?? ''), asked !== null);
  const hasAnswer = !!answer.data && answer.data.answer_text.trim() !== '';

  useEffect(() => {
    if (hasAnswer) onAnswered();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAnswer]);

  const parts = answer.data && hasAnswer ? answerParts(answer.data) : null;

  return (
    <MarginComment
      author="Genie Agent"
      via="Regsub Review: LMN-301 certified tables"
      links={<DbxLink linkKey="beat4_genie" label="Genie Agent in Databricks" />}
    >
      <Textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={2}
        className="resize-none bg-page text-[13px] leading-snug md:text-[13px]"
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
      {answer.data && !hasAnswer ? (
        <p className="text-ink-muted">The Genie Agent returned no answer. Rephrase the question and ask again.</p>
      ) : null}
      {parts && answer.data ? (
        <div className="mt-3 space-y-1.5">
          <p className="text-lg font-semibold leading-tight">{parts.head}</p>
          {parts.note ? (
            <p className="line-clamp-3 text-[13px] leading-snug text-ink-muted" title={parts.note}>
              {parts.note}
            </p>
          ) : null}
          <details>
            <summary className="cursor-pointer text-xs text-cited underline underline-offset-4">Show SQL</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-[var(--radius)] bg-muted p-2 font-mono text-xs leading-relaxed">
              {answer.data.sql}
            </pre>
          </details>
          <p className="text-[13px] text-ink-muted">Generated from the certified tables.</p>
        </div>
      ) : null}
    </MarginComment>
  );
}

export function ApproveComment({
  figureCount,
  recomputed,
  answered,
  approving,
  approveError,
  onApprove,
  approved,
  version,
}: {
  figureCount: number;
  recomputed: boolean;
  answered: boolean;
  approving: boolean;
  approveError: string | null;
  onApprove: () => void;
  approved: { reviewer: string; signed_at: string } | null;
  version: number | null;
}) {
  const links = <DbxLink linkKey="beat4_signoffs" label="Sign-off table in Databricks" />;

  if (approved) {
    return (
      <MarginComment id="signoff" author="Sign-off" tone="recomputed" links={links}>
        <p className="font-medium">
          Approved by {approved.reviewer} at {formatClock(approved.signed_at)} on {formatDay(approved.signed_at)}
          {version !== null ? `, against table version ${version}` : ''}.
        </p>
      </MarginComment>
    );
  }
  const ready = recomputed && answered;
  return (
    <MarginComment id="signoff" author="Sign-off" links={links}>
      <p className="text-ink-muted">
        {!recomputed
          ? 'Recompute the figures from source before you approve them.'
          : !answered
            ? 'Ask the Genie Agent to confirm the figures, then approve them.'
            : 'The Genie Agent has answered. Approve the recomputed figures.'}
      </p>
      {approveError ? <ErrorNote title="The sign-off was not recorded." detail={approveError} /> : null}
      <Button size="sm" disabled={!ready || approving || figureCount === 0} onClick={onApprove}>
        {approving ? 'Recording sign-off' : 'Approve the recomputed figures'}
      </Button>
    </MarginComment>
  );
}
