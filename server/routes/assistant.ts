import { ROOT_CONTEXT, context } from '@opentelemetry/api';
import type { Application, Request, Response } from 'express';
import { FQ, INDEX_NAME, MODEL_SERVICE, dbxFetch, sqlRows, userToken } from '../lib/dbx';
import { initTracing, mlflow } from '../lib/tracing';
import { askGenie } from './genie';
import type { GenieAnswer } from './genie';

/*
 * Reviewer assistant. For each question a model decides which sources to use: the Genie Agent for figures
 * in the certified tables, AI Search over the parsed source documents for what the documents say, or both.
 * The answer is written from those results only, with numbered citations; each cited passage comes with its
 * page from ai_parse_document so the app can show where it sits. Streamed as server-sent events.
 */

const TIMEOUT_MS = 25_000;

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

async function chat(system: string, user: string, maxTokens: number): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const out = await dbxFetch<{ choices: { message: { content: string | { text?: string }[] } }[] }>('/ai-gateway/mlflow/v1/chat/completions', {
      body: {
        model: MODEL_SERVICE,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      signal: ctrl.signal,
    });
    const raw = out.choices?.[0]?.message?.content ?? '';
    return Array.isArray(raw) ? raw.map((b) => (typeof b?.text === 'string' ? b.text : '')).join('') : raw;
  } finally {
    clearTimeout(timer);
  }
}

function json<T>(text: string): T {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`unparseable model output: ${text.slice(0, 120)}`);
  return JSON.parse(m[0]) as T;
}

const BACKGROUND = `Background you can rely on: Biostatistics re-delivered Table 14.2.1 (efficacy_primary) on 19 October 2026 at 09:12, version 3 to version 4, after a late data correction. In version 3 the LMN-4471 arm had 412 of 618 responders (66.7%); version 4 has 409 of 618 (66.2%). The Genie Agent queries the current version. The dossier under review is the CSR, Module 2 and the label. The protocol, the SAP, the Investigator's Brochure, the advisory briefing book, the DSUR and the plain-language summary are reference documents outside the dossier.`;

const ROUTER = `You route a regulatory reviewer's question about the fictional study LMN-301 (LMN-4471 400 mg versus placebo) to its sources.
Sources:
- "tables": the certified analysis tables (efficacy_primary is Table 14.2.1, the Week 52 responder analysis; safety_overview is Table 14.3.1, adverse events). Use for numbers, results, counts and rates.
- "documents": the parsed source documents (protocol v3, SAP v2, Investigator's Brochure v7, advisory briefing book draft, DSUR 2025, plain-language summary draft). Use for definitions, methods, what a document says, or where something is quoted.
Reply with one JSON object and nothing else: {"tables": true|false, "documents": true|false, "table_question": "<the question rephrased for the tables, or empty>", "search": "<keywords and phrases for document search, or empty>"}`;

const COMPOSER = `You are a regulatory reviewer's assistant for the fictional study LMN-301. Answer the question in at most 4 plain sentences, in British English.
Use only the table result and the numbered passages you are given. Quote figures only as they appear there, and never calculate new ones.
Cite passages with their number in square brackets, for example [1]. When a figure comes from the table result, say it comes from the Genie Agent.
If the sources do not answer the question, say so in one sentence. Do not comment on which sources were or were not consulted. Do not use em dashes.

${BACKGROUND}`;

interface Passage {
  n: number;
  doc_title: string;
  file_path: string;
  page: number;
  text: string;
}

async function searchDocs(query: string): Promise<Passage[]> {
  const out = await dbxFetch<{ result?: { data_array?: [string, string, number, string, number][] } }>(
    `/api/2.0/vector-search/indexes/${INDEX_NAME}/query`,
    { body: { query_text: query, columns: ['doc_title', 'file_path', 'page', 'chunk_text'], num_results: 4, query_type: 'HYBRID' } },
  );
  return (out.result?.data_array ?? []).map(([doc_title, file_path, page, chunk], i) => ({
    n: i + 1,
    doc_title,
    file_path,
    page: Number(page),
    text: chunk.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  }));
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9.]{3,}/g) ?? []);

/** The page of a cited passage, with its layout; the element that best matches the query is marked as used. */
async function pageView(p: Passage, query: string) {
  const [pg, els] = await Promise.all([
    sqlRows(`SELECT image_path, width, height FROM ${FQ}.doc_pages WHERE file_path = :f AND page = CAST(:p AS INT)`, [
      { name: 'f', value: p.file_path },
      { name: 'p', value: String(p.page) },
    ]),
    sqlRows(`SELECT element_id, element_type, content, x0, y0, x1, y1 FROM ${FQ}.doc_elements WHERE file_path = :f AND page = CAST(:p AS INT) ORDER BY element_id`, [
      { name: 'f', value: p.file_path },
      { name: 'p', value: String(p.page) },
    ]),
  ]);
  if (!pg[0]) return null;
  const q = words(query);
  let best = -1;
  let bestScore = 0;
  for (const e of els) {
    if (!['text', 'table', 'figure', 'caption'].includes(e.element_type as string)) continue;
    const w = words(e.content as string);
    const score = [...q].filter((t) => w.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = Number(e.element_id);
    }
  }
  return {
    doc_title: p.doc_title,
    file_path: p.file_path,
    page: p.page,
    image_path: pg[0].image_path as string,
    width: Number(pg[0].width),
    height: Number(pg[0].height),
    excerpt: p.text.slice(0, 300),
    boxes: els.map((e) => ({
      element_id: Number(e.element_id),
      element_type: e.element_type as string,
      x0: Number(e.x0),
      y0: Number(e.y0),
      x1: Number(e.x1),
      y1: Number(e.y1),
      used: Number(e.element_id) === best,
    })),
  };
}

export function registerAssistant(app: Application) {
  app.post('/api/assistant', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { question?: unknown; history?: unknown; genie_conversation_id?: unknown };
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > 1000) {
      res.status(400).json({ error: 'question must be a non-empty string' });
      return;
    }
    const history = (Array.isArray(body.history) ? (body.history as Partial<Turn>[]) : [])
      .filter((t): t is Turn => typeof t?.content === 'string' && (t.role === 'user' || t.role === 'assistant'))
      .slice(-6);
    const genieConv = typeof body.genie_conversation_id === 'string' ? body.genie_conversation_id : undefined;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (event: Record<string, unknown>) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    await initTracing();
    const root = context.with(ROOT_CONTEXT, () =>
      mlflow.startSpan({ name: 'reviewer_assistant', spanType: mlflow.SpanType.CHAIN, inputs: { question, history } }),
    );
    try {
      const convo = history.map((t) => `${t.role === 'user' ? 'Reviewer' : 'Assistant'}: ${t.content}`).join('\n');
      const routeSpan = mlflow.startSpan({ name: 'route', parent: root, inputs: { question } });
      const route = json<{ tables?: boolean; documents?: boolean; table_question?: string; search?: string }>(
        await chat(ROUTER, `${convo ? `Conversation so far:\n${convo}\n\n` : ''}Question: ${question}`, 400),
      );
      const useTables = route.tables === true;
      const useDocs = route.documents === true || !useTables;
      routeSpan.end({ outputs: route });
      send({ event: 'route', tables: useTables, documents: useDocs });

      const [genie, passages] = await Promise.all([
        useTables
          ? (async () => {
              const s = mlflow.startSpan({ name: 'genie_agent', parent: root, spanType: mlflow.SpanType.TOOL, inputs: { question: route.table_question || question } });
              try {
                const g = await askGenie(route.table_question || question, userToken(req), genieConv);
                s.end({ outputs: { answer_text: g.answer_text, sql: g.sql, rows: g.rows.slice(0, 10) } });
                send({ event: 'tables', genie: g });
                return g;
              } catch (e) {
                s.end({ status: mlflow.SpanStatusCode.ERROR, outputs: { error: (e as Error).message } });
                send({ event: 'tables', error: (e as Error).message });
                return null;
              }
            })()
          : Promise.resolve(null as GenieAnswer | null),
        useDocs
          ? (async () => {
              const query = route.search || question;
              const s = mlflow.startSpan({ name: 'ai_search', parent: root, spanType: mlflow.SpanType.RETRIEVER, inputs: { query } });
              try {
                const ps = await searchDocs(query);
                s.end({ outputs: ps.map((p) => ({ doc_title: p.doc_title, page: p.page })) });
                send({ event: 'documents', count: ps.length });
                return ps;
              } catch (e) {
                s.end({ status: mlflow.SpanStatusCode.ERROR, outputs: { error: (e as Error).message } });
                send({ event: 'documents', error: (e as Error).message });
                return [] as Passage[];
              }
            })()
          : Promise.resolve([] as Passage[]),
      ]);

      const composeSpan = mlflow.startSpan({ name: 'compose', parent: root, spanType: mlflow.SpanType.LLM });
      const context_ =
        (genie ? `Table result from the Genie Agent:\n${genie.answer_text}\nRows: ${JSON.stringify(genie.rows.slice(0, 10))}\n\n` : '') +
        (passages.length ? `Passages:\n${passages.map((p) => `[${p.n}] ${p.doc_title}, page ${p.page}: ${p.text.slice(0, 900)}`).join('\n')}\n\n` : '');
      const answer = (await chat(COMPOSER, `${convo ? `Conversation so far:\n${convo}\n\n` : ''}${context_}Question: ${question}`, 700)).trim();
      composeSpan.end({ outputs: { answer } });

      const cited = [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))];
      const sources = (
        await Promise.all(
          passages
            .filter((p) => cited.includes(p.n))
            .map(async (p) => ({ n: p.n, doc_title: p.doc_title, page: p.page, snippet: p.text.slice(0, 220), view: await pageView(p, `${route.search ?? ''} ${question}`).catch(() => null) })),
        )
      ).sort((a, b) => a.n - b.n);
      root.end({ outputs: { answer, tables: useTables, documents: useDocs, cited } });
      send({ event: 'answer', answer, sources, genie, trace_id: root.traceId });
      void mlflow.flushTraces().catch(() => undefined);
    } catch (e) {
      root.end({ status: mlflow.SpanStatusCode.ERROR, outputs: { error: (e as Error).message } });
      send({ event: 'error', error: (e as Error).message });
    } finally {
      res.end();
    }
  });
}
