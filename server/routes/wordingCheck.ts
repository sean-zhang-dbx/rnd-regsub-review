import { ROOT_CONTEXT, context } from '@opentelemetry/api';
import type { Application, Request, Response } from 'express';
import {
  FQ,
  MODEL_LABEL,
  MODEL_SERVICE,
  currentEfficacyVersion,
  dbxFetch,
  sqlRows,
} from '../lib/dbx';
import { initTracing, mlflow } from '../lib/tracing';

const TIMEOUT_MS = 8000;

const SYSTEM_PROMPT = `You are a regulatory medical-writing checker. A certified analysis table was restated, and the figures in a sentence were replaced automatically from the certified source. Do not check arithmetic and do not rewrite anything. Your only job is to decide whether the prose around the new figures still holds.

Rule: if the sentence uses a qualitative or fractional expression (for example "two-thirds", "half", "three-quarters", "majority", "nearly", "more than", "at least", "exceeds a margin") and the new figure now sits on a different side of the value that expression names than the old figure did, the answer is needs_writer. This applies even when the expression is softened with "about". A figure that was at or above the named fraction before and is below it now needs the writer, because only the writer can decide whether the wording still holds.
If the sentence contains only numbers and neutral wording, or the wording remains true with the new figures, the answer is ok.

Reply with one JSON object and nothing else: {"verdict": "ok" | "needs_writer", "reason": "<reason>"}
The reason is one plain sentence of at most 22 words. For needs_writer, use this pattern: "<new figure> is below <the named expression>, so '<the phrase in the sentence>' may no longer hold. The writer decides." (use "above" or the matching direction if the figure moved the other way). Name the figure and the expression exactly as "<figure>% is below <fraction>" and quote only the shortest lower-case phrase (for example 'about two-thirds'), never the whole sentence. Name the figure and the expression exactly as "<figure>% is below <fraction>" and quote only the shortest lower-case phrase (for example 'about two-thirds'), never the whole sentence. Do not quote the old figure, do not give decimals of the named fraction, and do not explain the rule. For ok, write one short sentence such as "The wording holds with the new figures."`;

interface SentenceRow {
  sentence_id: string;
  template: string;
  text_v_prev: string;
}
interface Result {
  sentence_id: string;
  verdict: 'ok' | 'needs_writer';
  reason: string;
  model: string;
  trace_id: string | null;
  cached: boolean;
}

function render(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => values[k] ?? `{${k}}`);
}

let staticCache: { at: number; sentences: SentenceRow[]; cits: Record<string, string | null>[] } | undefined;
let currentCache: { at: number; cur: Record<string, string> } | undefined;

async function loadContext(_ids: string[]) {
  // Sentences and citations are static during a review; the current values are cached for 60 s.
  if (!staticCache || Date.now() - staticCache.at > 300_000) {
    const [sentences, cits] = await Promise.all([
      sqlRows(`SELECT sentence_id, template, text_v_prev FROM ${FQ}.document_sentences`),
      sqlRows(`SELECT sentence_id, fig_key, value_text FROM ${FQ}.figure_citations`),
    ]);
    staticCache = { at: Date.now(), sentences: sentences as unknown as SentenceRow[], cits };
  }
  if (currentCache && Date.now() - currentCache.at < 60_000) {
    return { sentences: staticCache.sentences, cits: staticCache.cits, cur: currentCache.cur };
  }
  // Current values of the cited efficacy cells (same cells as the recompute_figures query).
  const current = await sqlRows(
    `WITH curr AS (
       SELECT row_key, stack(6,
         'n', CAST(n AS STRING), 'responders', CAST(responders AS STRING),
         'rate_pct', format_number(rate_pct, 1), 'diff_pct', format_number(diff_pct, 1),
         'ci_low', format_number(ci_low, 1), 'ci_high', format_number(ci_high, 1)
       ) AS (column_name, value_text)
       FROM ${FQ}.efficacy_primary)
     SELECT c.fig_key, curr.value_text AS value
     FROM (SELECT DISTINCT fig_key, row_key, column_name FROM ${FQ}.figure_citations
           WHERE source_table = 'efficacy_primary') c
     JOIN curr ON c.row_key = curr.row_key AND c.column_name = curr.column_name`,
  );
  const cur: Record<string, string> = Object.fromEntries(
    current.map((r) => [r.fig_key as string, r.value as string]),
  );
  currentCache = { at: Date.now(), cur };
  return { sentences: staticCache.sentences, cits: staticCache.cits, cur };
}

async function callModel(userContent: string, signal: AbortSignal) {
  // Unity Gateway: OpenAI-compatible route of the workspace AI Gateway, addressed by the fully
  // qualified name of a Unity Catalog model service. The temperature parameter is not supported by
  // Claude Sonnet 5.5, so it is omitted; the prompt asks for a fixed JSON shape instead.
  const out = await dbxFetch<{
    choices: { message: { content: string } }[];
    usage?: Record<string, number>;
  }>('/ai-gateway/mlflow/v1/chat/completions', {
    body: {
      model: MODEL_SERVICE,
      max_tokens: 800,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    },
    signal,
  });
  const raw: unknown = out.choices?.[0]?.message?.content ?? '';
  // Content is a string, or a list of blocks (text plus reasoning) for some responses.
  const content = Array.isArray(raw)
    ? raw.map((b: { text?: string }) => (typeof b?.text === 'string' ? b.text : '')).join('')
    : String(raw);
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`unparseable model output: ${content.slice(0, 120)}`);
  const parsed = JSON.parse(m[0]) as { verdict?: string; reason?: string };
  if (parsed.verdict !== 'ok' && parsed.verdict !== 'needs_writer') {
    throw new Error(`unexpected verdict: ${parsed.verdict}`);
  }
  const verdict: 'ok' | 'needs_writer' = parsed.verdict;
  return { verdict, reason: String(parsed.reason ?? ''), usage: out.usage };
}

/** One MERGE per request (parallel per-sentence MERGEs conflict), retried once on a concurrent-write conflict. */
async function persistBatch(rs: Result[], version: number) {
  if (rs.length === 0) return;
  const rows = rs.map((_, i) => `SELECT :sid${i}, CAST(:ver AS BIGINT), :verdict${i}, :reason${i}, :model${i}, :trace${i}, current_timestamp()`).join('\nUNION ALL\n');
  const params = [
    { name: 'ver', value: String(version) },
    ...rs.flatMap((r, i) => [
      { name: `sid${i}`, value: r.sentence_id },
      { name: `verdict${i}`, value: r.verdict },
      { name: `reason${i}`, value: r.reason },
      { name: `model${i}`, value: r.model },
      { name: `trace${i}`, value: r.trace_id },
    ]),
  ];
  const stmt = `MERGE INTO ${FQ}.wording_checks t
     USING (SELECT * FROM (${rows}) AS v(sentence_id, table_version, verdict, reason, model, trace_id, checked_at)) s
     ON t.sentence_id = s.sentence_id AND t.table_version = s.table_version
     WHEN MATCHED THEN UPDATE SET *
     WHEN NOT MATCHED THEN INSERT *`;
  try {
    await sqlRows(stmt, params);
  } catch (e) {
    if (!/CONCURRENT|conflict/i.test((e as Error).message)) throw e;
    await new Promise((ok) => setTimeout(ok, 1500));
    await sqlRows(stmt, params);
  }
}

async function cachedResult(sentenceId: string, version: number): Promise<Result> {
  const rows = await sqlRows(
    `SELECT verdict, reason, model, trace_id FROM ${FQ}.wording_checks
     WHERE sentence_id = :sid AND table_version = CAST(:ver AS BIGINT)
     ORDER BY checked_at DESC LIMIT 1`,
    [
      { name: 'sid', value: sentenceId },
      { name: 'ver', value: String(version) },
    ],
  );
  const row = rows[0];
  if (!row) {
    return {
      sentence_id: sentenceId,
      verdict: 'needs_writer',
      reason: 'The wording check was unavailable and no cached result exists, so the sentence goes to the writer.',
      model: MODEL_LABEL,
      trace_id: null,
      cached: true,
    };
  }
  return {
    sentence_id: sentenceId,
    verdict: row.verdict === 'ok' ? 'ok' : 'needs_writer',
    reason: row.reason ?? '',
    model: row.model ?? MODEL_LABEL,
    trace_id: row.trace_id,
    cached: true,
  };
}

async function checkOne(
  s: SentenceRow,
  cits: Record<string, string | null>[],
  cur: Record<string, string>,
  version: number,
): Promise<Result> {
  const mine = cits.filter((c) => c.sentence_id === s.sentence_id);
  const values: Record<string, string> = {};
  const changes: string[] = [];
  for (const c of mine) {
    const key = c.fig_key as string;
    const oldV = c.value_text as string;
    const newV = cur[key] ?? oldV;
    values[key] = newV;
    if (newV !== oldV) changes.push(`${key}: ${oldV} -> ${newV}`);
  }
  const newText = render(s.template, values);
  const userContent =
    `Sentence before the restatement:\n${s.text_v_prev}\n\n` +
    `Sentence with the updated figures:\n${newText}\n\n` +
    `Changed figures:\n${changes.join('\n') || '(none)'}`;

  await initTracing();
  // Start from the root context: behind the Apps proxy the active context carries an unsampled
  // parent, and mlflow-tracing turns a child of an unsampled span into a no-op span.
  const span = context.with(ROOT_CONTEXT, () =>
    mlflow.startSpan({
      name: 'wording_check',
      spanType: mlflow.SpanType.LLM,
      inputs: { sentence_id: s.sentence_id, prompt: userContent },
      attributes: { model_service: MODEL_SERVICE, table_version: version },
    }),
  );
  const traceId = span.traceId;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const out = await callModel(userContent, ctrl.signal);
    span.end({ outputs: { verdict: out.verdict, reason: out.reason, usage: out.usage } });
    const result: Result = {
      sentence_id: s.sentence_id,
      verdict: out.verdict,
      reason: out.reason,
      model: MODEL_LABEL,
      trace_id: traceId,
      cached: false,
    };
    return result;
  } catch (e) {
    span.end({ status: mlflow.SpanStatusCode.ERROR, outputs: { error: (e as Error).message } });
    console.warn(`[wording-check] ${s.sentence_id}: falling back to cache (${(e as Error).message})`);
    return cachedResult(s.sentence_id, version);
  } finally {
    clearTimeout(timer);
  }
}

/** Warm the caches and MLflow so the first live call in the demo is not the cold one. */
export async function warmWordingCheck() {
  try {
    await Promise.all([loadContext([]), currentEfficacyVersion(), initTracing()]);
  } catch (e) {
    console.warn('[wording-check] warm-up failed:', (e as Error).message);
  }
}

export function registerWordingCheck(app: Application) {
  app.post('/api/wording-check', async (req: Request, res: Response) => {
    const ids = (req.body as { sentence_ids?: unknown })?.sentence_ids;
    /* After a reload the review is already recorded: read the saved verdicts instead of calling the model again. */
    const preferCached = (req.body as { prefer_cached?: unknown })?.prefer_cached === true;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 25 || !ids.every((i) => typeof i === 'string' && /^[\w.-]+$/.test(i))) {
      res.status(400).json({ error: 'sentence_ids must be a non-empty array of sentence ids' });
      return;
    }
    try {
      const version = await currentEfficacyVersion();
      const { sentences, cits, cur } = await loadContext(ids as string[]);
      const byId = new Map(sentences.map((s) => [s.sentence_id, s]));
      const results = await Promise.all(
        (ids as string[]).map((id) => {
          const s = byId.get(id);
          return s && !preferCached ? checkOne(s, cits, cur, version) : cachedResult(id, version);
        }),
      );
      res.json(results);
      void mlflow.flushTraces().catch(() => undefined);
      void persistBatch(results.filter((r) => !r.cached), version).catch((e: Error) => console.warn('[wording-check] persist failed:', e.message));
    } catch (e) {
      console.error('[wording-check]', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
