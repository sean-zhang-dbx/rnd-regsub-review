import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, Database, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { AgentId, CsrDocument, PodDef, PodMember } from '../../data/csr';
import { cn } from '../../lib/utils';
import { rejectedSaves, toolsFor } from './model';
import type { RunLive } from './model';

/*
 * The CSR Pod: a team running a process. Work flows left to right through handoffs (curved connectors).
 * Each agent card shows its skill (HOW), its tools (ACTS) and what it calls (CALLS), and the department it acts for.
 */

const KIT = { how: 'bg-kit-skill', acts: 'bg-kit-tool', calls: 'bg-kit-agent' } as const;

function Chip({ label, tone }: { label: string; tone: keyof typeof KIT }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[3px] bg-desk px-1.5 py-0.5 text-[10.5px] leading-tight text-ink">
      <span className={cn('size-1.5 shrink-0 rounded-full', KIT[tone])} />
      <span className="break-all">{label}</span>
    </span>
  );
}

function ChipRow({ label, tone, items, empty }: { label: string; tone: keyof typeof KIT; items: string[]; empty?: string }) {
  return (
    <div className="flex items-start gap-1.5">
      <span className="w-9 shrink-0 pt-0.5 text-[9.5px] font-semibold tracking-wide text-ink-muted uppercase">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {items.length ? items.map((i) => <Chip key={i} label={i} tone={tone} />) : <span className="text-[11px] text-ink-muted">{empty}</span>}
      </div>
    </div>
  );
}

function StatusLine({ live }: { live?: RunLive['agents'][AgentId] }) {
  if (!live || live.status === 'idle') return null;
  const pct = live.progress && live.progress.total ? Math.round((live.progress.done / live.progress.total) * 100) : null;
  return (
    <div className="mt-2 border-t border-line pt-1.5">
      <div className="flex items-center gap-1.5 text-[11px]">
        {live.status === 'running' ? <span className="size-2 animate-pulse rounded-full bg-cited" /> : null}
        {live.status === 'done' ? <span className="size-2 rounded-full bg-recomputed" /> : null}
        {live.status === 'error' ? <span className="size-2 rounded-full bg-attention" /> : null}
        <span className={cn('font-medium', live.status === 'running' ? 'text-cited' : live.status === 'error' ? 'text-attention' : 'text-recomputed')}>
          {live.status === 'running' ? 'Running' : live.status === 'done' ? 'Done' : 'Error'}
        </span>
        {live.progress ? (
          <span className="text-ink-muted">
            {live.progress.done} of {live.progress.total}
          </span>
        ) : null}
      </div>
      {pct !== null ? (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-open-soft">
          <div className="h-full bg-cited transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {live.summary ? <div className="mt-1 text-[11px] leading-snug text-ink-muted">{live.summary}</div> : null}
    </div>
  );
}

function AgentCard({
  m,
  phase,
  live,
  tools,
  selected,
  onPick,
}: {
  m: PodMember;
  phase: number;
  live: RunLive;
  tools: ReturnType<typeof toolsFor>;
  selected: boolean;
  onPick: (id: AgentId) => void;
}) {
  const state = live.agents[m.id];
  const rej = rejectedSaves(tools);
  return (
    <button
      type="button"
      data-node
      data-phase={phase}
      onClick={() => onPick(m.id)}
      aria-label={`${m.title}, open details`}
      className={cn(
        'w-full rounded-lg border bg-page p-2.5 text-left transition-colors hover:border-cited',
        selected ? 'border-cited ring-1 ring-cited' : state?.status === 'running' ? 'border-cited' : 'border-line',
      )}
    >
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] leading-tight font-semibold text-ink">{m.title}</span>
          <span className="mt-0.5 block text-[10.5px] text-ink-muted">acts for {m.actsFor}</span>
        </span>
        <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
      </div>
      <div className="mt-2 space-y-1">
        <ChipRow label="how" tone="how" items={m.how ? [m.how.name] : []} />
        <ChipRow label="acts" tone="acts" items={m.acts ?? []} empty="reasons over context" />
        <ChipRow label="calls" tone="calls" items={m.calls ?? []} empty="calls nothing" />
      </div>
      {rej.rejected > 0 ? (
        <div className="mt-2 inline-flex items-center gap-1 rounded-[3px] bg-attention-soft px-1.5 py-0.5 text-[11px] font-medium text-attention">
          <TriangleAlert className="size-3" aria-hidden="true" />
          {rej.rejected} {rej.rejected === 1 ? 'save' : 'saves'} rejected{rej.fixed >= rej.rejected ? ', fixed' : ''}
        </div>
      ) : null}
      <StatusLine live={state} />
    </button>
  );
}

function StaticCard({ m, phase, live, onPick }: { m: PodMember; phase: number; live: RunLive; onPick: (id: AgentId) => void }) {
  const gate = m.kind === 'gate';
  const Icon = gate ? ShieldCheck : Database;
  return (
    <button
      type="button"
      data-node
      data-phase={phase}
      onClick={() => onPick(m.id)}
      className={cn('w-full rounded-lg border p-2.5 text-left hover:border-cited', gate ? 'border-gate-line bg-gate-soft' : 'border-line bg-page')}
    >
      <div className="flex items-center gap-1.5">
        <Icon className={cn('size-4 shrink-0', gate ? 'text-attention' : 'text-cited')} aria-hidden="true" />
        <span className="text-[13.5px] leading-tight font-semibold text-ink">{m.title}</span>
      </div>
      {m.actsFor ? <div className="mt-0.5 text-[10.5px] text-ink-muted">{m.actsFor}</div> : null}
      {m.note ? <div className="mt-1 text-[11px] leading-snug text-ink-muted">{m.note}</div> : null}
      {!gate && m.calls?.length ? (
        <div className="mt-2">
          <ChipRow label="from" tone="calls" items={m.calls} />
        </div>
      ) : null}
      <StatusLine live={live.agents[m.id]} />
    </button>
  );
}

export function PodFlow({
  pod,
  live,
  doc,
  selected,
  onPick,
}: {
  pod: PodDef;
  live: RunLive;
  doc: CsrDocument | null;
  selected: AgentId | null;
  onPick: (id: AgentId) => void;
}) {
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
      <div ref={innerRef} className="relative flex min-w-[1120px] items-stretch">
        <svg className="pointer-events-none absolute top-0 left-0 z-0" width={dims.w} height={dims.h} aria-hidden="true">
          {paths.map((d) => (
            <path key={d} d={d} fill="none" stroke="var(--cited)" strokeOpacity={0.45} strokeWidth={1.5} />
          ))}
        </svg>
        {pod.columns.map((col, i) => (
          <div key={col.title} className="relative z-10 flex min-w-0 flex-1 items-stretch">
            {i > 0 ? (
              <div className="flex w-[68px] shrink-0 items-center justify-center">
                {col.edge ? (
                  <span className="rounded-[3px] border border-line bg-page px-1 py-0.5 text-center text-[9.5px] leading-tight text-ink-muted">{col.edge}</span>
                ) : null}
              </div>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
                {col.title}
                {col.parallel ? <span className="ml-1.5 rounded-[3px] bg-open-soft px-1 py-px text-[9.5px] font-medium normal-case">parallel</span> : null}
              </div>
              <div className="flex flex-1 flex-col justify-center gap-2">
                {col.members.map((id) => {
                  const m = byId.get(id);
                  if (!m) return null;
                  return m.kind === 'agent' ? (
                    <AgentCard key={id} m={m} phase={i} live={live} tools={toolsFor(id, live, doc)} selected={selected === id} onPick={onPick} />
                  ) : (
                    <StaticCard key={id} m={m} phase={i} live={live} onPick={onPick} />
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
