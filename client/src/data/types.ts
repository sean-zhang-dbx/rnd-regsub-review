/*
 * Response shapes of the Express routes, from docs/DEMO_PLAN.md section 4. The engine routes keep the
 * shapes of rnd_regsub_review (docs/CSR_POD_BUILD.md section 3.1), with `efficacy_version` replaced by
 * `table_versions_json`. Nothing here is generated: these routes are not analytics queries.
 */

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

export type SectionLiveStatus = 'planned' | 'drafting' | 'drafted' | 'checked' | 'needs_person' | 'failed' | 'assembled';
export type PodEvent =
  | { type: 'run'; status: 'running' | 'done' | 'error'; run_id: string; at: string; error?: string; wall_ms?: number }
  | { type: 'agent'; agent: AgentId; status: 'idle' | 'running' | 'done' | 'error'; at: string; summary?: string; progress?: { done: number; total: number } }
  | { type: 'section'; section: string; status: SectionLiveStatus; agent: AgentId; at: string }
  | { type: 'tool'; agent: AgentId; section?: string; tool: string; args: unknown; ok: boolean; result_summary: string; ms: number; at: string }
  | { type: 'log'; agent: AgentId; section?: string; text: string; at: string };

export type Part =
  | { text: string }
  | { slot: string; value: string; source_table: string; tlf: string; row_key: string; column_name: string; table_version: number };
export type SourceRef =
  | { kind: 'passage'; doc_title: string; doc_part?: string; file_path: string; page: number; element_id: number; quote: string }
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
export type CsrDocument = {
  run_id: string;
  started_at: string;
  finished_at: string | null;
  wall_ms: number | null;
  table_versions_json: string;
  trace_id: string | null;
  model: string;
  judge_model: string;
  plan: { section: string; passages: SourceRef[]; tlfs: string[]; depends_on: string[]; wave: number | null }[];
  sections: CsrSection[];
  document_checks: Check[];
};

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

/* GET /api/scorecard. Matches shared/csr-api.ts of the backend branch. */
export type ScoreRow = {
  section: string;
  title: string;
  department: string;
  figures_total: number;
  figures_matched: number;
  coverage_score: number | null;
  needs_person: number;
  status: 'quiet' | 'differs';
};
export type Scorecard = {
  run: {
    run_id: string;
    base_run_id?: string | null;
    status?: 'running' | 'done' | 'error';
    started_at?: string;
    finished_at?: string | null;
    table_versions_json?: string;
    table_versions?: Record<string, number>;
    wall_ms?: number | null;
    superseded?: boolean;
  };
  headline: {
    wall_ms: number | null;
    figures_total: number;
    figures_matched: number;
    typed_figures: number;
    /* Set when the latest done run is a redraft of some sections (contract additions after review round 1). */
    redraft?: { run_id: string; sections: string[]; wall_ms: number | null } | null;
  };
  rows: ScoreRow[];
};

/* GET /api/sources */
export type Sources = {
  adam: { table: string; rows: number; columns: number; checksum?: string | null; xpt_sha256?: string | null; checksum_ok: boolean }[];
  tlfs: { table: string; tlf: string; version: number; certified: boolean; upstreams: string[] }[];
  docs: { file: string; pages: number; parts: { doc_part: string; page_from: number; page_to: number; elements: number; searchable: boolean }[] };
  index: { name: string; chunks: number };
};

/* GET /api/compare */
export type PageElement = { element_id: number; element_type: string; x0: number; y0: number; x1: number; y1: number; content: string };
export type ComparePage = { page: number; image_path: string; width: number; height: number; elements: PageElement[] };
export type Tick = {
  sentence_idx: number;
  slot: string;
  drafted_value: string;
  tlf: string;
  row_key: string;
  column_name: string;
  table_version: number;
  printed_value: string;
  printed_page: number;
  printed_element_id: number;
  match: boolean;
  /* Contract additions after review round 1. All optional: an older server does not send them. */
  row_label?: string | null;
  column_label?: string | null;
  printed_row_idx?: number | null;
  printed_row_count?: number | null;
  printed_col_idx?: number | null;
  printed_col_count?: number | null;
};
export type Compare = {
  run_id?: string;
  section: string;
  drafted: Sentence[];
  submitted: { pages: ComparePage[]; text: string };
  ticks: Tick[];
  wording: { coverage_score: number | null; notes: string; left_for_person: string[] };
};

/* POST /api/redeliver */
export type Redelivery = {
  old_version: number;
  new_version: number;
  changed_cells: number;
  old_delta_version?: number;
  new_delta_version?: number;
  affected: { section: string; sentence_idx: number; slot: string; label?: string | null; old_value: string; new_value: string }[];
  run_id: string | null;
};
/* GET /api/redeliver/latest: the POST shape plus the status of the redraft run. */
export type RedeliveryLatest = Redelivery & { run_status?: 'running' | 'done' | 'error' | null };
