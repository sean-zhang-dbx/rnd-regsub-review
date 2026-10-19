import { ROOT_CONTEXT, context } from '@opentelemetry/api';
import type { Application, Request, Response } from 'express';
import { FQ, MODEL_LABEL, MODEL_SERVICE, dbxFetch, sqlRows } from '../lib/dbx';
import { initTracing, mlflow } from '../lib/tracing';

/*
 * Drafting beat. The model drafts a section from its outline and writes a placeholder for each figure;
 * it is never given the values. SQL fills the placeholders from Table 14.2.1 (efficacy_primary) at the
 * version the draft is written against, so each figure is tied to a cell from the moment it is drafted.
 */

const SOURCE_VERSION = 3; // Draft 0.4 was written against version 3, before the re-delivery.
const TIMEOUT_MS = 25_000;

const SLOTS: Record<string, string> = {
  trt_resp: 'number of responders in the LMN-4471 400 mg arm',
  trt_n: 'number of participants in the LMN-4471 400 mg arm',
  trt_rate: 'responder rate in the LMN-4471 400 mg arm, in percent',
  pbo_resp: 'number of responders in the placebo arm',
  pbo_n: 'number of participants in the placebo arm',
  pbo_rate: 'responder rate in the placebo arm, in percent',
  diff: 'difference in responder rate, LMN-4471 minus placebo, in percentage points',
  ci_low: 'lower bound of the 95% CI of the difference',
  ci_high: 'upper bound of the 95% CI of the difference',
};

const OUTLINES: Record<string, { title: string; outline: string[] }> = {
  '11.4.1': {
    title: 'Clinical Study Report, section 11.4.1 Primary efficacy endpoint',
    outline: [
      'Define the primary endpoint: the proportion of participants who met the responder definition at Week 52, adjudicated by the blinded Clinical Endpoint Committee.',
      'Report the responders, participants and rate in each arm, and the difference with its 95% CI.',
      'State that the estimated treatment difference favoured LMN-4471 (nominal p < 0.001).',
      'Note that the analysis repeated in the per-protocol set gave consistent results (Table 14.2.2).',
    ],
  },
  '2.7.3': {
    title: 'Module 2.7.3 Summary of Clinical Efficacy, primary endpoint in study LMN-301',
    outline: [
      'Summarise the Week 52 responder results in both arms of study LMN-301.',
      'State the treatment difference with its 95% CI and that it favoured LMN-4471.',
    ],
  },
};

// Numbers that are part of the outline, not data: allowed in the model's own text.
const ALLOWED_NUMBERS = new Set(['52', '95', '400', '4471', '301', '0.001', '11.4.1', '2.7.3', '14.2.1', '14.2.2']);

const SYSTEM_PROMPT = `You draft sections of clinical study documents for regulatory submission, for the fictional study LMN-301 (LMN-4471 400 mg versus placebo).
Write in the plain, factual register of a clinical study report, in British English, one sentence per outline point.
You do not know the results. Every result figure must be written as a placeholder in curly braces, chosen from the list you are given, for example "{trt_resp} of {trt_n} participants ({trt_rate}%)". Never write a result figure as a number, never estimate one, and never invent a placeholder that is not in the list. Numbers that appear in the outline (such as Week 52, 95% CI or 400 mg) may be written as they are.
Reply with one JSON object and nothing else: {"sentences": ["<sentence 1>", "<sentence 2>", ...]}`;

type Part = { text: string } | { slot: string; value: string };
interface DraftSentence {
  template: string;
  parts: Part[];
}
interface DraftResult {
  section: string;
  source_version: number;
  sentences: DraftSentence[];
  figure_count: number;
  typed_numbers: string[];
  unknown_slots: string[];
  model: string;
  trace_id: string | null;
  cached: boolean;
  drafted_at: string;
}

let valuesCache: Record<string, string> | undefined;

/** The 9 cited cells of Table 14.2.1 at the drafting version, keyed by placeholder name. */
async function slotValues(): Promise<Record<string, string>> {
  if (valuesCache) return valuesCache;
  const rows = await sqlRows(
    `WITH v AS (
       SELECT row_key, stack(6,
         'n', CAST(n AS STRING), 'responders', CAST(responders AS STRING),
         'rate_pct', format_number(rate_pct, 1), 'diff_pct', format_number(diff_pct, 1),
         'ci_low', format_number(ci_low, 1), 'ci_high', format_number(ci_high, 1)
       ) AS (column_name, value_text)
       FROM ${FQ}.efficacy_primary VERSION AS OF ${SOURCE_VERSION})
     SELECT c.fig_key, v.value_text AS value
     FROM (SELECT DISTINCT fig_key, row_key, column_name FROM ${FQ}.figure_citations
           WHERE source_table = 'efficacy_primary') c
     JOIN v ON c.row_key = v.row_key AND c.column_name = v.column_name`,
  );
  valuesCache = Object.fromEntries(rows.map((r) => [r.fig_key as string, r.value as string]));
  return valuesCache;
}

function bind(templates: string[], values: Record<string, string>) {
  const unknown = new Set<string>();
  const typed = new Set<string>();
  let figures = 0;
  const sentences = templates.map((template) => {
    const parts: Part[] = [];
    let last = 0;
    for (const m of template.matchAll(/\{(\w+)\}/g)) {
      if (m.index > last) parts.push({ text: template.slice(last, m.index) });
      const key = m[1];
      if (key in values) {
        parts.push({ slot: key, value: values[key] });
        figures++;
      } else {
        unknown.add(key);
        parts.push({ text: m[0] });
      }
      last = m.index + m[0].length;
    }
    if (last < template.length) parts.push({ text: template.slice(last) });
    // Any number the model wrote itself, outside a placeholder, that is not part of the outline.
    const own = template.replace(/\{\w+\}/g, ' ').replace(/LMN-\d+/g, ' ');
    for (const n of own.match(/\d+(?:\.\d+)*/g) ?? []) if (!ALLOWED_NUMBERS.has(n)) typed.add(n);
    return { template, parts };
  });
  return { sentences, figures, unknown: [...unknown], typed: [...typed] };
}

async function callModel(userContent: string, signal: AbortSignal) {
  // Same Unity Gateway model service as the wording check (Claude Sonnet 5.5, inference table on).
  const out = await dbxFetch<{ choices: { message: { content: string | { text?: string }[] } }[]; usage?: Record<string, number> }>(
    '/ai-gateway/mlflow/v1/chat/completions',
    {
      body: {
        model: MODEL_SERVICE,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      },
      signal,
    },
  );
  const raw = out.choices?.[0]?.message?.content ?? '';
  const content = Array.isArray(raw) ? raw.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('') : raw;
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`unparseable model output: ${content.slice(0, 120)}`);
  const parsed = JSON.parse(m[0]) as { sentences?: unknown };
  if (!Array.isArray(parsed.sentences) || parsed.sentences.length === 0 || !parsed.sentences.every((s) => typeof s === 'string')) {
    throw new Error('model output has no sentences');
  }
  return { templates: parsed.sentences, usage: out.usage };
}

async function persist(r: DraftResult) {
  await sqlRows(
    `INSERT INTO ${FQ}.section_drafts (section, source_version, templates_json, figure_count, typed_numbers, model, trace_id, drafted_at)
     VALUES (:section, CAST(:ver AS BIGINT), :tpl, CAST(:figs AS INT), :typed, :model, :trace, current_timestamp())`,
    [
      { name: 'section', value: r.section },
      { name: 'ver', value: String(r.source_version) },
      { name: 'tpl', value: JSON.stringify(r.sentences.map((s) => s.template)) },
      { name: 'figs', value: String(r.figure_count) },
      { name: 'typed', value: r.typed_numbers.join(',') },
      { name: 'model', value: r.model },
      { name: 'trace', value: r.trace_id },
    ],
  );
}

/** Fallback when the model is slow or fails: the last stored draft of the section. */
async function lastDraft(section: string, values: Record<string, string>): Promise<DraftResult | null> {
  const rows = await sqlRows(
    `SELECT templates_json, trace_id, drafted_at FROM ${FQ}.section_drafts
     WHERE section = :section AND coalesce(typed_numbers, '') = ''
     ORDER BY drafted_at DESC LIMIT 1`,
    [{ name: 'section', value: section }],
  );
  const row = rows[0];
  if (!row) return null;
  const b = bind(JSON.parse(row.templates_json as string) as string[], values);
  return {
    section,
    source_version: SOURCE_VERSION,
    sentences: b.sentences,
    figure_count: b.figures,
    typed_numbers: b.typed,
    unknown_slots: b.unknown,
    model: MODEL_LABEL,
    trace_id: row.trace_id,
    cached: true,
    drafted_at: row.drafted_at as string,
  };
}

export function registerDraftSection(app: Application) {
  app.post('/api/draft-section', async (req: Request, res: Response) => {
    const section = (req.body as { section?: unknown })?.section;
    if (typeof section !== 'string' || !(section in OUTLINES)) {
      res.status(400).json({ error: `section must be one of ${Object.keys(OUTLINES).join(', ')}` });
      return;
    }
    const spec = OUTLINES[section];
    const userContent =
      `Section: ${spec.title}\n\nOutline:\n${spec.outline.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\n` +
      `Placeholders you may use (from Table 14.2.1, efficacy_primary):\n` +
      Object.entries(SLOTS)
        .map(([k, d]) => `{${k}}: ${d}`)
        .join('\n');

    let values: Record<string, string>;
    try {
      values = await slotValues();
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
      return;
    }

    await initTracing();
    const span = context.with(ROOT_CONTEXT, () =>
      mlflow.startSpan({
        name: 'draft_section',
        spanType: mlflow.SpanType.LLM,
        inputs: { section, prompt: userContent },
        attributes: { model_service: MODEL_SERVICE, source_table: 'efficacy_primary', source_version: SOURCE_VERSION },
      }),
    );
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const out = await callModel(userContent, ctrl.signal);
      const b = bind(out.templates, values);
      span.end({
        outputs: { templates: out.templates, figure_count: b.figures, typed_numbers: b.typed, unknown_slots: b.unknown, usage: out.usage },
      });
      const result: DraftResult = {
        section,
        source_version: SOURCE_VERSION,
        sentences: b.sentences,
        figure_count: b.figures,
        typed_numbers: b.typed,
        unknown_slots: b.unknown,
        model: MODEL_LABEL,
        trace_id: span.traceId,
        cached: false,
        drafted_at: new Date().toISOString(),
      };
      res.json(result);
      void mlflow.flushTraces().catch(() => undefined);
      void persist(result).catch((e) => console.warn('[draft-section] persist failed:', (e as Error).message));
    } catch (e) {
      span.end({ status: mlflow.SpanStatusCode.ERROR, outputs: { error: (e as Error).message } });
      console.warn(`[draft-section] ${section}: falling back to the last stored draft (${(e as Error).message})`);
      const fallback = await lastDraft(section, values).catch(() => null);
      if (fallback) res.json(fallback);
      else res.status(502).json({ error: (e as Error).message });
    } finally {
      clearTimeout(timer);
    }
  });
}
