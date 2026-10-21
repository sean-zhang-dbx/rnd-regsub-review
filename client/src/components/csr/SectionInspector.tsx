/* Lists here are append-only or fixed per render and have no stable ids, so index keys are correct. */
/* eslint-disable react/no-array-index-key */
import { CircleCheck, CircleX, RotateCcw } from 'lucide-react';
import { Button } from '@databricks/appkit-ui/react';
import type { CsrSection, SourceRef } from '../../data/csr';
import { DbxLink, linkFor } from '../../lib/presenter';
import { shortDoc } from './model';

/* Presenter link keys read from config/demo-links.json; a missing key shows no link. */
export function ConfigLink({ keys, label }: { keys: string[]; label: string }) {
  const key = keys.find((k) => linkFor(k));
  return key ? <DbxLink linkKey={key} label={label} /> : null;
}

function Block({ title, children, count }: { title: string; children: React.ReactNode; count?: number }) {
  return (
    <section className="border-b border-line px-4 py-3">
      <h3 className="mb-1.5 flex items-center text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
        {title}
        {count !== undefined ? <span className="ml-auto font-normal normal-case">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function uniqueSources(sec: CsrSection): SourceRef[] {
  const seen = new Set<string>();
  const out: SourceRef[] = [];
  for (const s of sec.sentences)
    for (const r of s.sources) {
      const k = r.kind === 'passage' ? `p${r.doc_title}${r.page}${r.element_id}` : r.kind === 'tlf' ? `t${r.table}` : 'w';
      if (!seen.has(k)) {
        seen.add(k);
        out.push(r);
      }
    }
  return out;
}

export function SectionInspector({ sec, busy, onRedraft }: { sec: CsrSection | null; busy: boolean; onRedraft: (section: string) => void }) {
  if (!sec) return <p className="p-4 text-sm text-ink-muted">Select a section to see its sources, checks and tool calls.</p>;
  const sources = uniqueSources(sec);
  const drafted = sec.kind === 'drafted' || sec.kind === 'narrative';
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-line px-4 py-3">
        <div className="text-[11px] text-ink-muted">Section {sec.section}</div>
        <h2 className="text-[15px] leading-snug font-semibold text-ink">{sec.title}</h2>
        <div className="mt-0.5 text-xs text-ink-muted">Acts for {sec.department}</div>
        {drafted ? (
          <Button size="sm" variant="outline" className="mt-2" disabled={busy} onClick={() => onRedraft(sec.section)}>
            <RotateCcw className="mr-1 size-3.5" />
            Redraft this section
          </Button>
        ) : (
          <p className="mt-1.5 text-xs text-ink-muted">Assembled from certified tables and boilerplate, with no model call.</p>
        )}
      </div>

      <Block title="Sources" count={sources.length}>
        {sources.length === 0 ? (
          <p className="text-[13px] text-ink-muted">None recorded.</p>
        ) : (
          <ul className="space-y-2">
            {sources.map((r, i) => (
              <li key={i} className="text-[13px] text-ink">
                {r.kind === 'passage' ? (
                  <>
                    <span className="font-medium">
                      {shortDoc(r.doc_title)}, page {r.page}
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-ink-muted italic">&ldquo;{r.quote}&rdquo;</span>
                  </>
                ) : r.kind === 'tlf' ? (
                  <>
                    <span className="font-medium">{r.tlf}</span>
                    <span className="block font-mono text-[11px] text-ink-muted">{r.table}</span>
                    <ConfigLink keys={[`csr_tlf_${r.table}`]} label="Table in Catalog Explorer" />
                  </>
                ) : (
                  <span className="font-medium">Written by the report writer</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Checks" count={sec.checks.length}>
        {sec.checks.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No checks run on this section.</p>
        ) : (
          <ul className="space-y-1">
            {sec.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-1.5 text-[13px] text-ink">
                {c.ok ? <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-recomputed" aria-label="passed" /> : <CircleX className="mt-0.5 size-3.5 shrink-0 text-attention" aria-label="failed" />}
                <span>
                  {c.label}
                  {c.detail ? <span className="block text-[11.5px] text-ink-muted">{c.detail}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      {drafted ? (
        <Block title="Judge">
          {sec.judge ? (
            <div className="text-[13px] text-ink">
              <span className={`mr-1.5 rounded-[3px] px-1.5 py-px text-[11px] font-medium ${sec.judge.verdict === 'yes' ? 'bg-recomputed-soft text-recomputed' : sec.judge.verdict === 'no' ? 'bg-attention-soft text-attention' : 'bg-open-soft text-ink-muted'}`}>
                {sec.judge.verdict === 'yes' ? 'Consistent' : sec.judge.verdict === 'no' ? 'Not consistent' : 'Unavailable'}
              </span>
              {sec.judge.reason}
              <span className="mt-0.5 block text-[11px] text-ink-muted">{sec.judge.model}</span>
            </div>
          ) : (
            <p className="text-[13px] text-ink-muted">No judge verdict.</p>
          )}
        </Block>
      ) : null}

      <Block title="Needs a person" count={sec.needs_person.length}>
        {sec.needs_person.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Nothing is waiting for a person.</p>
        ) : (
          <ul className="space-y-1.5">
            {sec.needs_person.map((n, i) => (
              <li key={i} className="rounded-[var(--radius)] bg-attention-soft px-2 py-1.5 text-[13px] text-ink">
                {n.sentence_idx !== undefined ? <span className="mr-1 font-medium text-attention">Sentence {n.sentence_idx + 1}.</span> : null}
                {n.reason}
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Agent tool calls" count={sec.tool_log.length}>
        {sec.tool_log.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No agent was involved.</p>
        ) : (
          <ol className="space-y-1">
            {sec.tool_log.map((t, i) => (
              <li key={i} className={`rounded-[var(--radius)] px-2 py-1 text-[12px] ${t.ok ? 'bg-page ring-1 ring-line' : 'bg-attention-soft ring-1 ring-attention/40'}`}>
                <span className={`font-mono font-medium ${t.ok ? 'text-ink' : 'text-attention'}`}>{t.tool}</span>
                <span className="ml-1.5 text-[10.5px] text-ink-muted">{t.ms} ms</span>
                <span className={`block ${t.ok ? 'text-ink-muted' : 'font-medium text-attention'}`}>{t.ok ? t.result_summary : `Rejected: ${t.result_summary}`}</span>
              </li>
            ))}
          </ol>
        )}
      </Block>
    </div>
  );
}
