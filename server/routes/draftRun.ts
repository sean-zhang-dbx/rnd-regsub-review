import { ROOT_CONTEXT, context } from '@opentelemetry/api';
import { ServiceContext } from '@databricks/appkit';
import type { Application, Request, Response } from 'express';
import { FQ, MODEL_LABEL, dbxFetch, sqlRows } from '../lib/dbx';
import { initTracing, mlflow } from '../lib/tracing';
import {
  OUTLINES,
  SLOTS,
  SOURCE_VERSION,
  bind,
  callModel,
  lastDraft,
  persist,
  slotValues,
} from './draftSection';
import type { DraftResult } from './draftSection';

/*
 * Drafting run: the drafting beat as a sequence of visible, traced steps. Each step is streamed to the
 * client as a server-sent event and recorded as a child span of one MLflow trace.
 *   1. read_sources  the protocol and SAP passages, from the ai_parse_document layout (doc_elements)
 *   2. find_table    the certified table in Unity Catalog, with its tags, at the drafting version
 *   3. draft         the model drafts with a placeholder for each figure (it is given no values)
 *   4. fill          SQL fills each placeholder from the table at version 3
 *   5. check         a code check (no figure typed by the model) and an LLM judge (a different model
 *                    family) on whether the draft agrees with the protocol and SAP
 */

const JUDGE_ENDPOINT = 'databricks-gpt-5-5';
const JUDGE_LABEL = 'GPT 5.5';
const TIMEOUT_MS = 25_000;

/** The passages the draft must agree with: chosen by content, located by ai_parse_document. */
const SOURCE_QUERIES = [
  { doc: '%Protocol%', like: '%discontinue study treatment before Week 52%' },
  { doc: '%SAP%', like: '%primary endpoint is the proportion%' },
];

interface Box {
  element_id: number;
  element_type: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  used: boolean;
}
interface SourcePage {
  doc_title: string;
  file_path: string;
  page: number;
  image_path: string;
  width: number;
  height: number;
  excerpt: string;
  boxes: Box[];
}

async function readSources(): Promise<SourcePage[]> {
  const out: SourcePage[] = [];
  for (const s of SOURCE_QUERIES) {
    const hit = (
      await sqlRows(
        `SELECT file_path, doc_title, page, element_id, content FROM ${FQ}.doc_elements
         WHERE file_path LIKE :doc AND content LIKE :like ORDER BY page, element_id LIMIT 1`,
        [
          { name: 'doc', value: s.doc },
          { name: 'like', value: s.like },
        ],
      )
    )[0];
    if (!hit) continue;
    const [pageRows, boxRows] = await Promise.all([
      sqlRows(`SELECT image_path, width, height FROM ${FQ}.doc_pages WHERE file_path = :f AND page = CAST(:p AS INT)`, [
        { name: 'f', value: hit.file_path },
        { name: 'p', value: hit.page },
      ]),
      sqlRows(
        `SELECT element_id, element_type, x0, y0, x1, y1 FROM ${FQ}.doc_elements
         WHERE file_path = :f AND page = CAST(:p AS INT) ORDER BY element_id`,
        [
          { name: 'f', value: hit.file_path },
          { name: 'p', value: hit.page },
        ],
      ),
    ]);
    const pg = pageRows[0];
    if (!pg) continue;
    out.push({
      doc_title: hit.doc_title as string,
      file_path: hit.file_path as string,
      page: Number(hit.page),
      image_path: pg.image_path as string,
      width: Number(pg.width),
      height: Number(pg.height),
      excerpt: (hit.content as string).replace(/\s+/g, ' ').trim(),
      boxes: boxRows.map((b) => ({
        element_id: Number(b.element_id),
        element_type: b.element_type as string,
        x0: Number(b.x0),
        y0: Number(b.y0),
        x1: Number(b.x1),
        y1: Number(b.y1),
        used: Number(b.element_id) === Number(hit.element_id),
      })),
    });
  }
  return out;
}

async function findTable() {
  const [tags, comment] = await Promise.all([
    sqlRows(
      `SELECT tag_name, tag_value FROM sean_zhang_catalog.information_schema.table_tags
       WHERE schema_name = 'rnd_regsub_review' AND table_name = 'efficacy_primary' ORDER BY tag_name`,
    ),
    sqlRows(
      `SELECT comment FROM sean_zhang_catalog.information_schema.tables
       WHERE table_schema = 'rnd_regsub_review' AND table_name = 'efficacy_primary'`,
    ),
  ]);
  return {
    table: `${FQ}.efficacy_primary`,
    tlf: 'Table 14.2.1',
    version: SOURCE_VERSION,
    tags: tags.map((t) => ({ name: t.tag_name as string, value: (t.tag_value as string) ?? '' })),
    comment: (comment[0]?.comment as string) ?? '',
  };
}

async function judge(draft: string[], sources: SourcePage[], outline: string[], signal: AbortSignal) {
  const prompt =
    'You check a drafted section of a clinical study report against its inputs.\n\n' +
    'Study context: LMN-301, a 52-week Phase III study of LMN-4471 400 mg once daily versus placebo.\n\n' +
    `Writer's outline for the section:\n${outline.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\n` +
    `Source passages, located by ai_parse_document:\n${sources.map((s) => `[${s.doc_title}, page ${s.page}] ${s.excerpt}`).join('\n')}\n\n` +
    `Draft (figures are placeholders in curly braces and are filled from a certified table later):\n${draft.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\n` +
    'Question: does any sentence of the draft contradict the source passages, or state something that is neither in the outline, ' +
    'the study context nor the source passages? A section does not need to repeat every detail of the passages, so do not count omissions. ' +
    'Reply with one JSON object and nothing else: {"verdict": "yes" | "no", "reason": "<one plain sentence of at most 25 words>"}, ' +
    'where "yes" means the draft is consistent with its inputs.';
  const out = await dbxFetch<{ choices: { message: { content: string } }[] }>(`/serving-endpoints/${JUDGE_ENDPOINT}/invocations`, {
    body: { messages: [{ role: 'user', content: prompt }], max_tokens: 600 },
    signal,
  });
  const content = out.choices?.[0]?.message?.content ?? '';
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('unparseable judge output');
  const parsed = JSON.parse(m[0]) as { verdict?: string; reason?: string };
  return { verdict: parsed.verdict === 'yes' ? 'yes' : 'no', reason: String(parsed.reason ?? ''), model: JUDGE_LABEL };
}

export function registerDraftRun(app: Application) {
  app.post('/api/draft-run', async (req: Request, res: Response) => {
    const section = (req.body as { section?: unknown })?.section;
    if (typeof section !== 'string' || !(section in OUTLINES)) {
      res.status(400).json({ error: `section must be one of ${Object.keys(OUTLINES).join(', ')}` });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    await initTracing();
    const root = context.with(ROOT_CONTEXT, () =>
      mlflow.startSpan({ name: 'draft_run', spanType: mlflow.SpanType.CHAIN, inputs: { section } }),
    );
    const step = async <T>(id: string, title: string, run: () => Promise<T>, summarize: (r: T) => Record<string, unknown>) => {
      send({ step: id, title, status: 'running' });
      const span = mlflow.startSpan({ name: id, parent: root, inputs: { section } });
      const t0 = Date.now();
      try {
        const r = await run();
        const detail = summarize(r);
        span.end({ outputs: detail });
        send({ step: id, title, status: 'done', ms: Date.now() - t0, detail });
        return r;
      } catch (e) {
        span.end({ status: mlflow.SpanStatusCode.ERROR, outputs: { error: (e as Error).message } });
        send({ step: id, title, status: 'error', ms: Date.now() - t0, error: (e as Error).message });
        throw e;
      }
    };

    const spec = OUTLINES[section];
    try {
      const sources = await step('read_sources', 'Read the protocol and SAP', readSources, (s) => ({ sources: s }));
      const table = await step('find_table', 'Find the certified table', findTable, (t) => t);
      const values = await slotValues();

      const userContent =
        `Section: ${spec.title}\n\nOutline:\n${spec.outline.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\n` +
        `Source passages (use their wording for the endpoint and the analysis):\n` +
        sources.map((s) => `[${s.doc_title}, page ${s.page}] ${s.excerpt}`).join('\n') +
        `\n\nPlaceholders you may use (from ${table.tlf}, efficacy_primary):\n` +
        Object.entries(SLOTS)
          .map(([k, d]) => `{${k}}: ${d}`)
          .join('\n');

      let cached: DraftResult | null = null;
      const drafted = await step(
        'draft',
        'Draft the sentences',
        async () => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
          try {
            return (await callModel(userContent, ctrl.signal)).templates;
          } catch (e) {
            console.warn(`[draft-run] ${section}: model failed, using the last stored draft (${(e as Error).message})`);
            cached = await lastDraft(section, values);
            if (!cached) throw e;
            return cached.sentences.map((s) => s.template);
          } finally {
            clearTimeout(timer);
          }
        },
        (t) => ({ templates: t, model: 'Claude Sonnet 5.5 via Unity Gateway', cached: cached !== null }),
      );

      const bound = await step(
        'fill',
        'Fill the figures with SQL',
        () => Promise.resolve(bind(drafted, values)),
        (b) => ({
          sentences: b.sentences,
          figure_count: b.figures,
          query: `SELECT … FROM ${table.table} VERSION AS OF ${SOURCE_VERSION}`,
        }),
      );

      const checks = await step(
        'check',
        'Check the draft',
        async () => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
          try {
            const j = await judge(drafted, sources, spec.outline, ctrl.signal).catch((e: Error) => ({ verdict: 'unavailable', reason: e.message, model: JUDGE_LABEL }));
            return { typed: bound.typed, unknown: bound.unknown, judge: j };
          } finally {
            clearTimeout(timer);
          }
        },
        (c) => ({ typed_numbers: c.typed, unknown_slots: c.unknown, judge: c.judge }),
      );

      const result: DraftResult = {
        section,
        source_version: SOURCE_VERSION,
        sentences: bound.sentences,
        figure_count: bound.figures,
        typed_numbers: bound.typed,
        unknown_slots: bound.unknown,
        model: MODEL_LABEL,
        trace_id: root.traceId,
        cached: cached !== null,
        drafted_at: new Date().toISOString(),
      };
      root.end({ outputs: { templates: drafted, figure_count: bound.figures, typed_numbers: bound.typed, unknown_slots: bound.unknown, judge: checks.judge } });
      send({ step: 'done', status: 'done', result });
      if (!result.cached) void persist(result).catch((e) => console.warn('[draft-run] persist failed:', (e as Error).message));
      void mlflow.flushTraces().catch(() => undefined);
    } catch (e) {
      root.end({ status: mlflow.SpanStatusCode.ERROR, outputs: { error: (e as Error).message } });
      send({ step: 'done', status: 'error', error: (e as Error).message });
    } finally {
      res.end();
    }
  });

  /** Page images written by ai_parse_document, read from the volume as the app identity. */
  app.get('/api/page-image', async (req: Request, res: Response) => {
    const path = typeof req.query.path === 'string' ? req.query.path : '';
    if (!/^\/Volumes\/sean_zhang_catalog\/rnd_regsub_review\/parsed_pages\/[\w.-]+\.jpg$/.test(path)) {
      res.status(400).json({ error: 'path must be a page image in volume parsed_pages' });
      return;
    }
    try {
      const w = ServiceContext.get().client;
      const headers = new Headers();
      await w.config.authenticate(headers);
      const host = (w.config.host ?? '').replace(/\/$/, '');
      const r = await fetch(`${host}/api/2.0/fs/files${path}`, { headers });
      if (!r.ok) throw new Error(`${r.status} reading ${path}`);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
  });
}

