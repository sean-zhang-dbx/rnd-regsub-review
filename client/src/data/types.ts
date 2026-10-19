import type { QueryRegistry } from '@databricks/appkit-ui/react';

type Row<K extends keyof QueryRegistry> = QueryRegistry[K]['result'][number];

export type RestatementSummaryRow = Row<'restatement_summary'>;
export type ImpactRow = Row<'impact_list'>;
export type UnchangedRow = Row<'unchanged_sentences'>;
export type DocumentSectionRow = Row<'document_section'>;
export type CitationDetailRow = Row<'citation_detail'>;
export type RecomputeRow = Row<'recompute_figures'>;
export type SignoffRow = Row<'signoffs'>;

/** `tlf_table`: one row per cell of Table 14.2.1 (typed here, typegen reports it as unknown). */
export interface TlfCell {
  row_key: string;
  column_name: string;
  value_prev: string | null;
  value_curr: string | null;
}

/** Values the queries return as plain strings. */
export type DocType = string;
export type ImpactKind = 'figure' | 'label' | 'prose';
export type SignoffAction = 'approved' | 'sent_to_labelling' | 'sent_to_writer' | 'notified_owner';

/* Route shapes from docs/DEMO_PLAN.md section 4. */
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

export type DraftPart = { text: string } | { slot: string; value: string };

export interface DraftResult {
  section: string;
  source_version: number;
  sentences: { template: string; parts: DraftPart[] }[];
  figure_count: number;
  typed_numbers: string[];
  unknown_slots: string[];
  model: string;
  trace_id: string | null;
  cached: boolean;
  drafted_at: string;
}

export interface ParsedBox {
  element_id: number;
  element_type: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  used: boolean;
}

export interface SourcePage {
  doc_title: string;
  file_path: string;
  page: number;
  image_path: string;
  width: number;
  height: number;
  excerpt: string;
  boxes: ParsedBox[];
  /** How the highlighted element is described, for example "used by the draft" or "cited in the answer". */
  used_label?: string;
}

export type DraftStepId = 'read_sources' | 'find_table' | 'draft' | 'fill' | 'check' | 'done';

export interface DraftRunEvent {
  step: DraftStepId;
  title?: string;
  status: 'running' | 'done' | 'error';
  ms?: number;
  error?: string;
  detail?: Record<string, unknown>;
  result?: DraftResult;
}

export interface AssistantSource {
  n: number;
  doc_title: string;
  page: number;
  snippet: string;
  view: SourcePage | null;
}

export interface AssistantGenie {
  answer_text: string;
  sql: string;
  rows: Record<string, string | null>[];
  conversation_id: string;
  conversation_url: string;
}

export type AssistantEvent =
  | { event: 'route'; tables: boolean; documents: boolean }
  | { event: 'tables'; genie?: AssistantGenie; error?: string }
  | { event: 'documents'; count?: number; error?: string }
  | { event: 'answer'; answer: string; sources: AssistantSource[]; genie: AssistantGenie | null; trace_id: string }
  | { event: 'error'; error: string };
