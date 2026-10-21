/* Lists here are append-only or fixed per render and have no stable ids, so index keys are correct. */
/* eslint-disable react/no-array-index-key */
import { useEffect, useRef } from 'react';
import { CircleCheck, TriangleAlert, X } from 'lucide-react';
import type { CsrDocument, PodMember } from '../../data/csr';
import { AGENT_LABEL, toolsFor } from './model';
import type { RunLive, ToolEntry } from './model';

function argsText(args: unknown): string {
  if (args === null || args === undefined) return '';
  if (typeof args === 'string') return args;
  try {
    const t = JSON.stringify(args);
    return t.length > 140 ? `${t.slice(0, 139)}…` : t;
  } catch {
    return '';
  }
}

function ToolRow({ t, reason }: { t: ToolEntry; reason: boolean }) {
  const bad = !t.ok;
  return (
    <li className={`rounded-[var(--radius)] border px-2.5 py-1.5 ${bad ? 'border-attention/50 bg-attention-soft' : 'border-line bg-page'}`}>
      <div className="flex items-center gap-1.5">
        {bad ? <TriangleAlert className="size-3.5 shrink-0 text-attention" aria-label="rejected" /> : <CircleCheck className="size-3.5 shrink-0 text-recomputed" aria-label="ok" />}
        <span className={`font-mono text-[12px] font-medium ${bad ? 'text-attention' : 'text-ink'}`}>{t.tool}</span>
        {t.section ? <span className="text-[11px] text-ink-muted">{t.section}</span> : null}
        <span className="ml-auto text-[10.5px] text-ink-muted">{t.ms} ms</span>
      </div>
      {argsText(t.args) ? <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-muted">{argsText(t.args)}</div> : null}
      {bad ? <div className="mt-1 text-[12px] font-medium text-attention">Rejected: {t.result_summary}</div> : reason ? <div className="mt-0.5 text-[11.5px] text-recomputed">Corrected save accepted. {t.result_summary}</div> : <div className="mt-0.5 text-[11.5px] text-ink-muted">{t.result_summary}</div>}
    </li>
  );
}

export function AgentDrawer({ member, live, doc, onClose }: { member: PodMember; live: RunLive; doc: CsrDocument | null; onClose: () => void }) {
  const tools = toolsFor(member.id, live, doc);
  const logs = live.logs.filter((l) => l.agent === member.id);
  const state = live.agents[member.id];
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (live.status === 'running') endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [tools.length, live.status]);

  /* A save that follows a rejected save of the same section is the corrected one. */
  const corrected = (t: ToolEntry, i: number) => t.ok && t.tool === 'save_csr_draft' && tools.slice(0, i).some((p) => !p.ok && p.tool === t.tool && p.section === t.section);

  return (
    <aside role="dialog" aria-label={`${member.title} details`} className="fixed top-0 right-0 z-40 flex h-full w-[440px] max-w-full flex-col border-l border-line bg-desk shadow-page">
      <header className="flex items-start gap-2 border-b border-line bg-page px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">{member.title}</h2>
          {member.actsFor ? <p className="text-xs text-ink-muted">Acts for {member.actsFor}</p> : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-ink-muted hover:bg-desk">
          <X className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {member.note ? <p className="text-sm text-ink">{member.note}</p> : null}
        {state && state.status !== 'idle' ? (
          <p className="text-sm text-ink-muted">
            {state.status === 'running' ? 'Running' : state.status === 'done' ? 'Done' : 'Error'}
            {state.progress ? `, ${state.progress.done} of ${state.progress.total}` : ''}
            {state.summary ? `. ${state.summary}` : ''}
          </p>
        ) : null}
        {member.how ? (
          <section>
            <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">How: skill</h3>
            <div className="rounded-[var(--radius)] border border-line bg-page p-3">
              <div className="mb-1 flex items-center gap-1.5 font-mono text-[12px] font-medium text-ink">
                <span className="size-1.5 rounded-full bg-kit-skill" />
                {member.how.name}
              </div>
              <p className="text-[13px] leading-relaxed whitespace-pre-line text-ink">{member.how.text}</p>
            </div>
          </section>
        ) : null}
        {member.acts?.length ? (
          <section>
            <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Acts: tools it can call</h3>
            <div className="flex flex-wrap gap-1.5">
              {member.acts.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 rounded-[3px] bg-page px-1.5 py-0.5 font-mono text-[11.5px] text-ink ring-1 ring-line">
                  <span className="size-1.5 rounded-full bg-kit-tool" />
                  {a}
                </span>
              ))}
            </div>
          </section>
        ) : null}
        {member.calls?.length ? (
          <section>
            <h3 className="mb-1 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Calls</h3>
            <ul className="space-y-1 text-[13px] text-ink">
              {member.calls.map((c) => (
                <li key={c} className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full bg-kit-agent" />
                  {c}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {member.kind === 'agent' ? (
          <section>
            <h3 className="mb-1 flex items-center text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
              Tool calls{live.runId ? ' (live)' : ' (last run)'}
              <span className="ml-auto font-normal normal-case">{tools.length}</span>
            </h3>
            {tools.length === 0 ? (
              <p className="text-[13px] text-ink-muted">No tool calls yet. Draft the whole CSR to watch {AGENT_LABEL[member.id] ?? member.title} work.</p>
            ) : (
              <ol className="space-y-1.5">
                {tools.map((t, i) => (
                  <ToolRow key={`${t.tool}-${t.section ?? ''}-${i}`} t={t} reason={corrected(t, i)} />
                ))}
              </ol>
            )}
            {logs.length ? (
              <ul className="mt-2 space-y-1 text-[12px] text-ink-muted">
                {logs.map((l, i) => (
                  <li key={i}>{l.text}</li>
                ))}
              </ul>
            ) : null}
            <div ref={endRef} />
          </section>
        ) : null}
      </div>
    </aside>
  );
}
