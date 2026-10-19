import type { QueryRegistry } from '@databricks/appkit-ui/react';

type Row<K extends keyof QueryRegistry> = QueryRegistry[K]['result'][number];

export type RestatementSummaryRow = Row<'restatement_summary'>;
export type ImpactRow = Row<'impact_list'>;
export type UnchangedRow = Row<'unchanged_sentences'>;
export type DocumentSectionRow = Row<'document_section'>;
export type CitationDetailRow = Row<'citation_detail'>;
export type RecomputeRow = Row<'recompute_figures'>;
export type SignoffRow = Row<'signoffs'>;

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
