/* Types and fetch helpers for the CSR Pod (docs/CSR_POD_BUILD.md section 3.1). */

export type AgentId = 'context' | 'planner' | 'author' | 'narrative' | 'qc' | 'assembler' | 'signoff';

export type PodMember = {
  id: AgentId;
  kind: 'source' | 'agent' | 'gate';
  title: string;
  actsFor?: string;
  how?: { name: string; text: string };
  acts?: string[];
  calls?: string[];
  note?: string;
};
export type PodDef = {
  columns: { title: string; parallel?: boolean; edge?: string; members: AgentId[] }[];
  members: PodMember[];
  departments: { department: string; signer: string; role: string; scope: string; sections: string[] }[];
};

export type RegistrySection = {
  section: string;
  title: string;
  ord: number;
  kind: 'assembled' | 'boilerplate' | 'drafted' | 'narrative';
  agent: string;
  department: string;
  wave?: number | null;
  instructions?: string;
  depends_on?: string[];
  tlf_tables?: { table: string; tlf: string; alias: string; version: number | null }[];
};

export type PodEvent =
  | { type: 'run'; status: 'running' | 'done' | 'error'; run_id: string; at: string; error?: string; wall_ms?: number }
  | { type: 'agent'; agent: AgentId; status: 'idle' | 'running' | 'done' | 'error'; at: string; summary?: string; progress?: { done: number; total: number } }
  | { type: 'section'; section: string; status: 'planned' | 'drafting' | 'drafted' | 'checked' | 'needs_person' | 'failed' | 'assembled'; agent: AgentId; at: string }
  | { type: 'tool'; agent: AgentId; section?: string; tool: string; args: unknown; ok: boolean; result_summary: string; ms: number; at: string }
  | { type: 'log'; agent: AgentId; section?: string; text: string; at: string };

export type Part =
  | { text: string }
  | { slot: string; value: string; source_table: string; tlf: string; row_key: string; column_name: string; table_version: number };
export type SourceRef =
  | { kind: 'passage'; doc_title: string; file_path: string; page: number; element_id: number; quote: string }
  | { kind: 'tlf'; tlf: string; table: string }
  | { kind: 'writer' };
export type Sentence = { heading?: string; template: string; parts: Part[]; sources: SourceRef[]; interpretation?: boolean };
export type Check = { id: string; label: string; ok: boolean; detail?: string };
export type NeedsPerson = { sentence_idx?: number; reason: string; kind: 'interpretation' | 'check_failed' | 'judge' | 'qc_flag' };
export type ToolCall = { tool: string; args: unknown; ok: boolean; result_summary: string; ms: number };
export type CsrSectionStatus = 'assembled' | 'drafted' | 'checked' | 'needs_person' | 'failed';
export type CsrSection = {
  section: string;
  title: string;
  ord: number;
  kind: 'assembled' | 'boilerplate' | 'drafted' | 'narrative';
  agent: string;
  department: string;
  status: CsrSectionStatus;
  sentences: Sentence[];
  html?: string;
  checks: Check[];
  judge?: { verdict: 'yes' | 'no' | 'unavailable'; reason: string; model: string };
  needs_person: NeedsPerson[];
  tool_log: ToolCall[];
  trace_id: string | null;
  drafted_at: string | null;
};
export type GenieCheck = { question: string; genie_value: string; bound_value: string; slot: string; table_version_note: string; ok: boolean };
export type Redelivery = { section: string; sentence_idx: number; slot: string; v3: string; v4: string };
export type CsrDocument = {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  wall_ms: number | null;
  efficacy_version: number;
  trace_id: string | null;
  model: string;
  judge_model: string;
  plan: { section: string; passages: SourceRef[]; tlfs: string[]; depends_on: string[]; wave: number | null }[];
  sections: CsrSection[];
  document_checks: Check[];
  genie_checks: GenieCheck[];
  redelivery: Redelivery[];
};

/* Not typed in the spec. Assumed shape of a row of GET /api/csr/signoffs. The table versions may arrive parsed or as the raw JSON column. */
export type CsrSignoff = {
  signoff_id: string;
  run_id: string;
  department: string;
  scope: string;
  signer: string;
  role: string;
  decision: 'approved' | 'changes_requested';
  note?: string | null;
  table_versions?: Record<string, number>;
  table_versions_json?: string | null;
  signed_at: string;
};
export type SignoffState = { signoffs: CsrSignoff[]; release_blocked_by: string[] };

export const exportUrl = (runId: string) => `/api/csr-run/${encodeURIComponent(runId)}/export.doc`;

async function readError(url: string, res: Response): Promise<Error> {
  let detail = '';
  try {
    const raw = await res.text();
    try {
      const j: unknown = JSON.parse(raw);
      const msg: unknown = j && typeof j === 'object' ? (Object.entries(j) as [string, unknown][]).find(([k]) => k === 'error' || k === 'message')?.[1] : null;
      detail = typeof msg === 'string' ? msg : raw;
    } catch {
      detail = raw;
    }
    detail = detail.replace(/<[^>]*>/g, ' ').trim().slice(0, 200);
  } catch {
    detail = '';
  }
  return new Error(detail || `${url} returned ${res.status}`);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw await readError(url, res);
  return (await res.json()) as T;
}
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw await readError(url, res);
  return (await res.json()) as T;
}

export const getPod = () => getJson<PodDef>('/api/csr/pod');
export const getRegistry = () => getJson<{ sections: RegistrySection[] }>('/api/csr/registry').then((r) => r.sections);
export const getLatestRun = () => getJson<CsrDocument | null>('/api/csr-run/latest');
export const getActiveRun = () => getJson<{ run_id: string | null }>('/api/csr-run/active').then((r) => r.run_id);
export const getRun = (id: string) => getJson<CsrDocument>(`/api/csr-run/${encodeURIComponent(id)}`);
export const startRun = (sections?: string[]) => postJson<{ run_id: string }>('/api/csr-run', sections?.length ? { sections } : {});
export const getSignoffs = (runId: string) => getJson<SignoffState>(`/api/csr/signoffs?run_id=${encodeURIComponent(runId)}`);
export const postSignoff = (body: { run_id: string; department: string; decision: 'approved' | 'changes_requested'; note?: string }) =>
  postJson<unknown>('/api/csr/signoff', body);

/** Subscribes to the run's event stream (replayed from the start, then live). Returns the unsubscribe function. */
export function subscribeRun(runId: string, onEvent: (e: PodEvent) => void, onLost?: () => void): () => void {
  const es = new EventSource(`/api/csr-run/${encodeURIComponent(runId)}/events`);
  es.onmessage = (m: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(m.data) as PodEvent);
    } catch {
      /* ignore a malformed line */
    }
  };
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) onLost?.();
  };
  return () => es.close();
}
