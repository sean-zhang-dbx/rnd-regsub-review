/*
 * Response types of the Express routes of rnd-csr-pod (DEMO_PLAN.md section 4). Hand-written because the routes
 * are not SQL files, so `npm run typegen` does not cover them. The server builds these shapes in server/routes/.
 */

export type DocPart = 'csr_body' | 'csr_tlf' | 'references' | 'appendix_index' | 'protocol' | 'protocol_appendix' | 'sap' | 'other';

export interface CsrRunRow {
  run_id: string;
  base_run_id: string | null;
  status: 'running' | 'done' | 'error';
  started_at: string;
  finished_at: string | null;
  table_versions_json: string;
  table_versions: Record<string, number>;
  sections_requested: string;
  model: string;
  judge_model: string;
  trace_id: string | null;
  wall_ms: number | null;
  superseded: boolean;
}

export interface ScorecardRow {
  section: string;
  title: string;
  department: string;
  figures_total: number;
  figures_matched: number;
  coverage_score: number | null;
  needs_person: number;
  status: 'quiet' | 'differs';
}

export interface Scorecard {
  run: CsrRunRow;
  headline: { wall_ms: number | null; figures_total: number; figures_matched: number; typed_figures: number };
  rows: ScorecardRow[];
}

export interface Sources {
  adam: { table: string; rows: number; columns: number; checksum: string | null; xpt_sha256: string | null; checksum_ok: boolean }[];
  tlfs: { table: string; tlf: string; version: number; certified: boolean; upstreams: string[] }[];
  docs: { file: string; pages: number; parts: { doc_part: DocPart; page_from: number; page_to: number; elements: number; searchable: boolean }[] };
  index: { name: string; chunks: number };
}

export type Part =
  | { text: string }
  | { slot: string; value: string; source_table: string; tlf: string; row_key: string; column_name: string; table_version: number };

export type SourceRef =
  | { kind: 'passage'; doc_title: string; doc_part?: DocPart; file_path: string; page: number; element_id: number; quote: string }
  | { kind: 'tlf'; tlf: string; table: string }
  | { kind: 'writer' };

export interface Sentence {
  template: string;
  parts: Part[];
  sources: SourceRef[];
  interpretation?: boolean;
  heading?: string;
}

export interface PageElement {
  element_id: number;
  element_type: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  content: string;
}

export interface Tick {
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
}

export interface Compare {
  run_id: string;
  section: string;
  drafted: Sentence[];
  submitted: { pages: { page: number; image_path: string; width: number; height: number; elements: PageElement[] }[]; text: string };
  ticks: Tick[];
  wording: { coverage_score: number | null; notes: string; left_for_person: string[] };
}

export interface RedeliverResult {
  old_version: number;
  new_version: number;
  changed_cells: number;
  affected: { section: string; sentence_idx: number; slot: string; old_value: string; new_value: string }[];
  run_id: string | null;
}
