import type { LiveSpan } from 'mlflow-tracing';
import { MODEL_SERVICE, dbxFetch } from '../dbx';
import { mlflow } from '../tracing';

/*
 * One agent of the CSR Pod is a model in a loop: it reads its skill (the system prompt), picks tools,
 * reads their results and stops when a tool says the work is saved. Every model call and every tool call
 * is a child span of the agent's span, so the whole pod run is one MLflow trace.
 */

const CALL_TIMEOUT_MS = 60_000;

export interface ToolResult {
  ok: boolean;
  /** One line for the live log in the app. */
  summary: string;
  /** What the model reads back. */
  content: unknown;
  /** Shown in the drawer and stored with the event; not sent to the model. */
  detail?: unknown;
  /** True when this result ends the agent's work (for example an accepted save). */
  stop?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;
}

export interface ToolCallRecord {
  tool: string;
  args: unknown;
  ok: boolean;
  result_summary: string;
  ms: number;
  /** What the call returned in more detail, for the drawer (the AI Search queries and the passages found). */
  detail?: unknown;
}

type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: unknown; tool_calls?: RawToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

interface RawToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatResponse {
  choices?: { message: { role: 'assistant'; content: unknown; tool_calls?: RawToolCall[] }; finish_reason?: string }[];
  usage?: Record<string, number>;
}

export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b: { type?: string; text?: unknown }) => (b?.type !== 'reasoning' && typeof b?.text === 'string' ? b.text : '')).join('');
  }
  return '';
}

/** Run a small number of async jobs at a time. */
export function pool(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(job: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((ok) => queue.push(ok));
    active++;
    try {
      return await job();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

/** Model calls across the whole pod share one limit, so 25 agents do not hit the gateway at once. */
export const modelSlot = pool(8);

export async function agentLoop(opts: {
  name: string;
  system: string;
  user: string;
  tools: ToolDef[];
  parent: LiveSpan;
  maxTurns?: number;
  maxTokens?: number;
  onTool?: (call: ToolCallRecord) => void;
  signal?: AbortSignal;
}): Promise<{ turns: number; stopped: boolean; final: string; log: ToolCallRecord[] }> {
  const span = mlflow.startSpan({ name: opts.name, parent: opts.parent, spanType: mlflow.SpanType.AGENT, inputs: { user: opts.user } });
  const messages: ChatMessage[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.user },
  ];
  const tools = opts.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const byName = new Map(opts.tools.map((t) => [t.name, t]));
  const log: ToolCallRecord[] = [];
  const maxTurns = opts.maxTurns ?? 8;
  let final = '';
  try {
    for (let turn = 1; turn <= maxTurns; turn++) {
      if (opts.signal?.aborted) throw new Error('run cancelled');
      const llm = mlflow.startSpan({ name: `${opts.name}.model`, parent: span, spanType: mlflow.SpanType.CHAT_MODEL, inputs: { turn, model: MODEL_SERVICE } });
      let out: ChatResponse;
      try {
        out = await modelSlot(async () => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
          try {
            return await dbxFetch<ChatResponse>('/ai-gateway/mlflow/v1/chat/completions', {
              body: { model: MODEL_SERVICE, max_tokens: opts.maxTokens ?? 3000, messages, tools },
              signal: ctrl.signal,
            });
          } finally {
            clearTimeout(timer);
          }
        });
      } catch (e) {
        llm.end({ status: mlflow.SpanStatusCode.ERROR, outputs: { error: (e as Error).message } });
        throw e;
      }
      const msg = out.choices?.[0]?.message;
      const calls = msg?.tool_calls ?? [];
      llm.end({ outputs: { text: textOf(msg?.content), tool_calls: calls.map((c) => c.function), usage: out.usage } });
      if (!msg) throw new Error('model returned no message');
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: calls.length ? calls : undefined });
      if (calls.length === 0) {
        final = textOf(msg.content);
        span.end({ outputs: { turns: turn, stopped: false, final } });
        return { turns: turn, stopped: false, final, log };
      }
      const results = await Promise.all(
        calls.map(async (c) => {
          const tool = byName.get(c.function.name);
          let args: Record<string, unknown> = {};
          try {
            args = c.function.arguments ? (JSON.parse(c.function.arguments) as Record<string, unknown>) : {};
          } catch {
            /* handled below as a failed call */
          }
          const ts = mlflow.startSpan({ name: c.function.name, parent: span, spanType: mlflow.SpanType.TOOL, inputs: args });
          const t0 = Date.now();
          let r: ToolResult;
          try {
            r = tool ? await tool.run(args) : { ok: false, summary: `unknown tool ${c.function.name}`, content: { error: `unknown tool ${c.function.name}` } };
          } catch (e) {
            r = { ok: false, summary: (e as Error).message.slice(0, 160), content: { error: (e as Error).message } };
          }
          ts.end({ outputs: { ok: r.ok, summary: r.summary, content: r.content } });
          const rec: ToolCallRecord = { tool: c.function.name, args, ok: r.ok, result_summary: r.summary, ms: Date.now() - t0, ...(r.detail === undefined ? {} : { detail: r.detail }) };
          log.push(rec);
          opts.onTool?.(rec);
          messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(r.content) });
          return r;
        }),
      );
      if (results.some((r) => r.stop && r.ok)) {
        span.end({ outputs: { turns: turn, stopped: true, tools: log.map((l) => `${l.tool}:${l.ok ? 'ok' : 'rejected'}`) } });
        return { turns: turn, stopped: true, final, log };
      }
    }
    span.end({ outputs: { turns: maxTurns, stopped: false, note: 'turn limit reached' } });
    return { turns: maxTurns, stopped: false, final, log };
  } catch (e) {
    span.end({ status: mlflow.SpanStatusCode.ERROR, outputs: { error: (e as Error).message } });
    throw e;
  }
}
