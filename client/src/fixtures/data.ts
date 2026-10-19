import type {
  CitationDetailRow,
  DocumentSectionRow,
  GenieAnswer,
  ImpactRow,
  RecomputeRow,
  RestatementSummaryRow,
  SignoffAction,
  SignoffRow,
  UnchangedRow,
  UntrackedHit,
  WordingCheckResult,
} from './types';

/*
 * Typed fixtures for LMN-301. Values follow docs/DEMO_PLAN.md section 2:
 * 412 to 409 of 618, 66.7 to 66.2%, difference 19.5 to 19.1, CI 14.1-25.0 to 13.6-24.5,
 * placebo 287 of 609 (47.1%), 7 affected sentences, 6 unchanged, 2 untracked documents.
 */

const REVIEWER = 'Dr. Amara Okafor, Regulatory Review';
const TABLE = 'sean_zhang_catalog.rnd_regsub_review.efficacy_primary';

export const restatementSummary: RestatementSummaryRow[] = [
  {
    table_name: 'efficacy_primary',
    prev_version: 3,
    curr_version: 4,
    restated_at: '2026-10-19T09:12:00Z',
    restated_by: 'Biostatistics',
    changed_cells: 6,
  },
];

export const impactList: ImpactRow[] = [
  { sentence_id: 'csr-1141-02', doc_type: 'csr', section: '11.4.1', section_title: 'Primary efficacy endpoint', seq: 2, fig_key: 'trt_resp', old_value: '412 of 618 (66.7%)', new_value: '409 of 618 (66.2%)', kind: 'figure' },
  { sentence_id: 'csr-1141-03', doc_type: 'csr', section: '11.4.1', section_title: 'Primary efficacy endpoint', seq: 3, fig_key: 'diff', old_value: '19.5 (14.1 to 25.0)', new_value: '19.1 (13.6 to 24.5)', kind: 'figure' },
  { sentence_id: 'csr-1141-05', doc_type: 'csr', section: '11.4.1', section_title: 'Primary efficacy endpoint', seq: 5, fig_key: 'trt_rate', old_value: '66.7%', new_value: '66.2%', kind: 'prose' },
  { sentence_id: 'm27-273-02', doc_type: 'm27', section: '2.7.3', section_title: 'Summary of clinical efficacy', seq: 2, fig_key: 'trt_rate', old_value: '66.7%', new_value: '66.2%', kind: 'figure' },
  { sentence_id: 'm27-273-03', doc_type: 'm27', section: '2.7.3', section_title: 'Summary of clinical efficacy', seq: 3, fig_key: 'diff', old_value: '19.5 (14.1 to 25.0)', new_value: '19.1 (13.6 to 24.5)', kind: 'figure' },
  { sentence_id: 'm25-25-04', doc_type: 'm25', section: '2.5', section_title: 'Clinical overview', seq: 4, fig_key: 'trt_resp', old_value: '412 of 618', new_value: '409 of 618', kind: 'figure' },
  { sentence_id: 'label-14-02', doc_type: 'label', section: '14', section_title: 'Clinical studies', seq: 2, fig_key: 'trt_rate', old_value: '66.7%', new_value: '66.2%', kind: 'label' },
];

export const unchangedSentences: UnchangedRow[] = [
  { sentence_id: 'csr-122-02', doc_type: 'csr', section: '12.2', source_table: 'safety_overview' },
  { sentence_id: 'csr-122-03', doc_type: 'csr', section: '12.2', source_table: 'safety_overview' },
  { sentence_id: 'csr-122-04', doc_type: 'csr', section: '12.2', source_table: 'safety_overview' },
  { sentence_id: 'm27-274-02', doc_type: 'm27', section: '2.7.4', source_table: 'safety_overview' },
  { sentence_id: 'm27-274-03', doc_type: 'm27', section: '2.7.4', source_table: 'safety_overview' },
  { sentence_id: 'label-6-02', doc_type: 'label', section: '6', source_table: 'safety_overview' },
];

const PLAIN_1 =
  'The primary endpoint was the proportion of participants with a response at Week 52 in the full analysis set, as defined in the statistical analysis plan.';
const PLAIN_4 =
  'The result was consistent in the per-protocol set and after multiple imputation of missing Week 52 assessments.';

interface FigureSeed {
  key: string;
  prev: string;
  curr: string;
}

const FIG: Record<string, FigureSeed> = {
  trt_resp: { key: 'trt_resp', prev: '412', curr: '409' },
  trt_n: { key: 'trt_n', prev: '618', curr: '618' },
  trt_rate: { key: 'trt_rate', prev: '66.7', curr: '66.2' },
  pbo_resp: { key: 'pbo_resp', prev: '287', curr: '287' },
  pbo_n: { key: 'pbo_n', prev: '609', curr: '609' },
  pbo_rate: { key: 'pbo_rate', prev: '47.1', curr: '47.1' },
  diff: { key: 'diff', prev: '19.5', curr: '19.1' },
  ci_low: { key: 'ci_low', prev: '14.1', curr: '13.6' },
  ci_high: { key: 'ci_high', prev: '25.0', curr: '24.5' },
};

function render(template: string, values: 'prev' | 'curr'): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => FIG[k]?.[values] ?? '');
}

function plainRow(id: string, seq: number, text: string): DocumentSectionRow {
  return {
    sentence_id: id,
    seq,
    template: text,
    text_v_prev: text,
    fig_key: '',
    citation_id: '',
    value_prev: '',
    value_curr: '',
    affected: false,
  };
}

function citedRows(id: string, seq: number, template: string): DocumentSectionRow[] {
  const keys = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  return keys.map((k) => ({
    sentence_id: id,
    seq,
    template,
    text_v_prev: render(template, 'prev'),
    fig_key: k,
    citation_id: `${id}:${k}`,
    value_prev: FIG[k].prev,
    value_curr: FIG[k].curr,
    affected: true,
  }));
}

export const documentSection1141: DocumentSectionRow[] = [
  plainRow('csr-1141-01', 1, PLAIN_1),
  ...citedRows(
    'csr-1141-02',
    2,
    'In the primary analysis, {trt_resp} of {trt_n} participants ({trt_rate}%) in the LMN-4471 arm met the primary endpoint, compared with {pbo_resp} of {pbo_n} ({pbo_rate}%) on placebo.',
  ),
  ...citedRows(
    'csr-1141-03',
    3,
    'The treatment difference was {diff} percentage points (95% CI {ci_low} to {ci_high}).',
  ),
  plainRow('csr-1141-04', 4, PLAIN_4),
  ...citedRows(
    'csr-1141-05',
    5,
    'About two-thirds of participants in the LMN-4471 arm ({trt_rate}%) responded by Week 52, and the effect was consistent across the pre-specified subgroups of age, sex and region.',
  ),
];

const ROW_COL: Record<string, [string, string]> = {
  trt_resp: ['TRT', 'responders'],
  trt_n: ['TRT', 'n'],
  trt_rate: ['TRT', 'rate_pct'],
  pbo_resp: ['PBO', 'responders'],
  pbo_n: ['PBO', 'n'],
  pbo_rate: ['PBO', 'rate_pct'],
  diff: ['DIFF', 'diff_pct'],
  ci_low: ['DIFF', 'ci_low'],
  ci_high: ['DIFF', 'ci_high'],
};

export function citationDetail(citationId: string): CitationDetailRow[] {
  const fig = citationId.split(':')[1];
  const rc = ROW_COL[fig];
  if (!rc) return [];
  return [
    {
      source_table: TABLE,
      row_key: rc[0],
      column_name: rc[1],
      table_version: 3,
      query_key: `fig_${fig}`,
      query_sql: `SELECT ${rc[1]}\nFROM ${TABLE} VERSION AS OF 3\nWHERE row_key = '${rc[0]}'`,
      certified_by: 'Biostatistics',
      certified_at: '2026-10-19T08:40:00Z',
    },
  ];
}

export const recomputeFigures: RecomputeRow[] = Object.values(FIG).map((f) => ({
  fig_key: f.key,
  value: f.curr,
  source_version: 4,
}));

const signoffStore: SignoffRow[] = [];

export function signoffRows(): SignoffRow[] {
  return [...signoffStore];
}

export function writeSignoff(sentenceIds: string[], action: SignoffAction): { written: number } {
  const signed_at = new Date().toISOString();
  for (const sentence_id of sentenceIds) {
    signoffStore.push({ sentence_id, action, reviewer: REVIEWER, signed_at });
  }
  return { written: sentenceIds.length };
}

export function wordingChecks(sentenceIds: string[]): WordingCheckResult[] {
  return sentenceIds.map((sentence_id, i) => {
    const needsWriter = sentence_id === 'csr-1141-05';
    return {
      sentence_id,
      verdict: needsWriter ? 'needs_writer' : 'ok',
      reason: needsWriter
        ? "66.2% is below two-thirds, so 'about two-thirds' may no longer hold. The writer decides."
        : 'The wording still matches the recomputed figures.',
      model: 'databricks-claude-sonnet-5-5',
      trace_id: `tr-7f3a${i}c91e`,
      cached: false,
    };
  });
}

export const untrackedHits: UntrackedHit[] = [
  {
    doc_title: "Investigator's Brochure v7",
    file_path: '/Volumes/sean_zhang_catalog/rnd_regsub_review/source_docs/LMN-4471_Investigators_Brochure_v7.pdf',
    page: 4,
    snippet:
      'In the 52-week Phase III study, 412 of 618 (66.7%) participants receiving LMN-4471 responded, compared with 287 of 609 (47.1%) on placebo.',
    score: 0.92,
  },
  {
    doc_title: 'Advisory briefing book (draft)',
    file_path: '/Volumes/sean_zhang_catalog/rnd_regsub_review/source_docs/LMN-4471_Advisory_Briefing_Book_draft.pdf',
    page: 11,
    snippet:
      'The efficacy result is clear: about two-thirds of participants on LMN-4471 responded by Week 52, and the 66.7% response rate was sustained.',
    score: 0.88,
  },
  {
    doc_title: "Investigator's Brochure v7",
    file_path: '/Volumes/sean_zhang_catalog/rnd_regsub_review/source_docs/LMN-4471_Investigators_Brochure_v7.pdf',
    page: 12,
    snippet: 'The primary response rate of 66.7% versus 47.1% corresponds to a difference of 19.5 percentage points.',
    score: 0.81,
  },
];

export const genieAnswer: GenieAnswer = {
  answer_text: '409 of 618 participants (66.2%) in the LMN-4471 arm met the primary endpoint after the restatement.',
  sql: `SELECT responders, n, rate_pct\nFROM ${TABLE}\nWHERE arm = 'LMN-4471 400 mg' AND row_key = 'TRT'`,
  rows: [{ responders: 409, n: 618, rate_pct: 66.2 }],
  conversation_url: '',
};
