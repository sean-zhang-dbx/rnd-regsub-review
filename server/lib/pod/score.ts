import type { LiveSpan } from 'mlflow-tracing';
import { FQ, dbxFetch, sqlRows } from '../dbx';
import { mlflow } from '../tracing';
import type { RegistrySection, Sentence } from './data';
import type { CsrSection } from './assemble';
import { textOf } from './assemble';

/*
 * Scoring a drafted section against the CSR that was actually submitted for this study. The answer key
 * (submitted_tlf_cells, submitted_csr_sections) is read here and only here, for scoring: nothing in this file
 * feeds back into the author's brief. Figures are compared with the printed cell at the printed precision;
 * coverage of the content is judged by a model from a second family (GPT 5.5).
 */

export const JUDGE_ENDPOINT = 'databricks-gpt-5-5';
export const JUDGE_LABEL = 'GPT 5.5';

export interface PrintedCell {
  printed_value: string;
  page: number;
  element_id: number;
  /** Position of the cell inside its printed table element (0-based, from the parsed HTML); null when unknown. */
  row_idx: number | null;
  row_count: number | null;
  col_idx: number | null;
  col_count: number | null;
  /** Exact box of the printed number as fractions of the page image (from the PDF text layer); null when not found. */
  box: PrintedBox | null;
}

export interface PrintedBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

let printedCache: Promise<Map<string, PrintedCell>> | undefined;

export function clearPrintedCache() {
  printedCache = undefined;
}

export const cellKey = (table: string, rowKey: string, column: string) => `${table}|${rowKey}|${column}`;

export function printedCells(): Promise<Map<string, PrintedCell>> {
  printedCache ??= sqlRows(`SELECT tlf, row_key, column_name, printed_value, page, element_id, row_idx, row_count, col_idx, col_count, box_x0, box_y0, box_x1, box_y1 FROM ${FQ}.submitted_tlf_cells`).then(
    (rows) =>
      new Map(
        rows.map((r) => [
          cellKey(r.tlf as string, r.row_key as string, r.column_name as string),
          {
            printed_value: r.printed_value as string,
            page: Number(r.page),
            element_id: Number(r.element_id),
            row_idx: r.row_idx === null ? null : Number(r.row_idx),
            row_count: r.row_count === null ? null : Number(r.row_count),
            col_idx: r.col_idx === null ? null : Number(r.col_idx),
            col_count: r.col_count === null ? null : Number(r.col_count),
            box:
              r.box_x0 === null || r.box_y0 === null || r.box_x1 === null || r.box_y1 === null
                ? null
                : { x0: Number(r.box_x0), y0: Number(r.box_y0), x1: Number(r.box_x1), y1: Number(r.box_y1) },
          },
        ]),
      ),
  );
  return printedCache;
}

/** Does a drafted value equal the printed value at the printed precision? Printed '<1' or '<.0001' are thresholds. */
export function matchesPrinted(drafted: string, printed: string): boolean {
  const p = printed.trim();
  const d = Number(drafted);
  if (!Number.isFinite(d)) return false;
  const thr = p.match(/^([<>])=?(\d*\.?\d+)$/);
  if (thr) return thr[1] === '<' ? d < Number(thr[2]) : d > Number(thr[2]);
  const places = p.includes('.') ? p.split('.')[1].length : 0;
  const scale = 10 ** places;
  return Math.abs(Math.round(d * scale) / scale - Number(p)) < 1e-9;
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
  printed_row_idx: number | null;
  printed_row_count: number | null;
  printed_col_idx: number | null;
  printed_col_count: number | null;
  printed_box: PrintedBox | null;
  match: boolean;
}

/** Every drafted figure that has a printed counterpart in the submitted tables, ticked against it. */
export async function tickSection(sec: CsrSection): Promise<{ ticks: Tick[]; unverifiable: number }> {
  const printed = await printedCells();
  const ticks: Tick[] = [];
  let unverifiable = 0;
  sec.sentences.forEach((s, i) => {
    for (const p of s.parts) {
      if (!('slot' in p)) continue;
      if (!p.source_table.startsWith('tlf_')) continue; // study metadata and patient data are not table cells
      const pc = printed.get(cellKey(p.source_table, p.row_key, p.column_name));
      if (!pc) {
        unverifiable++;
        continue;
      }
      ticks.push({
        sentence_idx: i + 1,
        slot: p.slot,
        drafted_value: p.value,
        tlf: p.source_table,
        row_key: p.row_key,
        column_name: p.column_name,
        table_version: p.table_version,
        printed_value: pc.printed_value,
        printed_page: pc.page,
        printed_element_id: pc.element_id,
        printed_row_idx: pc.row_idx,
        printed_row_count: pc.row_count,
        printed_col_idx: pc.col_idx,
        printed_col_count: pc.col_count,
        printed_box: pc.box,
        match: matchesPrinted(p.value, pc.printed_value),
      });
    }
  });
  return { ticks, unverifiable };
}

/** Text of the submitted section and its subsections, for the judge only. */
export async function submittedText(section: string): Promise<string> {
  const rows = await sqlRows(
    `SELECT section, title, text FROM ${FQ}.submitted_csr_sections WHERE section = :s OR section LIKE concat(:s, '.%') ORDER BY page_from, section`,
    [{ name: 's', value: section }],
  );
  return rows.map((r) => `${r.section} ${r.title}\n${r.text}`).join('\n\n');
}

const draftText = (sec: CsrSection) => sec.sentences.map((s: Sentence) => textOf(s)).join(' ');

export interface Coverage {
  score: number;
  notes: string;
  left_for_person: string[];
}

const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Content coverage of a drafted section against the submitted section, 1 to 5, by GPT 5.5. Scoring only. */
export async function judgeCoverage(sec: CsrSection, reg: RegistrySection, parent: LiveSpan): Promise<Coverage | null> {
  const key = (await submittedText(sec.section)).slice(0, 9000);
  if (!key) return null;
  const span = mlflow.startSpan({ name: `score:${sec.section}`, parent, spanType: mlflow.SpanType.LLM, inputs: { section: sec.section, model: JUDGE_ENDPOINT } });
  const prompt =
    'You score a drafted section of a clinical study report against the section of the report that was actually submitted for the same study.\n\n' +
    `Section ${sec.section} ${sec.title}. The writer's instructions for the draft:\n${reg.instructions.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\n` +
    `Submitted section (the reference):\n${key}\n\n` +
    `Drafted section (figures were filled by SQL from certified tables and are scored separately, ignore differences in figures):\n${draftText(sec)}\n\n` +
    'Score from 1 to 5 how completely the draft covers the content that the submitted section covers (5: all main points; 3: about half; 1: almost nothing). ' +
    'Then list the 2 or 3 most important points the submitted writer made that the draft leaves out, in plain words, each at most 25 words (an empty list if none). ' +
    'Reply with one JSON object and nothing else: {"coverage_score": <1-5>, "notes": "<one sentence of at most 30 words>", "left_for_person": ["<point>", ...]}.';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const out = await dbxFetch<{ choices: { message: { content: string } }[] }>(`/serving-endpoints/${JUDGE_ENDPOINT}/invocations`, {
      body: { messages: [{ role: 'user', content: prompt }], max_tokens: 4000, reasoning_effort: 'low' },
      signal: ctrl.signal,
    });
    const m = (out.choices?.[0]?.message?.content ?? '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('unparseable judge output');
    const j = JSON.parse(m[0]) as { coverage_score?: unknown; notes?: unknown; left_for_person?: unknown };
    const score = Math.max(1, Math.min(5, Math.round(Number(j.coverage_score))));
    const r: Coverage = { score: Number.isFinite(score) ? score : 3, notes: typeof j.notes === 'string' ? j.notes : '', left_for_person: strArray(j.left_for_person).slice(0, 3) };
    span.end({ outputs: { ...r } });
    return r;
  } catch (e) {
    span.end({ status: mlflow.SpanStatusCode.ERROR, outputs: { error: (e as Error).message } });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface ScoreRow {
  run_id: string;
  section: string;
  figures_total: number;
  figures_matched: number;
  mismatches: { sentence_idx: number; slot: string; drafted_value: string; printed_value: string; tlf: string; row_key: string; column_name: string }[];
  unverifiable: number;
  coverage_score: number | null;
  coverage_notes: string;
  left_for_person: string[];
  judge_model: string;
  trace_id: string | null;
}

export async function persistScore(s: ScoreRow) {
  await sqlRows(
    `INSERT INTO ${FQ}.csr_scores (run_id, section, figures_total, figures_matched, mismatches_json, coverage_score, coverage_notes, left_for_person_json, judge_model, trace_id, scored_at)
     VALUES (:run, :sec, CAST(:ft AS INT), CAST(:fm AS INT), :mm, CAST(:cs AS INT), :cn, :lp, :jm, :tr, current_timestamp())`,
    [
      { name: 'run', value: s.run_id },
      { name: 'sec', value: s.section },
      { name: 'ft', value: String(s.figures_total) },
      { name: 'fm', value: String(s.figures_matched) },
      { name: 'mm', value: JSON.stringify({ mismatches: s.mismatches, unverifiable: s.unverifiable }) },
      { name: 'cs', value: s.coverage_score === null ? null : String(s.coverage_score) },
      { name: 'cn', value: s.coverage_notes },
      { name: 'lp', value: JSON.stringify(s.left_for_person) },
      { name: 'jm', value: s.judge_model },
      { name: 'tr', value: s.trace_id },
    ],
  );
}

export async function loadScores(runId: string): Promise<ScoreRow[]> {
  const rows = await sqlRows(`SELECT * FROM ${FQ}.csr_scores WHERE run_id = :r ORDER BY section`, [{ name: 'r', value: runId }]);
  return rows.map((r) => {
    const mm = JSON.parse((r.mismatches_json as string) || '{}') as { mismatches?: ScoreRow['mismatches']; unverifiable?: number };
    return {
      run_id: r.run_id as string,
      section: r.section as string,
      figures_total: Number(r.figures_total),
      figures_matched: Number(r.figures_matched),
      mismatches: mm.mismatches ?? [],
      unverifiable: mm.unverifiable ?? 0,
      coverage_score: r.coverage_score === null ? null : Number(r.coverage_score),
      coverage_notes: (r.coverage_notes as string) ?? '',
      left_for_person: JSON.parse((r.left_for_person_json as string) || '[]') as string[],
      judge_model: (r.judge_model as string) ?? JUDGE_LABEL,
      trace_id: (r.trace_id as string) ?? null,
    };
  });
}
