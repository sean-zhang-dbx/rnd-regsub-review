/* Tool calls have no ids and the list is append-only, so index keys are correct. */
/* eslint-disable react/no-array-index-key */
import { useState } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@databricks/appkit-ui/react';
import { cn } from '@/lib/utils';
import type { CsrDocument, PodMember, SourceRef } from '../../data/types';
import { shortDoc, stateFor, toolsFor } from './model';
import type { RunLive, ToolEntry } from './model';

/* The agent drawer: its skill, its tools, the calls it made, and the passages it chose. Light surface (the app, not the X-ray). */

function argsText(args: unknown): string {
  if (args === null || args === undefined) return '';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args);
  } catch {
    return '';
  }
}

/** The AI Search query text of a search call, if the call has one. */
function queryOf(args: unknown): string | null {
  if (args && typeof args === 'object') {
    const q = (args as Record<string, unknown>).query;
    if (typeof q === 'string') return q;
  }
  return null;
}

function ToolRow({ t }: { t: ToolEntry }) {
  const q = queryOf(t.args);
  return (
    <li className={cn('rounded-control border px-3 py-2', t.ok ? 'border-border bg-card' : 'border-differs/50 bg-differs/[0.06]')}>
      <div className="flex items-baseline gap-2">
        <span className={cn('num text-[13px] font-medium', !t.ok && 'text-differs')}>{t.tool}</span>
        {t.section ? <span className="text-[12px] text-muted-foreground">section {t.section}</span> : null}
        <span className="num ml-auto text-[12px] text-muted-foreground">{t.ms} ms</span>
      </div>
      {q ? <p className="mt-1 text-[14px]">&ldquo;{q}&rdquo;</p> : argsText(t.args) ? <p className="num mt-0.5 truncate text-[12px] text-muted-foreground">{argsText(t.args)}</p> : null}
      <p className={cn('mt-0.5 text-[13px]', t.ok ? 'text-muted-foreground' : 'font-medium text-differs')}>{t.ok ? t.result_summary : `Turned back: ${t.result_summary}`}</p>
    </li>
  );
}

const TOOL_CAP = 6;

/** The calls the agent made in this run: the first 6, the rest behind a toggle. */
function ToolList({ tools }: { tools: ToolEntry[] }) {
  const [all, setAll] = useState(false);
  if (tools.length === 0) return <p className="text-[14px] text-muted-foreground">No tool calls recorded for this agent in this run.</p>;
  const shown = all ? tools : tools.slice(0, TOOL_CAP);
  return (
    <>
      <ol className="space-y-1.5">
        {shown.map((t, i) => (
          <ToolRow key={`${t.tool}-${t.section ?? ''}-${i}`} t={t} />
        ))}
      </ol>
      {tools.length > TOOL_CAP ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="mt-2 text-[13px] font-medium text-primary underline underline-offset-4">
          {all ? 'Show the first 6' : `Show all ${tools.length}`}
        </button>
      ) : null}
    </>
  );
}

function SkillToggle({ name, text }: { name: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section>
      <h3 className="mb-1.5 text-[13px] font-medium text-muted-foreground">Skill</h3>
      <div className="rounded-control border border-border bg-card p-3">
        <div className="flex items-baseline gap-3">
          <p className="num text-[13px] font-medium text-primary">{name}</p>
          <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="ml-auto text-[13px] font-medium text-primary underline underline-offset-4">
            {open ? 'Hide the skill' : 'Show the skill'}
          </button>
        </div>
        {open ? <p className="mt-2 text-[14px] leading-relaxed whitespace-pre-line">{text}</p> : null}
      </div>
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[13px] font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function AgentDrawer({ member, live, doc, onClose }: { member: PodMember | null; live: RunLive; doc: CsrDocument | null; onClose: () => void }) {
  const tools = member ? toolsFor(member.id, live, doc, member.acts) : [];
  const state = member ? stateFor(member.id, live, doc) : undefined;
  const passages: { section: string; ref: Extract<SourceRef, { kind: 'passage' }> }[] =
    member && (member.id === 'author' || member.id === 'planner')
      ? (doc?.plan ?? []).flatMap((p) => p.passages.flatMap((r) => (r.kind === 'passage' ? [{ section: p.section, ref: r }] : [])))
      : [];
  return (
    <Sheet open={!!member} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[480px] gap-0 bg-background sm:max-w-[480px]">
        {member ? (
          <>
            <SheetHeader className="border-b border-border bg-card p-5">
              <SheetTitle className="text-[18px] font-semibold">{member.title}</SheetTitle>
              <SheetDescription className="text-[13px]">{member.actsFor ? `Acts for ${member.actsFor}` : 'Part of the pod'}</SheetDescription>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              {member.note ? <p className="text-[14px]">{member.note}</p> : null}
              {state && state.status !== 'idle' ? (
                <p className="text-[14px] text-muted-foreground">
                  {state.status === 'running' ? 'Running' : state.status === 'done' ? 'Done' : 'Error'}
                  {state.progress ? `, ${state.progress.done} of ${state.progress.total}` : ''}
                  {state.summary ? `. ${state.summary}` : ''}
                </p>
              ) : null}
              {member.kind === 'agent' ? (
                <Block title={live.runId ? 'Tool calls, live' : 'Tool calls of the run'}>
                  <ToolList tools={tools} />
                </Block>
              ) : null}
              {passages.length ? (
                <Block title="Passages it chose">
                  <ul className="space-y-2">
                    {passages.map(({ section, ref }) => (
                      <li key={`${section}-${ref.page}-${ref.element_id}`} className="rounded-control border border-border bg-card p-3">
                        <p className="text-[12px] text-muted-foreground">
                          For section <span className="num">{section}</span>, {shortDoc(ref.doc_title)} page <span className="num">{ref.page}</span>
                        </p>
                        <p className="mt-1 text-[14px] leading-snug">&ldquo;{ref.quote}&rdquo;</p>
                      </li>
                    ))}
                  </ul>
                </Block>
              ) : null}
              {member.how ? <SkillToggle name={member.how.name} text={member.how.text} /> : null}
              {member.acts?.length ? (
                <Block title="Tools it can call">
                  <div className="flex flex-wrap gap-1.5">
                    {member.acts.map((a) => (
                      <span key={a} className="num rounded-control border border-border bg-card px-1.5 py-0.5 text-[12px]">
                        {a}
                      </span>
                    ))}
                  </div>
                </Block>
              ) : null}
              {member.calls?.length ? (
                <Block title="Works with">
                  <ul className="space-y-0.5 text-[14px]">
                    {member.calls.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </Block>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
