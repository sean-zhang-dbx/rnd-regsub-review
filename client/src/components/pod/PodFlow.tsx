import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { AgentId, CsrDocument, PodDef, PodMember } from '../../data/types';
import { plural } from '../../lib/format';
import { rejectedSaves, stateFor, toolsFor } from './model';
import type { AgentLive, RunLive } from './model';

/*
 * The CSR Pod: a team running a process. Work flows left to right through handoffs (curved connectors).
 * Ported from rnd_regsub_review and restyled: sentence-case labels, one accent, no icons, no pulsing.
 */

const DOT = { how: 'bg-primary' } as const;

function Chip({ label, tone }: { label: string; tone: keyof typeof DOT }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-control bg-background px-1.5 py-0.5 text-[12px] leading-tight">
      <span className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} aria-hidden="true" />
      <span className="num break-words">{label}</span>
    </span>
  );
}

function Status({ live }: { live?: AgentLive }) {
  if (!live || live.status === 'idle') return null;
  const pct = live.progress?.total ? Math.round((live.progress.done / live.progress.total) * 100) : null;
  const label = live.status === 'running' ? 'Running' : live.status === 'done' ? 'Done' : 'Error';
  return (
    <div className="mt-2.5 border-t border-border pt-2">
      <p className={cn('flex items-center gap-1.5 text-[13px] font-medium', live.status === 'running' ? 'text-primary' : live.status === 'error' ? 'text-differs' : 'text-foreground')}>
        <span className={cn('size-2 rounded-full', live.status === 'running' ? 'bg-primary' : live.status === 'error' ? 'bg-differs' : 'bg-foreground/40')} aria-hidden="true" />
        {label}
        {live.progress ? (
          <span className="num font-normal text-muted-foreground">
            {live.progress.done} of {live.progress.total}
          </span>
        ) : null}
      </p>
      {pct !== null ? (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-background">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {live.summary ? <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{live.summary}</p> : null}
    </div>
  );
}

function Card({ m, phase, live, doc, selected, onPick }: { m: PodMember; phase: number; live: RunLive; doc: CsrDocument | null; selected: boolean; onPick: (id: AgentId) => void }) {
  const state = stateFor(m.id, live, doc);
  const rej = rejectedSaves(toolsFor(m.id, live, doc));
  const agent = m.kind === 'agent';
  return (
    <button
      type="button"
      data-node
      data-phase={phase}
      onClick={() => onPick(m.id)}
      aria-label={`${m.title}, open details`}
      className={cn(
        'w-full rounded-panel border bg-card p-3 text-left transition-colors hover:border-primary',
        selected ? 'border-primary ring-1 ring-primary' : state?.status === 'running' ? 'border-primary' : 'border-border',
        m.kind === 'gate' && 'border-dashed',
      )}
    >
      <span className="block text-[15px] leading-tight font-semibold">{m.title}</span>
      {m.actsFor ? <span className="mt-0.5 block text-[12px] text-muted-foreground">for {m.actsFor}</span> : null}
      {agent ? (
        <div className="mt-2.5 space-y-1.5">
          {m.how ? <Chip label={m.how.name} tone="how" /> : null}
          <p className="text-[12px] leading-snug text-muted-foreground">
            {m.acts?.length ? plural(m.acts.length, 'tool', 'tools') : 'No tools'}
            {m.calls?.length ? `, calls ${m.calls.join(' and ')}` : ''}
          </p>
        </div>
      ) : m.note ? (
        <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">{m.note}</p>
      ) : null}
      {rej.rejected > 0 ? (
        <p className="mt-2 text-[12px] font-medium text-differs">
          {rej.rejected} {rej.rejected === 1 ? 'save' : 'saves'} turned back{rej.fixed >= rej.rejected ? ' and fixed' : ''}
        </p>
      ) : null}
      <Status live={state} />
    </button>
  );
}

export function PodFlow({ pod, live, doc, selected, onPick }: { pod: PodDef; live: RunLive; doc: CsrDocument | null; selected: AgentId | null; onPick: (id: AgentId) => void }) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const byId = new Map(pod.members.map((m) => [m.id, m]));

  /* Connectors are measured from the DOM so they stay attached to the cards at any width. */
  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const measure = () => {
      const base = inner.getBoundingClientRect();
      const groups = new Map<number, { left: number; right: number; mid: number }[]>();
      inner.querySelectorAll<HTMLElement>('[data-node]').forEach((el) => {
        const p = Number(el.dataset.phase);
        const r = el.getBoundingClientRect();
        const list = groups.get(p) ?? [];
        list.push({ left: r.left - base.left, right: r.right - base.left, mid: r.top - base.top + r.height / 2 });
        groups.set(p, list);
      });
      const keys = [...groups.keys()].sort((a, b) => a - b);
      const ds: string[] = [];
      for (let i = 0; i < keys.length - 1; i++) {
        for (const a of groups.get(keys[i]) ?? []) {
          for (const b of groups.get(keys[i + 1]) ?? []) {
            const dx = Math.max(16, (b.left - a.right) / 2);
            ds.push(`M ${a.right} ${a.mid} C ${a.right + dx} ${a.mid}, ${b.left - dx} ${b.mid}, ${b.left} ${b.mid}`);
          }
        }
      }
      setPaths(ds);
      setDims({ w: inner.scrollWidth, h: inner.scrollHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [pod, live.agents]);

  return (
    <div className="overflow-x-auto pb-1">
      <div ref={innerRef} className="relative flex min-w-[1080px] items-stretch">
        <svg className="pointer-events-none absolute top-0 left-0 z-0" width={dims.w} height={dims.h} aria-hidden="true">
          {paths.map((d) => (
            <path key={d} d={d} fill="none" stroke="var(--primary)" strokeOpacity={0.4} strokeWidth={1.5} />
          ))}
        </svg>
        {pod.columns.map((col, i) => (
          <div key={col.title} className={cn('relative z-10 flex min-w-0 items-stretch', col.parallel ? 'flex-[1.35]' : 'flex-1')}>
            {i > 0 ? <div className="w-10 shrink-0" /> : null}
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="mb-2 text-[13px] font-medium text-muted-foreground">
                {col.title}
                {col.parallel ? <span className="ml-2 font-normal">in parallel</span> : null}
              </p>
              <div className="flex flex-1 flex-col justify-center gap-2.5">
                {col.members.map((id) => {
                  const m = byId.get(id);
                  return m ? <Card key={id} m={m} phase={i} live={live} doc={doc} selected={selected === id} onPick={onPick} /> : null;
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
