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
  headline: {
    /** Wall time of the full-CSR run the current draft is based on (the pre-run), never a single-section redraft. */
    wall_ms: number | null;
    figures_total: number;
    figures_matched: number;
    typed_figures: number;
    /** Set when the shown run is a redraft (it has a base run): the redraft run, its sections and its own wall time. */
    redraft: {
      run_id: string;
      sections: string[];
      wall_ms: number | null;
      /** Figures in the redrafted sections, so the screen can explain why the total changes after a re-delivery. */
      figures_total: number;
    } | null;
  };
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
  /** Plain printed row label (for example "Baseline: mean", "Dose response p value", "p value vs placebo"). */
  row_label: string;
  /** Arm name of the column (for example "Placebo"); null when the column is not an arm (for example a p value): row_label then says everything. */
  column_label: string | null;
  /** Position of the printed cell inside its table element, 0-based, from the parsed table HTML (colspan and rowspan applied); null when unknown. */
  printed_row_idx: number | null;
  printed_row_count: number | null;
  printed_col_idx: number | null;
  printed_col_count: number | null;
  /** Exact box of the printed number on the page image, as fractions of its width and height (0 to 1), from the PDF text layer; null when not found (the client draws no cell box). */
  printed_box: { x0: number; y0: number; x1: number; y1: number } | null;
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

/** One AI Search call: the query text and the passages it returned. */
export interface SearchCallDetail {
  query: string;
  passages: { id: string | null; doc: string; doc_part: string; page: number; element_id: number; text: string }[];
}

/** A tool call of any agent. `detail.searches` is set for find_passages and search_documents. */
export interface PodToolCall {
  type: 'tool';
  agent: string;
  section?: string;
  tool: string;
  args: unknown;
  ok: boolean;
  result_summary: string;
  ms: number;
  at: string;
  /** reconstructed is true for runs recorded before queries and passages were stored: replayed from the stored arguments and the index. */
  detail?: { searches: SearchCallDetail[]; reconstructed?: boolean };
}

export interface RedeliverResult {
  /** Releases of the table (1 and 2). */
  old_version: number;
  new_version: number;
  /** Delta versions of the table. */
  old_delta_version: number;
  new_delta_version: number;
  changed_cells: number;
  /** sentence_idx is 0-based into the drafted sentences. label is "<row label>, <arm>, n" or "<row label>, <arm>, %". */
  affected: { section: string; sentence_idx: number; slot: string; label: string; old_value: string; new_value: string }[];
  run_id: string | null;
}

/** GET /api/redeliver/latest: the last re-delivery plus the status of its redraft run; null after a reset. */
export type RedeliverLatest = (RedeliverResult & { run_status: 'running' | 'done' | 'error' | null }) | null;
