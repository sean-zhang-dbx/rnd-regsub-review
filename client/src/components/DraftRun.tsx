import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@databricks/appkit-ui/react';
import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { streamDraftRun } from '../data/api';
import type { DraftPart, DraftResult, DraftRunEvent, DraftStepId, SourcePage } from '../data/types';
import { CELL_LABEL, FIG_CELL, TLF } from '../lib/format';
import { DbxLink } from '../lib/presenter';
import { MarginComment } from './Margin';
import { ParsedPage } from './ParsedPage';

const STEPS: { id: DraftStepId; title: string }[] = [
  { id: 'read_sources', title: 'Read the protocol and SAP' },
  { id: 'find_table', title: 'Find the certified table' },
  { id: 'draft', title: 'Draft the sentences' },
  { id: 'fill', title: 'Fill the figures with SQL' },
  { id: 'check', title: 'Check the draft' },
];

type StepState = { status: 'running' | 'done' | 'error'; ms?: number; error?: string; detail?: Record<string, unknown> };

function Chip({ part, version, onFocus }: { part: Extract<DraftPart, { slot: string }>; version: number; onFocus: (k: string | null) => void }) {
  const cell = FIG_CELL[part.slot];
  return (
    <span
      onMouseEnter={() => onFocus(part.slot)}
      onMouseLeave={() => onFocus(null)}
      title={`${TLF.efficacy_primary}, ${cell?.row ?? ''}, ${CELL_LABEL[cell?.column ?? ''] ?? part.slot}, version ${version}`}
      className="rounded-[2px] bg-cited-soft px-0.5 font-medium text-cited"
    >
      {part.value}
    </span>
  );
}

function Placeholders({ template }: { template: string }) {
  return (
    <>
      {template.split(/(\{\w+\})/g).map((t, i) =>
        /^\{\w+\}$/.test(t) ? (
          <span key={i} className="rounded-[2px] bg-muted px-0.5 font-mono text-[11px] text-ink-muted">
            {t}
          </span>
        ) : (
          <span key={i}>{t}</span>
        ),
      )}
    </>
  );
}

/**
 * Drafting run in the Information panel: the steps stream in from /api/draft-run. The parsed SAP page is
 * shown large in the middle pane after step 1, and the table pane returns (at version 3) once the figures are filled.
 */
export function DraftRun({
  section,
  onFocus,
  onShowSource,
  onFilled,
}: {
  section: string;
  onFocus: (figKey: string | null) => void;
  onShowSource: (page: SourcePage | null) => void;
  onFilled: (sourceVersion: number) => void;
}) {
  const [steps, setSteps] = useState<Partial<Record<DraftStepId, StepState>>>({});
  const [result, setResult] = useState<DraftResult | null>(null);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [sources, setSources] = useState<SourcePage[]>([]);
  const listRef = useRef<HTMLOListElement | null>(null);

  /* Keep the newest step in view while the run streams in. */
  useEffect(() => {
    const items = listRef.current?.querySelectorAll('li[data-state]');
    items?.[items.length - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [steps]);

  async function run() {
    setSteps({});
    setResult(null);
    setFailed(null);
    setRunning(true);
    try {
      await streamDraftRun(section, (e: DraftRunEvent) => {
        if (e.step === 'done') {
          if (e.status === 'error') setFailed(e.error ?? 'The run did not finish.');
          if (e.result) setResult(e.result);
          return;
        }
        setSteps((s) => ({ ...s, [e.step]: { status: e.status, ms: e.ms, error: e.error, detail: e.detail } }));
        if (e.step === 'read_sources' && e.status === 'done') {
          const src = (e.detail?.sources as SourcePage[] | undefined) ?? [];
          setSources(src);
          onShowSource(src.find((p) => /Statistical Analysis Plan/.test(p.doc_title)) ?? src[0] ?? null);
        }
        if (e.step === 'fill' && e.status === 'done') {
          onShowSource(null);
          onFilled(3);
        }
      });
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'The run did not finish.');
    } finally {
      setRunning(false);
    }
  }

  const started = Object.keys(steps).length > 0;
  const judge = steps.check?.detail?.judge as { verdict: string; reason: string; model: string } | undefined;
  const typed = (steps.check?.detail?.typed_numbers as string[] | undefined) ?? [];
  const tone = result ? (typed.length > 0 || judge?.verdict === 'no' ? 'attention' : 'recomputed') : 'neutral';

  return (
    <MarginComment
      author="Drafting workflow"
      via="Claude Sonnet 5.5 via Unity Gateway, checked by GPT 5.5"
      tone={tone}
      links={
        <>
          <DbxLink linkKey="beat3_traces" label="MLflow trace of the run" />
          <DbxLink linkKey="beat2_parsed" label="Parsed documents in Databricks" />
          <DbxLink linkKey="beat2_drafts" label="Stored drafts in Databricks" />
        </>
      }
    >
      {!started ? (
        <p>
          The workflow reads the protocol and SAP, finds the certified table and drafts this section. The model gets no
          values: it writes a placeholder for each figure, and SQL fills it in from {TLF.efficacy_primary}.
        </p>
      ) : null}
      {started ? (
        <ol ref={listRef} className="space-y-2.5">
          {STEPS.map((s) => {
            const st = steps[s.id];
            return (
              <li key={s.id} data-state={st ? st.status : undefined} className={st ? '' : 'text-ink-muted'}>
                <div className="flex items-center gap-2">
                  {st?.status === 'done' ? (
                    <Check className="size-4 shrink-0 text-recomputed" aria-label="done" />
                  ) : st?.status === 'error' ? (
                    <CircleAlert className="size-4 shrink-0 text-attention" aria-label="failed" />
                  ) : st?.status === 'running' ? (
                    <LoaderCircle className="size-4 shrink-0 animate-spin text-cited" aria-label="running" />
                  ) : (
                    <span className="inline-block size-4 shrink-0 rounded-full border border-line" aria-hidden="true" />
                  )}
                  <span className="font-medium">{s.title}</span>
                  {st?.ms !== undefined ? <span className="ml-auto text-xs text-ink-muted">{(st.ms / 1000).toFixed(1)} s</span> : null}
                </div>
                {st?.status === 'error' ? <p className="ml-6 text-xs text-attention">{st.error}</p> : null}
                {st?.status === 'done' ? (
                  <div className="ml-6 mt-1 space-y-1.5 text-[13px] leading-snug">
                    <StepDetail id={s.id} detail={st.detail ?? {}} sources={sources} onShowSource={onShowSource} onFocus={onFocus} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {failed ? <p className="text-attention">{failed}</p> : null}
      {result?.cached ? <p className="text-xs text-ink-muted">Stored draft. The model did not answer in time.</p> : null}
      {!running ? (
        <Button size="sm" variant="outline" onClick={() => void run()}>
          {started ? 'Draft again' : 'Draft this section'}
        </Button>
      ) : null}
    </MarginComment>
  );
}

function StepDetail({
  id,
  detail,
  sources,
  onShowSource,
  onFocus,
}: {
  id: DraftStepId;
  detail: Record<string, unknown>;
  sources: SourcePage[];
  onShowSource: (p: SourcePage | null) => void;
  onFocus: (k: string | null) => void;
}): ReactNode {
  if (id === 'read_sources') {
    return (
      <>
        <div className="flex gap-2">
          {sources.map((p) => (
            <button
              key={`${p.file_path}-${p.page}`}
              type="button"
              onClick={() => onShowSource(p)}
              className="w-[46%] text-left"
              title={`Open ${p.doc_title}, page ${p.page}`}
            >
              <ParsedPage page={p} compact />
              <span className="mt-1 block text-[11px] leading-tight text-ink-muted">
                {p.doc_title.replace('LMN-301 ', '')}, p. {p.page}
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">Located by ai_parse_document. Click a page to open it here, or see the whole document in Document parsing.</p>
      </>
    );
  }
  if (id === 'find_table') {
    const tags = (detail.tags as { name: string; value: string }[] | undefined) ?? [];
    const cert = tags.find((t) => t.name === 'system.certification_status');
    return (
      <p>
        {String(detail.tlf)} (<span className="font-mono text-xs">efficacy_primary</span>), version {String(detail.version)}
        {cert ? `, ${cert.value} in Unity Catalog` : ''}.
      </p>
    );
  }
  if (id === 'draft') {
    const templates = (detail.templates as string[] | undefined) ?? [];
    return (
      <>
        <ol className="list-decimal space-y-1 pl-4 font-serif text-[13.5px]">
          {templates.map((t, i) => (
            <li key={i}>
              <Placeholders template={t} />
            </li>
          ))}
        </ol>
        <p className="text-xs text-ink-muted">The model wrote a placeholder for each figure.</p>
      </>
    );
  }
  if (id === 'fill') {
    const sentences = (detail.sentences as { parts: DraftPart[] }[] | undefined) ?? [];
    return (
      <>
        <ol className="list-decimal space-y-1 pl-4 font-serif text-[13.5px]">
          {sentences.map((s, i) => (
            <li key={i}>
              {s.parts.map((p, j) => ('slot' in p ? <Chip key={j} part={p} version={3} onFocus={onFocus} /> : <span key={j}>{p.text}</span>))}
            </li>
          ))}
        </ol>
        <p className="text-xs text-ink-muted">
          {String(detail.figure_count)} figures filled from {TLF.efficacy_primary} version 3.
        </p>
      </>
    );
  }
  if (id === 'check') {
    const typed = (detail.typed_numbers as string[] | undefined) ?? [];
    const judge = detail.judge as { verdict: string; reason: string; model: string } | undefined;
    return (
      <>
        <p>
          <span className="font-medium">Code check: </span>
          {typed.length === 0 ? 'the model typed no figures itself.' : `the model typed ${typed.join(', ')} itself.`}
        </p>
        {judge ? (
          <p>
            <span className="font-medium">Judge ({judge.model}): </span>
            {judge.verdict === 'yes'
              ? 'consistent with the protocol and SAP. '
              : judge.verdict === 'no'
                ? 'found a problem. '
                : 'did not answer. '}
            <span className="text-ink-muted">{judge.reason}</span>
          </p>
        ) : null}
      </>
    );
  }
  return null;
}
