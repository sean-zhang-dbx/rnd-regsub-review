import type { AgentId, CsrDocument, PodEvent, SectionLiveStatus, ToolCall } from '../../data/types';

/* Live state derived from the event stream, ported from rnd_regsub_review. */

export type AgentLive = { status: 'idle' | 'running' | 'done' | 'error'; summary?: string; progress?: { done: number; total: number } };
export type ToolEntry = ToolCall & { agent: AgentId; section?: string };
export type RunLive = {
  runId: string | null;
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  agents: Partial<Record<AgentId, AgentLive>>;
  sections: Record<string, SectionLiveStatus>;
  tools: ToolEntry[];
};

export const EMPTY_LIVE: RunLive = { runId: null, status: 'idle', agents: {}, sections: {}, tools: [] };

export function reduceEvent(s: RunLive, e: PodEvent): RunLive {
  switch (e.type) {
    case 'run': {
      const agents = e.status === 'running' ? s.agents : (Object.fromEntries(Object.entries(s.agents).map(([k, v]) => [k, v.status === 'running' ? { ...v, status: e.status === 'done' ? 'done' : 'error' } : v])) as RunLive['agents']);
      return { ...s, status: e.status, error: e.error, agents };
    }
    case 'agent':
      return { ...s, agents: { ...s.agents, [e.agent]: { status: e.status, summary: e.summary, progress: e.progress ?? s.agents[e.agent]?.progress } } };
    case 'section':
      return { ...s, sections: { ...s.sections, [e.section]: e.status } };
    case 'tool':
      return { ...s, tools: [...s.tools, { agent: e.agent, section: e.section, tool: e.tool, args: e.args, ok: e.ok, result_summary: e.result_summary, ms: e.ms }] };
    case 'log':
      return s;
  }
}

export function agentOfSection(a: string): AgentId {
  return (['context', 'planner', 'author', 'narrative', 'qc', 'assembler', 'signoff'] as const).find((x) => x === a) ?? 'author';
}

/** Tool calls of one agent: the live stream while a replay is on, else the stored logs of the finished run. */
export function toolsFor(agent: AgentId, live: RunLive, doc: CsrDocument | null, acts?: string[]): ToolEntry[] {
  if (live.runId) return live.tools.filter((t) => t.agent === agent);
  if (!doc) return [];
  /* A stored section log mixes the calls of every agent that touched the section: keep the ones this agent owns. */
  if (acts?.length) return doc.sections.flatMap((s) => s.tool_log.filter((t) => acts.includes(t.tool)).map((t) => ({ ...t, agent, section: s.section })));
  return doc.sections.filter((s) => agentOfSection(s.agent) === agent).flatMap((s) => s.tool_log.map((t) => ({ ...t, agent, section: s.section })));
}

/** An agent of a finished run reads as done; during a replay it follows the events. */
export function stateFor(agent: AgentId, live: RunLive, doc: CsrDocument | null): AgentLive | undefined {
  if (live.runId) return live.agents[agent];
  return doc ? { status: 'done' } : undefined;
}

/** Saves the server turned back, and whether a later save of the same section went through. */
export function rejectedSaves(tools: ToolEntry[]): { rejected: number; fixed: number } {
  const saves = tools.filter((t) => t.tool === 'save_csr_draft');
  let rejected = 0;
  let fixed = 0;
  saves.forEach((t, i) => {
    if (t.ok) return;
    rejected += 1;
    if (saves.slice(i + 1).some((n) => n.ok && n.section === t.section)) fixed += 1;
  });
  return { rejected, fixed };
}

export function shortDoc(title: string): string {
  if (/protocol/i.test(title)) return 'Protocol';
  if (/\bsap\b|statistical analysis/i.test(title)) return 'SAP';
  return title;
}
