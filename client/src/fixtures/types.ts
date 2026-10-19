/*
 * Result shapes copied from docs/DEMO_PLAN.md section 4 (queries and routes).
 * Delete with the rest of client/src/fixtures once typegen output is in use.
 */

export interface RestatementSummaryRow {
  table_name: string;
  prev_version: number;
  curr_version: number;
  restated_at: string;
  restated_by: string;
  changed_cells: number;
}

export type ImpactKind = 'figure' | 'label' | 'prose';
export type DocType = 'csr' | 'm27' | 'm25' | 'label';

export interface ImpactRow {
  sentence_id: string;
  doc_type: DocType;
  section: string;
  section_title: string;
  seq: number;
  fig_key: string;
  old_value: string;
  new_value: string;
  kind: ImpactKind;
}

export interface UnchangedRow {
  sentence_id: string;
  doc_type: DocType;
  section: string;
  source_table: string;
}

export interface DocumentSectionRow {
  sentence_id: string;
  seq: number;
  template: string;
  text_v_prev: string;
  fig_key: string;
  citation_id: string;
  value_prev: string;
  value_curr: string;
  affected: boolean;
}

export interface CitationDetailRow {
  source_table: string;
  row_key: string;
  column_name: string;
  table_version: number;
  query_key: string;
  query_sql: string;
  certified_by: string;
  certified_at: string;
}

export interface RecomputeRow {
  fig_key: string;
  value: string;
  source_version: number;
}

export type SignoffAction = 'approved' | 'sent_to_labelling' | 'sent_to_writer';

export interface SignoffRow {
  sentence_id: string;
  action: SignoffAction;
  reviewer: string;
  signed_at: string;
}

export interface WordingCheckResult {
  sentence_id: string;
  verdict: 'ok' | 'needs_writer';
  reason: string;
  model: string;
  trace_id: string;
  cached: boolean;
}

export interface UntrackedHit {
  doc_title: string;
  file_path: string;
  page: number;
  snippet: string;
  score: number;
}

export interface SignoffResponse {
  written: number;
}

export interface GenieAnswer {
  answer_text: string;
  sql: string;
  rows: Record<string, unknown>[];
  conversation_url: string;
}
