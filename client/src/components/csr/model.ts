import type { AgentId, CsrDocument, CsrSectionStatus, PodEvent, RegistrySection, ToolCall } from '../../data/csr';

/* Live state derived from the event stream, and display helpers shared by the CSR components. */

export type AgentLive = { status: 'idle' | 'running' | 'done' | 'error'; summary?: string; progress?: { done: number; total: number } };
export type ToolEntry = ToolCall & { agent: AgentId; section?: string };
export type LiveSectionStatus = CsrSectionStatus | 'planned' | 'drafting';
export type RunLive = {
  runId: string | null;
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  agents: Partial<Record<AgentId, AgentLive>>;
  sections: Record<string, LiveSectionStatus>;
  tools: ToolEntry[];
  logs: { agent: AgentId; section?: string; text: string }[];
};

export const EMPTY_LIVE: RunLive = { runId: null, status: 'idle', agents: {}, sections: {}, tools: [], logs: [] };

export function reduceEvent(s: RunLive, e: PodEvent): RunLive {
  switch (e.type) {
    case 'run': {
      /* When the run ends, no agent can still be working. */
      const agents = e.status === 'running' ? s.agents : Object.fromEntries(Object.entries(s.agents).map(([k, v]) => [k, v.status === 'running' ? { ...v, status: e.status === 'done' ? 'done' : 'error' } : v])) as RunLive['agents'];
      return { ...s, status: e.status, error: e.error, agents };
    }
    case 'agent':
      return { ...s, agents: { ...s.agents, [e.agent]: { status: e.status, summary: e.summary, progress: e.progress ?? s.agents[e.agent]?.progress } } };
    case 'section':
      return { ...s, sections: { ...s.sections, [e.section]: e.status } };
    case 'tool':
      return { ...s, tools: [...s.tools, { agent: e.agent, section: e.section, tool: e.tool, args: e.args, ok: e.ok, result_summary: e.result_summary, ms: e.ms }] };
    case 'log':
      return { ...s, logs: [...s.logs, { agent: e.agent, section: e.section, text: e.text }] };
  }
}

/** Tool calls of one agent: the live stream while a run is on, else the stored logs of the last run. */
export function toolsFor(agent: AgentId, live: RunLive, doc: CsrDocument | null): ToolEntry[] {
  if (live.runId) return live.tools.filter((t) => t.agent === agent);
  if (!doc) return [];
  return doc.sections
    .filter((s) => agentOfSection(s.agent) === agent)
    .flatMap((s) => s.tool_log.map((t) => ({ ...t, agent, section: s.section })));
}

export function agentOfSection(a: string): AgentId {
  return (['context', 'planner', 'author', 'narrative', 'qc', 'assembler', 'signoff'] as const).find((x) => x === a) ?? 'author';
}

/** Saves the server turned back, and whether a later save of the same section went through. */
export function rejectedSaves(tools: ToolEntry[]): { rejected: number; fixed: number } {
  const isSave = (t: ToolEntry) => t.tool === 'save_csr_draft';
  let rejected = 0;
  let fixed = 0;
  tools.filter(isSave).forEach((t, i, all) => {
    if (t.ok) return;
    rejected += 1;
    if (all.slice(i + 1).some((n) => n.ok && n.section === t.section)) fixed += 1;
  });
  return { rejected, fixed };
}

export const SECTION_STATUS_LABEL: Record<LiveSectionStatus, string> = {
  planned: 'Planned',
  drafting: 'Drafting',
  drafted: 'Drafted',
  checked: 'Checked',
  needs_person: 'Needs a person',
  failed: 'Failed',
  assembled: 'Assembled',
};
export const SECTION_STATUS_PILL: Record<LiveSectionStatus, string> = {
  planned: 'bg-open-soft text-ink-muted',
  drafting: 'bg-cited-soft text-cited',
  drafted: 'bg-cited-soft text-cited',
  checked: 'bg-recomputed-soft text-recomputed',
  needs_person: 'bg-attention-soft text-attention',
  failed: 'bg-attention text-page',
  assembled: 'bg-open-soft text-ink',
};

export const AGENT_LABEL: Record<string, string> = {
  planner: 'Document Planner',
  author: 'CSR Author',
  narrative: 'Safety Narrative',
  qc: 'QC & Consistency',
  assembler: 'CSR Assembler',
  context: 'Certified context',
  signoff: 'Sign-off',
};

export function shortDoc(title: string): string {
  if (/protocol/i.test(title)) return 'Protocol';
  if (/\bsap\b|statistical analysis/i.test(title)) return 'SAP';
  return title.length > 18 ? `${title.slice(0, 17)}…` : title;
}

export function compareSections(a: { ord: number }, b: { ord: number }) {
  return a.ord - b.ord;
}

export function registryAsRows(reg: RegistrySection[]) {
  return [...reg].sort(compareSections);
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms) return 'n/a';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}
