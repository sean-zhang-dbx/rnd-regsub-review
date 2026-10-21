import { randomUUID } from 'node:crypto';
import { ROOT_CONTEXT, context } from '@opentelemetry/api';
import type { LiveSpan } from 'mlflow-tracing';
import { FQ, MODEL_LABEL, dbxFetch, sqlRows } from '../dbx';
import { initTracing, mlflow } from '../tracing';
import { askGenie } from '../../routes/genie';
import { searchDocs } from '../../routes/assistant';
import { SKILLS } from './skills';
import { agentLoop } from './llm';
import type { ToolCallRecord, ToolDef, ToolResult } from './llm';
import {
  allowedNumbers,
  bestElement,
  bind,
  certifiedTables,
  clearTlfCache,
  loadRegistry,
  loadStudyMetadata,
  loadTlf,
  resolvePassage,
} from './data';
import type { AgentId, RegistrySection, Sentence, Slot, SourceRef, TlfData, TlfRef } from './data';
import { assembleFixedParts, documentChecks, textOf } from './assemble';
import type { Check, CsrSection, NeedsPerson } from './assemble';

/*
 * A run of the CSR Pod. Context is loaded, the Document Planner makes the plan, then the CSR Author,
 * Safety Narrative and QC & Consistency agents work in parallel in dependency waves (wave 1: every
 * section without dependencies and every narrative; wave 2: the discussion; wave 3: the synopsis), the
 * QC agent ties headline figures out against the Genie Agent, and the CSR Assembler assembles the fixed
 * parts and runs the document checks. Every step is streamed as an event and recorded in one MLflow trace.
 */

const JUDGE_ENDPOINT = 'databricks-gpt-5-5';
const JUDGE_LABEL = 'GPT 5.5';
const AUTHOR_LABEL = 'Claude Sonnet 5.5 via Unity Gateway';
const EFFICACY_DRAFT_VERSION = 3;

export type PodEvent =
  | { type: 'run'; status: 'running' | 'done' | 'error'; run_id: string; at: string; error?: string; wall_ms?: number }
  | { type: 'agent'; agent: AgentId; status: 'idle' | 'running' | 'done' | 'error'; at: string; summary?: string; progress?: { done: number; total: number } }
  | { type: 'section'; section: string; status: 'planned' | 'drafting' | 'drafted' | 'checked' | 'needs_person' | 'failed' | 'assembled'; agent: AgentId; at: string }
  | { type: 'tool'; agent: AgentId; section?: string; tool: string; args: unknown; ok: boolean; result_summary: string; ms: number; at: string }
  | { type: 'log'; agent: AgentId; section?: string; text: string; at: string };

export interface PlanEntry {
  section: string;
  passages: SourceRef[];
  tlfs: string[];
  depends_on: string[];
  wave: number | null;
}
export interface GenieCheck {
  question: string;
  genie_value: string;
  bound_value: string;
  slot: string;
  table_version_note: string;
  ok: boolean;
}

interface RunState {
  run_id: string;
  base_run_id: string | null;
  requested: string[] | null;
  status: 'running' | 'done' | 'error';
  started_at: string;
  finished_at: string | null;
  wall_ms: number | null;
  trace_id: string | null;
  events: PodEvent[];
  listeners: Set<(e: PodEvent) => void>;
  plan: PlanEntry[];
  sections: Map<string, CsrSection>;
  document_checks: Check[];
  genie_checks: GenieCheck[];
}

const runs = new Map<string, RunState>();
let activeRun: string | null = null;

const now = () => new Date().toISOString();

function emit(st: RunState, e: PodEvent) {
  st.events.push(e);
  for (const l of st.listeners) l(e);
}

export function subscribe(runId: string, listener: (e: PodEvent) => void): { replay: PodEvent[]; done: boolean; unsubscribe: () => void } | null {
  const st = runs.get(runId);
  if (!st) return null;
  st.listeners.add(listener);
  return { replay: [...st.events], done: st.status !== 'running', unsubscribe: () => st.listeners.delete(listener) };
}

export function activeRunId() {
  return activeRun;
}

export function startRun(sections?: string[]): string {
  if (activeRun) throw Object.assign(new Error(`run ${activeRun} is still running`), { status: 409 });
  const run_id = `csr-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}-${randomUUID().slice(0, 6)}`;
  const st: RunState = {
    run_id,
    base_run_id: null,
    requested: sections && sections.length ? sections : null,
    status: 'running',
    started_at: now(),
    finished_at: null,
    wall_ms: null,
    trace_id: null,
    events: [],
    listeners: new Set(),
    plan: [],
    sections: new Map(),
    document_checks: [],
    genie_checks: [],
  };
  runs.set(run_id, st);
  for (const old of [...runs.keys()].slice(0, -5)) runs.delete(old);
  activeRun = run_id;
  void execute(st).finally(() => {
    activeRun = null;
  });
  return run_id;
}

// ------------------------------------------------------------------------------------------------
// Model helpers
// ------------------------------------------------------------------------------------------------

/** Placeholder descriptions for the judge, so it knows what each figure is bound to. Set at the start of each run. */
let slotDescriptions = new Map<string, string>();

function annotated(s: Sentence): string {
  return s.parts
    .map((p) => ('text' in p ? p.text : `{${p.slot}: ${slotDescriptions.get(p.slot) ?? `${p.tlf}, row ${p.row_key}, column ${p.column_name}`}}`))
    .join('');
}

/** Sentences as the QC agent reads them: figures filled, in square brackets, each from a certified cell. */
function bracketed(s: Sentence): string {
  return s.parts.map((p) => ('text' in p ? p.text : `[${p.value}]`)).join('');
}

type Judgement = { verdict: 'yes' | 'no' | 'unavailable'; reason: string; model: string; missing?: string[] };

async function judge(sec: CsrSection, reg: RegistrySection, passages: SourceRef[], extra: string, parent: LiveSpan): Promise<Judgement> {
  const span = mlflow.startSpan({ name: `judge:${sec.section}`, parent, spanType: mlflow.SpanType.LLM, inputs: { section: sec.section, model: JUDGE_ENDPOINT } });
  const prompt =
    'You check a drafted section of a clinical study report against its inputs.\n\n' +
    'Study context: LMN-301, a fictional 52-week Phase III study of LMN-4471 400 mg once daily versus placebo. Synthetic data.\n\n' +
    `Section ${sec.section} ${sec.title}. Writer's instructions:\n${reg.instructions.map((o, i) => `${i + 1}. ${o}`).join('\n')}\n\n` +
    `Required content items: ${reg.required_content.map((c) => `"${c}"`).join(', ') || 'none'}\n\n` +
    (passages.length ? `Source passages, located by ai_parse_document:\n${passages.map((p) => (p.kind === 'passage' ? `[${p.doc_title}, page ${p.page}] ${p.quote}` : '')).join('\n')}\n\n` : '') +
    (extra ? `${extra}\n\n` : '') +
    'Draft. Each figure is a placeholder in curly braces followed by the certified table cell it is filled from by SQL; treat a placeholder as supported by that cell, ' +
    `and treat row labels such as system organ classes or preferred terms in the cell description as supported:\n${sec.sentences.map((s, i) => `${i + 1}. ${annotated(s)}`).join('\n')}\n\n` +
    'Questions: (1) does any sentence contradict the inputs, or state something that is neither in the instructions, the study context, the passages nor the cited cells? Do not count omissions. ' +
    '(2) Which required content items does the draft not cover, judging by meaning rather than exact words? ' +
    'Reply with one JSON object and nothing else: {"verdict": "yes" | "no", "reason": "<one plain sentence of at most 25 words>", "missing": ["<required item not covered>", ...]}, where "yes" means consistent with its inputs.';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const out = await dbxFetch<{ choices: { message: { content: string } }[] }>(`/serving-endpoints/${JUDGE_ENDPOINT}/invocations`, {
      body: { messages: [{ role: 'user', content: prompt }], max_tokens: 4000, reasoning_effort: 'low' },
      signal: ctrl.signal,
    });
    const m = (out.choices?.[0]?.message?.content ?? '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('unparseable judge output');
    const parsed = JSON.parse(m[0]) as { verdict?: string; reason?: string; missing?: unknown };
    const r: Judgement = { verdict: parsed.verdict === 'yes' ? 'yes' : 'no', reason: str(parsed.reason), model: JUDGE_LABEL, missing: strArray(parsed.missing) };
    span.end({ outputs: r });
    return r;
  } catch (e) {
    span.end({ status: mlflow.SpanStatusCode.ERROR, outputs: { error: (e as Error).message } });
    return { verdict: 'unavailable', reason: (e as Error).message.slice(0, 160), model: JUDGE_LABEL };
  } finally {
    clearTimeout(timer);
  }
}

const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function coverage(text: string, phrase: string): boolean {
  const t = text.toLowerCase();
  const ws = phrase.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  if (ws.length === 0) return true;
  return ws.filter((w) => t.includes(w.slice(0, Math.max(4, w.length - 2)))).length / ws.length >= 0.6;
}

function sectionChecks(sec: CsrSection, reg: RegistrySection | undefined, tlfNumbers: Set<string>, typed: string[], unknown: string[]): Check[] {
  const text = sec.sentences.map(textOf).join(' ');
  const refs = [...new Set(text.match(/Table 14\.\d+\.\d+/g) ?? [])];
  const missingRefs = refs.filter((r) => !tlfNumbers.has(r.replace('Table ', '')));
  const missingContent = (reg?.required_content ?? []).filter((p) => !coverage(text, p));
  const unsourced = sec.sentences.map((s, i) => (s.sources.length ? -1 : i + 1)).filter((i) => i > 0);
  return [
    { id: 'no_typed_figures', label: 'No figure typed by the model', ok: typed.length === 0, detail: typed.length ? `typed: ${typed.join(', ')}` : undefined },
    { id: 'all_slots_bound', label: 'Every placeholder bound to a certified cell', ok: unknown.length === 0, detail: unknown.length ? `unknown: ${unknown.join(', ')}` : undefined },
    { id: 'tlf_references', label: 'Every table reference exists', ok: missingRefs.length === 0, detail: missingRefs.length ? missingRefs.join(', ') : refs.length ? refs.join(', ') : 'no table references' },
    { id: 'required_content', label: 'Required content covered', ok: missingContent.length === 0, detail: missingContent.length ? `missing: ${missingContent.join('; ')}` : `${reg?.required_content.length ?? 0} items` },
    { id: 'every_sentence_sourced', label: 'Every sentence has a recorded source', ok: unsourced.length === 0, detail: unsourced.length ? `sentences ${unsourced.join(', ')}` : undefined },
  ];
}

// ------------------------------------------------------------------------------------------------
// Persistence
// ------------------------------------------------------------------------------------------------

async function persistSection(runId: string, s: CsrSection) {
  await sqlRows(
    `INSERT INTO ${FQ}.csr_sections (run_id, section, title, ord, kind, agent, department, status, templates_json, sentences_json, sources_json,
       checks_json, judge_json, needs_person_json, tool_log_json, trace_id, drafted_at)
     VALUES (:run, :sec, :title, CAST(:ord AS INT), :kind, :agent, :dept, :status, :tpl, :sent, :src, :checks, :judge, :np, :tools, :trace,
       CAST(:at AS TIMESTAMP))`,
    [
      { name: 'run', value: runId },
      { name: 'sec', value: s.section },
      { name: 'title', value: s.title },
      { name: 'ord', value: String(s.ord) },
      { name: 'kind', value: s.kind },
      { name: 'agent', value: s.agent },
      { name: 'dept', value: s.department },
      { name: 'status', value: s.status },
      { name: 'tpl', value: JSON.stringify(s.sentences.map((x) => x.template)) },
      { name: 'sent', value: JSON.stringify({ sentences: s.sentences, html: s.html ?? null }) },
      { name: 'src', value: JSON.stringify(s.sentences.map((x) => x.sources)) },
      { name: 'checks', value: JSON.stringify(s.checks) },
      { name: 'judge', value: s.judge ? JSON.stringify(s.judge) : null },
      { name: 'np', value: JSON.stringify(s.needs_person) },
      { name: 'tools', value: JSON.stringify(s.tool_log) },
      { name: 'trace', value: s.trace_id },
      { name: 'at', value: s.drafted_at },
    ],
  );
  const cites = s.sentences.flatMap((x, i) =>
    x.parts.flatMap((p) =>
      'slot' in p
        ? [{ sentence_idx: i, slot: p.slot, source_table: p.source_table, tlf: p.tlf, row_key: p.row_key, column_name: p.column_name, table_version: p.table_version, value_text: p.value }]
        : [],
    ),
  );
  if (cites.length === 0) return;
  await sqlRows(
    `INSERT INTO ${FQ}.csr_figure_citations (run_id, section, sentence_idx, slot, source_table, tlf, row_key, column_name, table_version, value_text)
     SELECT :run, :sec, c.sentence_idx, c.slot, c.source_table, c.tlf, c.row_key, c.column_name, c.table_version, c.value_text
     FROM (SELECT explode(from_json(:j, 'array<struct<sentence_idx:int,slot:string,source_table:string,tlf:string,row_key:string,column_name:string,table_version:bigint,value_text:string>>')) AS c) t`,
    [
      { name: 'run', value: runId },
      { name: 'sec', value: s.section },
      { name: 'j', value: JSON.stringify(cites) },
    ],
  );
}

// ------------------------------------------------------------------------------------------------
// The run
// ------------------------------------------------------------------------------------------------

async function execute(st: RunState) {
  const t0 = Date.now();
  await initTracing();
  const root = context.with(ROOT_CONTEXT, () =>
    mlflow.startSpan({ name: 'csr_pod_run', spanType: mlflow.SpanType.CHAIN, inputs: { run_id: st.run_id, sections: st.requested ?? 'all' } }),
  );
  st.trace_id = root.traceId ?? null;
  emit(st, { type: 'run', status: 'running', run_id: st.run_id, at: now() });
  const agentEv = (agent: AgentId, status: 'idle' | 'running' | 'done' | 'error', summary?: string, progress?: { done: number; total: number }) =>
    emit(st, { type: 'agent', agent, status, at: now(), summary, progress });
  const sectionEv = (section: string, status: Extract<PodEvent, { type: 'section' }>['status'], agent: AgentId) => emit(st, { type: 'section', section, status, agent, at: now() });
  const toolEv = (agent: AgentId, section: string | undefined) => (c: ToolCallRecord) => emit(st, { type: 'tool', agent, section, ...c, at: now() });
  const logEv = (agent: AgentId, text: string, section?: string) => emit(st, { type: 'log', agent, section, text, at: now() });

  try {
    clearTlfCache();
    // ---------------------------------------------------------------- Context
    agentEv('context', 'running', 'Loading the certified context');
    const base = st.requested ? await latestDoneRunId() : null;
    if (st.requested && !base) throw new Error('there is no finished run to redraft from; draft the whole CSR first');
    st.base_run_id = base;
    const [registry, certified, meta, narrativeRows, baseDoc] = await Promise.all([
      loadRegistry(),
      certifiedTables(),
      loadStudyMetadata(),
      sqlRows(`SELECT * FROM ${FQ}.narrative_patients ORDER BY row_key`),
      base ? loadDocument(base) : Promise.resolve(null),
    ]);
    const refKey = (r: TlfRef) => `${r.table}@${r.version ?? 'current'}`;
    const refs = new Map<string, TlfRef>();
    for (const r of registry) for (const t of r.tlf_tables) refs.set(refKey(t), t);
    const tlfs = await Promise.all([...refs.values()].map((r) => loadTlf(r)));
    const tlfByKey = new Map(tlfs.map((t) => [refKey(t.ref), t]));
    const slotIndex = new Map<string, Slot>();
    for (const t of tlfs) for (const s of t.slots) slotIndex.set(s.name, s);
    for (const s of meta.slots) slotIndex.set(s.name, s);
    slotDescriptions = new Map([...slotIndex.values()].map((x) => [x.name, x.description]));
    const tlfNumbers = new Set(certified.map((c) => c.tlf.replace('Table ', '')).filter(Boolean));
    const hints = new Map<string, SourceRef[]>();
    await Promise.all(
      registry.map(async (r) => {
        const resolved = await Promise.all(r.source_passages.map((h) => resolvePassage(h).catch(() => null)));
        hints.set(r.section, resolved.filter((x): x is SourceRef => x !== null));
      }),
    );
    const regOf = (id: string) => registry.find((r) => r.section === id);
    await sqlRows(
      `INSERT INTO ${FQ}.csr_runs (run_id, base_run_id, status, started_at, efficacy_version, sections_requested, model, judge_model, trace_id)
       VALUES (:run, :base, 'running', current_timestamp(), CAST(:ev AS INT), :req, :model, :judge, :trace)`,
      [
        { name: 'run', value: st.run_id },
        { name: 'base', value: base },
        { name: 'ev', value: String(EFFICACY_DRAFT_VERSION) },
        { name: 'req', value: JSON.stringify(st.requested ?? []) },
        { name: 'model', value: MODEL_LABEL },
        { name: 'judge', value: JUDGE_LABEL },
        { name: 'trace', value: st.trace_id },
      ],
    );
    agentEv('context', 'done', `${certified.length} certified tables, ${registry.length} template sections, protocol and SAP passages`);

    const draftedRegs = registry.filter((r) => r.kind === 'drafted' && (!st.requested || st.requested.includes(r.section)));
    const doNarratives = !st.requested || st.requested.includes('12.3.2');
    // Sections not redrafted in this run come from the base run as they are.
    if (baseDoc) {
      for (const s of baseDoc.sections) {
        if (s.kind === 'assembled' || s.kind === 'boilerplate') continue;
        if (draftedRegs.some((r) => r.section === s.section) || (doNarratives && s.kind === 'narrative')) continue;
        st.sections.set(s.section, s);
      }
      st.genie_checks = baseDoc.genie_checks;
    }

    // ---------------------------------------------------------------- Plan
    const defaultPlan = (r: RegistrySection): PlanEntry => ({
      section: r.section,
      passages: hints.get(r.section) ?? [],
      tlfs: r.tlf_tables.map((t) => t.tlf),
      depends_on: r.depends_on,
      wave: r.wave,
    });
    if (baseDoc) {
      st.plan = baseDoc.plan;
      agentEv('planner', 'done', `Plan reused from run ${baseDoc.run_id}`);
    } else {
      agentEv('planner', 'running', 'Planning the document from the registry');
      st.plan = await runPlanner(st, registry, certified, hints, root, toolEv('planner', undefined)).catch((e: Error) => {
        logEv('planner', `The planner failed (${e.message.slice(0, 120)}); using the registry defaults.`);
        return registry.filter((r) => r.kind === 'drafted' || r.kind === 'narrative').map(defaultPlan);
      });
      agentEv('planner', 'done', `Plan for ${st.plan.length} sections`);
    }
    for (const r of draftedRegs) if (!st.plan.some((p) => p.section === r.section)) st.plan.push(defaultPlan(r));
    for (const r of draftedRegs) sectionEv(r.section, 'planned', 'planner');
    const planOf = (id: string) => st.plan.find((p) => p.section === id) ?? defaultPlan(regOf(id)!);

    // ---------------------------------------------------------------- Draft & check
    const qcTotal = draftedRegs.length + (doNarratives ? 1 : 0);
    let authorDone = 0;
    let qcDone = 0;
    let rejected = 0;
    if (draftedRegs.length) agentEv('author', 'running', 'Drafting', { done: 0, total: draftedRegs.length });
    if (qcTotal) agentEv('qc', 'running', 'Waiting for drafts', { done: 0, total: qcTotal });

    const qcSection = async (sec: CsrSection, reg: RegistrySection, passages: SourceRef[], typed: string[], unknown: string[], extra = '') => {
      await runQc(st, sec, reg, passages, extra, tlfNumbers, typed, unknown, root, toolEv('qc', sec.section)).catch((e: Error) => {
        sec.checks = sectionChecks(sec, reg, tlfNumbers, typed, unknown);
        sec.needs_person.push({ reason: `QC could not finish: ${e.message.slice(0, 120)}`, kind: 'check_failed' });
      });
      for (const [i, s] of sec.sentences.entries()) {
        if (s.interpretation && !sec.needs_person.some((n) => n.sentence_idx === i + 1)) {
          sec.needs_person.push({ sentence_idx: i + 1, reason: 'Interprets a result; the writer owns this wording.', kind: 'interpretation' });
        }
      }
      sec.status = sec.needs_person.length || sec.checks.some((c) => !c.ok) ? 'needs_person' : 'checked';
      qcDone++;
      agentEv('qc', 'running', `Checked ${sec.section}`, { done: qcDone, total: qcTotal });
      sectionEv(sec.section, sec.status, 'qc');
      st.sections.set(sec.section, sec);
      await persistSection(st.run_id, sec).catch((e: Error) => logEv('qc', `Could not store section ${sec.section}: ${e.message.slice(0, 160)}`, sec.section));
    };

    const authorSection = async (reg: RegistrySection) => {
      sectionEv(reg.section, 'drafting', 'author');
      const plan = planOf(reg.section);
      const deps = reg.depends_on.map((d) => st.sections.get(d)).filter((d): d is CsrSection => !!d);
      const r = await runAuthor(st, reg, plan, deps, tlfByKey, meta.slots, slotIndex, root, toolEv('author', reg.section)).catch((e: Error) => ({
        error: e.message,
      }));
      authorDone++;
      if ('error' in r) {
        const sec = emptySection(reg, 'author', st.trace_id);
        sec.status = 'failed';
        sec.needs_person.push({ reason: `The CSR Author Agent did not produce a draft that passed the checks: ${r.error.slice(0, 160)}`, kind: 'check_failed' });
        sectionEv(reg.section, 'failed', 'author');
        agentEv('author', 'running', `Failed ${reg.section}`, { done: authorDone, total: draftedRegs.length });
        st.sections.set(reg.section, sec);
        qcDone++;
        await persistSection(st.run_id, sec).catch(() => undefined);
        return;
      }
      rejected += r.rejected;
      sectionEv(reg.section, 'drafted', 'author');
      agentEv('author', 'running', r.rejected ? `${rejected} save${rejected === 1 ? '' : 's'} rejected, fixed` : `Drafted ${reg.section}`, { done: authorDone, total: draftedRegs.length });
      const depText = deps.length ? `Approved sections this one summarises (templates):\n${deps.map((d) => `Section ${d.section}: ${d.sentences.map((s) => s.template).join(' ')}`).join('\n')}` : '';
      await qcSection(r.section, reg, r.passages, [], [], depText);
    };

    const narrativeJob = async () => {
      const reg = registry.find((r) => r.kind === 'narrative');
      if (!reg || !doNarratives) return;
      agentEv('narrative', 'running', 'Drafting narratives', { done: 0, total: narrativeRows.length });
      sectionEv(reg.section, 'drafting', 'narrative');
      let done = 0;
      const results = await Promise.all(
        narrativeRows.map(async (row) => {
          const r = await runNarrative(st, row, root, toolEv('narrative', reg.section)).catch((e: Error) => ({ error: e.message, usubjid: row.row_key as string }));
          done++;
          agentEv('narrative', 'running', `Narrative ${done} of ${narrativeRows.length}`, { done, total: narrativeRows.length });
          return r;
        }),
      );
      const sec = emptySection(reg, 'narrative', st.trace_id);
      for (const r of results) {
        if ('error' in r) {
          sec.needs_person.push({ reason: `No narrative for ${r.usubjid}: ${r.error.slice(0, 120)}`, kind: 'check_failed' });
          continue;
        }
        sec.sentences.push(...r.sentences);
        sec.tool_log.push(...r.log);
      }
      sec.drafted_at = now();
      agentEv('narrative', 'done', `${results.filter((r) => !('error' in r)).length} of ${narrativeRows.length} narratives`, { done, total: narrativeRows.length });
      sectionEv(reg.section, 'drafted', 'narrative');
      const facts = narrativeRows.map((r) => `${r.row_key as string}: ${r.narrative_reason as string}, ${r.aedecod as string}, outcome ${r.aeout as string}, action ${r.aeacn as string}, ${r.aerel as string}`).join('\n');
      await qcSection(sec, reg, [], [], [], `Patient records (text facts):\n${facts}`);
    };

    const tickAndTie = async () => {
      agentEv('qc', 'running', 'Tick and tie with the Genie Agent', { done: qcDone, total: qcTotal });
      st.genie_checks = await runTickAndTie(st, tlfs, root, toolEv('qc', undefined)).catch((e: Error) => {
        logEv('qc', `Tick and tie could not run: ${e.message.slice(0, 160)}`);
        return [];
      });
    };

    const wave = (n: number) => draftedRegs.filter((r) => (r.wave ?? 1) === n);
    const wave1 = Promise.all(wave(1).map(authorSection));
    await Promise.all([wave1, narrativeJob()]);
    const tie = !st.requested || st.requested.some((s) => s.startsWith('11.4') || s.startsWith('12')) ? tickAndTie() : Promise.resolve();
    await Promise.all(wave(2).map(authorSection));
    await Promise.all(wave(3).map(authorSection));
    await tie;
    if (draftedRegs.length) agentEv('author', 'done', `${authorDone} sections drafted${rejected ? `, ${rejected} save${rejected === 1 ? '' : 's'} rejected and fixed` : ''}`, { done: authorDone, total: draftedRegs.length });
    if (qcTotal) agentEv('qc', 'done', `${qcDone} sections checked`, { done: qcDone, total: qcTotal });

    // ---------------------------------------------------------------- Assemble
    agentEv('assembler', 'running', 'Assembling the CSR');
    const sortedTlfs = [...tlfs].sort((a, b) => a.ref.tlf.localeCompare(b.ref.tlf, 'en', { numeric: true }));
    await runAssembler(st, registry, meta, sortedTlfs, tlfNumbers, narrativeRows.length, root, toolEv('assembler', undefined), sectionEv).catch((e: Error) => {
      logEv('assembler', `The assembler failed (${e.message.slice(0, 120)}); assembling in code.`);
      assembleInCode(st, registry, meta, sortedTlfs, tlfNumbers, narrativeRows.length, sectionEv);
    });
    for (const s of st.sections.values()) if (s.kind === 'assembled' || s.kind === 'boilerplate') await persistSection(st.run_id, s).catch(() => undefined);
    if (baseDoc) {
      for (const s of st.sections.values()) {
        if (s.kind === 'assembled' || s.kind === 'boilerplate') continue;
        if (baseDoc.sections.some((b) => b.section === s.section && b === s)) await persistSection(st.run_id, s).catch(() => undefined);
      }
    }
    const passed = st.document_checks.filter((c) => c.ok).length;
    agentEv('assembler', 'done', `${passed} of ${st.document_checks.length} document checks passed`);
    agentEv('signoff', 'idle', 'Waiting for 4 departments');

    st.status = 'done';
    st.finished_at = now();
    st.wall_ms = Date.now() - t0;
    await sqlRows(
      `UPDATE ${FQ}.csr_runs SET status = 'done', finished_at = current_timestamp(), plan_json = :plan, document_checks_json = :dc,
         genie_checks_json = :gc, wall_ms = CAST(:ms AS BIGINT) WHERE run_id = :run`,
      [
        { name: 'plan', value: JSON.stringify(st.plan) },
        { name: 'dc', value: JSON.stringify(st.document_checks) },
        { name: 'gc', value: JSON.stringify(st.genie_checks) },
        { name: 'ms', value: String(st.wall_ms) },
        { name: 'run', value: st.run_id },
      ],
    );
    root.end({ outputs: { sections: st.sections.size, document_checks: `${passed}/${st.document_checks.length}`, rejected_saves: rejected, wall_ms: st.wall_ms } });
    emit(st, { type: 'run', status: 'done', run_id: st.run_id, at: now(), wall_ms: st.wall_ms });
  } catch (e) {
    st.status = 'error';
    st.finished_at = now();
    root.end({ status: mlflow.SpanStatusCode.ERROR, outputs: { error: (e as Error).message } });
    await sqlRows(`UPDATE ${FQ}.csr_runs SET status = 'error', finished_at = current_timestamp() WHERE run_id = :run`, [{ name: 'run', value: st.run_id }]).catch(() => undefined);
    emit(st, { type: 'run', status: 'error', run_id: st.run_id, at: now(), error: (e as Error).message });
  } finally {
    void mlflow.flushTraces().catch(() => undefined);
  }
}

function emptySection(reg: RegistrySection, agent: AgentId, traceId: string | null): CsrSection {
  return {
    section: reg.section,
    title: reg.title,
    ord: reg.ord,
    kind: reg.kind,
    agent,
    department: reg.department,
    status: 'drafted',
    sentences: [],
    checks: [],
    needs_person: [],
    tool_log: [],
    trace_id: traceId,
    drafted_at: null,
  };
}

// ------------------------------------------------------------------------------------------------
// Document Planner
// ------------------------------------------------------------------------------------------------

async function runPlanner(
  st: RunState,
  registry: RegistrySection[],
  certified: { table: string; tlf: string }[],
  hints: Map<string, SourceRef[]>,
  root: LiveSpan,
  onTool: (c: ToolCallRecord) => void,
): Promise<PlanEntry[]> {
  const candidates = new Map<string, Map<string, SourceRef>>();
  let plan: PlanEntry[] | null = null;
  const drafted = registry.filter((r) => r.kind === 'drafted');
  const tools: ToolDef[] = [
    {
      name: 'read_registry',
      description: 'Read the section registry: the company ICH E3 template as data (sections, kinds, waves, dependencies, expected tables).',
      parameters: { type: 'object', properties: {} },
      run: () => ({
        ok: true,
        summary: `${registry.length} sections, ${drafted.length} to draft`,
        content: registry.map((r) => ({ section: r.section, title: r.title, kind: r.kind, wave: r.wave, depends_on: r.depends_on, expected_tables: r.tlf_tables.map((t) => `${t.tlf} (${t.table})`) })),
      }),
    },
    {
      name: 'list_certified_tables',
      description: 'List the tables in Unity Catalog that Biostatistics has certified (governed tag system.certification_status = certified).',
      parameters: { type: 'object', properties: {} },
      run: () => ({ ok: true, summary: `${certified.length} certified tables`, content: certified }),
    },
    {
      name: 'find_passages',
      description: 'Candidate source passages for one section: the registry suggestions, located in the parsed protocol and SAP, plus AI Search hits.',
      parameters: { type: 'object', properties: { section: { type: 'string' } }, required: ['section'] },
      run: async (a) => {
        const reg = registry.find((r) => r.section === a.section);
        if (!reg) return { ok: false, summary: `no section ${String(a.section)}`, content: { error: 'unknown section' } };
        const m = new Map<string, SourceRef>();
        (hints.get(reg.section) ?? []).forEach((h, i) => m.set(`R${i + 1}`, h));
        const query = `${reg.title}. ${reg.instructions[0] ?? ''}`;
        const hits = await searchDocs(query).catch(() => []);
        let n = 0;
        for (const h of hits.filter((x) => /Protocol|SAP/i.test(x.doc_title)).slice(0, 3)) {
          const el = await bestElement(h.file_path, h.page, query, h.doc_title).catch(() => null);
          if (el && el.kind === 'passage' && ![...m.values()].some((x) => x.kind === 'passage' && x.element_id === el.element_id && x.file_path === el.file_path)) m.set(`A${++n}`, el);
        }
        candidates.set(reg.section, m);
        return {
          ok: true,
          summary: `${reg.section}: ${m.size} candidate passages`,
          content: [...m.entries()].map(([id, p]) => (p.kind === 'passage' ? { id, doc: p.doc_title, page: p.page, text: p.quote.slice(0, 400), suggested_by_registry: id.startsWith('R') } : { id })),
        };
      },
    },
    {
      name: 'save_plan',
      description: 'Save the document plan: for each drafted section, the passage ids to cite and the certified tables to use.',
      parameters: {
        type: 'object',
        properties: {
          sections: {
            type: 'array',
            items: {
              type: 'object',
              properties: { section: { type: 'string' }, passage_ids: { type: 'array', items: { type: 'string' } }, tables: { type: 'array', items: { type: 'string' } } },
              required: ['section', 'passage_ids', 'tables'],
            },
          },
        },
        required: ['sections'],
      },
      run: (a) => {
        const items = Array.isArray(a.sections) ? (a.sections as { section?: unknown; passage_ids?: unknown; tables?: unknown }[]) : [];
        const problems: string[] = [];
        const certifiedNames = new Set(certified.map((c) => c.table));
        const entries: PlanEntry[] = [];
        for (const reg of drafted) {
          const it = items.find((x) => x.section === reg.section);
          if (!it) {
            problems.push(`section ${reg.section} is missing from the plan`);
            continue;
          }
          const cands = candidates.get(reg.section) ?? new Map<string, SourceRef>();
          if (!candidates.has(reg.section)) (hints.get(reg.section) ?? []).forEach((h, i) => cands.set(`R${i + 1}`, h));
          const ids = strArray(it.passage_ids);
          const bad = ids.filter((id) => !cands.has(id));
          if (bad.length) problems.push(`section ${reg.section}: unknown passage ids ${bad.join(', ')} (call find_passages first)`);
          const tables = strArray(it.tables).map((t) => t.replace(/^.*\./, ''));
          const notCert = tables.filter((t) => !certifiedNames.has(t));
          if (notCert.length) problems.push(`section ${reg.section}: not certified: ${notCert.join(', ')}`);
          entries.push({
            section: reg.section,
            passages: ids.filter((id) => cands.has(id)).map((id) => cands.get(id)!),
            tlfs: reg.tlf_tables.filter((t) => tables.length === 0 || tables.includes(t.table)).map((t) => t.tlf),
            depends_on: reg.depends_on,
            wave: reg.wave,
          });
        }
        if (problems.length) return { ok: false, summary: `plan rejected: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1})` : ''}`, content: { accepted: false, problems } };
        const narr = registry.find((r) => r.kind === 'narrative');
        if (narr) entries.push({ section: narr.section, passages: [], tlfs: [], depends_on: [], wave: 1 });
        plan = entries;
        return { ok: true, summary: `plan saved for ${entries.length} sections`, content: { accepted: true }, stop: true };
      },
    },
  ];
  await agentLoop({
    name: 'planner',
    system: SKILLS['csr-planning'],
    user: `Plan the LMN-301 clinical study report. There are ${drafted.length} sections to draft: ${drafted.map((r) => r.section).join(', ')}.`,
    tools,
    parent: root,
    maxTurns: 6,
    maxTokens: 6000,
    onTool,
  });
  if (!plan) throw new Error('the planner did not save a plan');
  void st;
  return plan;
}

// ------------------------------------------------------------------------------------------------
// CSR Author Agent
// ------------------------------------------------------------------------------------------------

async function runAuthor(
  st: RunState,
  reg: RegistrySection,
  plan: PlanEntry,
  deps: CsrSection[],
  tlfByKey: Map<string, TlfData>,
  metaSlots: Slot[],
  slotIndex: Map<string, Slot>,
  root: LiveSpan,
  onTool: (c: ToolCallRecord) => void,
): Promise<{ section: CsrSection; rejected: number; passages: SourceRef[] }> {
  const slots = new Map<string, Slot>();
  const tables = reg.tlf_tables.map((t) => tlfByKey.get(`${t.table}@${t.version ?? 'current'}`)).filter((t): t is TlfData => !!t);
  // Sections that summarise others (synopsis, discussion) get only the figures those sections use.
  if (deps.length === 0) for (const t of tables) for (const s of t.slots) slots.set(s.name, s);
  for (const s of metaSlots) slots.set(s.name, s);
  // Synopsis and discussion: only the figures the approved sections already use, so they cannot disagree.
  for (const d of deps) for (const x of d.sentences) for (const p of x.parts) if ('slot' in p && slotIndex.has(p.slot)) slots.set(p.slot, slotIndex.get(p.slot)!);

  const refs = new Map<string, SourceRef>();
  plan.passages.forEach((p, i) => refs.set(`P${i + 1}`, p));
  tables.forEach((t, i) => refs.set(`T${i + 1}`, { kind: 'tlf', tlf: t.ref.tlf, table: t.ref.table }));
  let searches = 0;
  const allowedTexts = () => [
    ...reg.instructions,
    ...reg.required_content,
    ...[...refs.values()].map((r) => (r.kind === 'passage' ? r.quote : '')),
    // Row labels are definitions, not results: "Age 65 years or over", "Treated for 48 weeks or more".
    ...tables.flatMap((t) => t.rows.map((row) => ((row.row_label as string) ?? '').replace(/kg\/m2/g, ''))),
    reg.section,
  ];
  let rejected = 0;
  let saved: CsrSection | null = null;
  const passageList = () =>
    [...refs.entries()].flatMap(([id, r]) => (r.kind === 'passage' ? [{ id, doc: r.doc_title, page: r.page, text: r.quote }] : []));

  const tools: ToolDef[] = [
    {
      name: 'get_section_brief',
      description: 'The brief for the section: instructions, required content, cited passages (P ids), certified tables (T ids), and the placeholders you may use. You never see figure values.',
      parameters: { type: 'object', properties: {} },
      run: () => ({
        ok: true,
        summary: `${reg.section}: ${plan.passages.length} passages, ${tables.length} tables, ${slots.size} placeholders`,
        content: {
          section: reg.section,
          title: reg.title,
          instructions: reg.instructions,
          required_content: reg.required_content,
          passages: passageList(),
          tables: tables.map((t, i) => ({ id: `T${i + 1}`, tlf: t.ref.tlf, table: t.ref.table, version: t.version })),
          placeholders: [...slots.values()].map((s) => ({ name: s.name, description: s.description })),
          approved_sections_to_summarise: deps.map((d) => ({ section: d.section, title: d.title, templates: d.sentences.map((s) => s.template) })),
        },
      }),
    },
    {
      name: 'search_documents',
      description: 'AI Search over the parsed protocol, SAP and other study documents. Hits get ids S1, S2, ... that you may cite.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      run: async (a) => {
        if (++searches > 3) return { ok: false, summary: 'search limit reached', content: { error: 'at most 3 searches per section' } };
        const q = str(a.query);
        const hits = (await searchDocs(q)).filter((h) => /Protocol|SAP/i.test(h.doc_title)).slice(0, 3);
        const out: { id: string; doc: string; page: number; text: string }[] = [];
        for (const h of hits) {
          const el = await bestElement(h.file_path, h.page, q, h.doc_title).catch(() => null);
          if (!el || el.kind !== 'passage') continue;
          const id = `S${[...refs.keys()].filter((k) => k.startsWith('S')).length + 1}`;
          refs.set(id, el);
          out.push({ id, doc: el.doc_title, page: el.page, text: el.quote });
        }
        return { ok: true, summary: `"${q.slice(0, 60)}": ${out.length} passages`, content: out };
      },
    },
    {
      name: 'save_csr_draft',
      description: 'Save the drafted section. A code check rejects the save if a figure is typed instead of a placeholder, a placeholder is unknown, or a source id is unknown.',
      parameters: {
        type: 'object',
        properties: {
          sentences: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                sources: { type: 'array', items: { type: 'string' }, description: 'P, S or T ids, or "writer"' },
                interpretation: { type: 'boolean' },
              },
              required: ['text', 'sources'],
            },
          },
        },
        required: ['sentences'],
      },
      run: (a): ToolResult => {
        const items = Array.isArray(a.sentences) ? (a.sentences as { text?: unknown; sources?: unknown; interpretation?: unknown }[]) : [];
        const texts = items.map((x) => (typeof x.text === 'string' ? x.text.trim() : '')).filter(Boolean);
        if (texts.length === 0 || texts.length > 14) return { ok: false, summary: '1 to 14 sentences expected', content: { accepted: false, problems: ['give 1 to 14 sentences'] } };
        const allowed = allowedNumbers(allowedTexts());
        const problems: string[] = [];
        const typedAll: string[] = [];
        texts.forEach((t, i) => {
          const b = bind([t], slots, allowed);
          if (b.typed.length) {
            problems.push(`sentence ${i + 1}: typed figure ${b.typed.join(', ')}; use a placeholder from the list, or leave the figure out`);
            typedAll.push(...b.typed);
          }
          if (b.unknown.length) problems.push(`sentence ${i + 1}: unknown placeholder ${b.unknown.map((u) => `{${u}}`).join(', ')}`);
          if (/—/.test(t)) problems.push(`sentence ${i + 1}: contains an em dash`);
        });
        items.forEach((x, i) => {
          const bad = strArray(x.sources).filter((s) => s !== 'writer' && !refs.has(s));
          if (bad.length) problems.push(`sentence ${i + 1}: unknown source id ${bad.join(', ')}`);
        });
        if (problems.length) {
          rejected++;
          const head = typedAll.length ? `typed figure ${[...new Set(typedAll)].slice(0, 3).join(', ')}` : `${problems[0].slice(0, 80)}`;
          return { ok: false, summary: head, content: { accepted: false, problems, instruction: 'Fix exactly these problems and call save_csr_draft again.' } };
        }
        const b = bind(texts, slots, allowed);
        const sec = emptySection(reg, 'author', st.trace_id);
        sec.sentences = b.bound.map((s, i): Sentence => {
          const ids = strArray(items[i]?.sources);
          const sources: SourceRef[] = ids.map((id) => (id === 'writer' ? { kind: 'writer' as const } : refs.get(id)!)).filter(Boolean);
          for (const p of s.parts) {
            if ('slot' in p && !sources.some((r) => r.kind === 'tlf' && r.table === p.source_table)) sources.push({ kind: 'tlf', tlf: p.tlf, table: p.source_table });
          }
          if (sources.length === 0) sources.push({ kind: 'writer' });
          return { ...s, sources, interpretation: items[i]?.interpretation === true || undefined };
        });
        sec.drafted_at = now();
        saved = sec;
        return { ok: true, summary: `saved: ${texts.length} sentences, ${b.figures} figures bound`, content: { accepted: true, figures_bound: b.figures }, stop: true };
      },
    },
  ];
  const r = await agentLoop({
    name: `author:${reg.section}`,
    system: SKILLS['csr-authoring'],
    user: `Draft section ${reg.section} ${reg.title} of the LMN-301 clinical study report.`,
    tools,
    parent: root,
    maxTurns: 7,
    maxTokens: 4000,
    onTool,
  });
  const sec = saved as CsrSection | null;
  if (!sec) throw new Error(rejected ? `${rejected} saves rejected and no accepted draft` : 'no draft saved');
  sec.tool_log = r.log;
  return { section: sec, rejected, passages: [...refs.values()].filter((x) => x.kind === 'passage') };
}

// ------------------------------------------------------------------------------------------------
// Safety Narrative Agent
// ------------------------------------------------------------------------------------------------

const NARRATIVE_TEXT_FIELDS = ['arm', 'sex', 'aedecod', 'aesoc', 'aeout', 'aeacn', 'aerel', 'narrative_reason'];

async function runNarrative(
  st: RunState,
  row: Record<string, string | null>,
  root: LiveSpan,
  onTool: (c: ToolCallRecord) => void,
): Promise<{ sentences: Sentence[]; log: ToolCallRecord[] }> {
  const usubjid = row.row_key as string;
  const slots = new Map<string, Slot>();
  const facts: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'row_key' || v === null) continue;
    if (!NARRATIVE_TEXT_FIELDS.includes(k) && /^-?\d+(\.\d+)?$/.test(v)) {
      slots.set(`pt_${k}`, {
        name: `pt_${k}`,
        description: { age: 'age in years at screening', aestdy: 'study day of event onset', aeendy: 'study day the event ended', trtdurd: 'days on study treatment' }[k] ?? k,
        value: v,
        source_table: 'narrative_patients',
        tlf: 'Patient data',
        row_key: usubjid,
        column_name: k,
        table_version: 0,
      });
    } else facts[k] = v;
  }
  let saved: Sentence[] | null = null;
  const heading = `Patient ${usubjid}: ${(facts.narrative_reason ?? 'event').toLowerCase()} (${(facts.aedecod ?? '').toLowerCase()})`;
  const tools: ToolDef[] = [
    {
      name: 'get_patient_record',
      description: "The patient's record from the analysis data: text facts, and placeholders for every number.",
      parameters: { type: 'object', properties: {} },
      run: () => ({
        ok: true,
        summary: `${usubjid}: ${facts.aedecod ?? ''}, ${slots.size} placeholders`,
        content: { usubjid, facts, placeholders: [...slots.values()].map((s) => ({ name: s.name, description: s.description })) },
      }),
    },
    {
      name: 'save_narrative',
      description: 'Save the narrative. A code check rejects typed figures and unknown placeholders.',
      parameters: { type: 'object', properties: { sentences: { type: 'array', items: { type: 'string' } } }, required: ['sentences'] },
      run: (a): ToolResult => {
        const texts = strArray(a.sentences).map((t) => t.trim()).filter(Boolean);
        if (texts.length === 0 || texts.length > 8) return { ok: false, summary: '1 to 8 sentences expected', content: { accepted: false, problems: ['give 1 to 8 sentences'] } };
        const allowed = allowedNumbers([]);
        const problems: string[] = [];
        const typedAll: string[] = [];
        texts.forEach((t, i) => {
          const b = bind([t], slots, allowed);
          if (b.typed.length) {
            problems.push(`sentence ${i + 1}: typed figure ${b.typed.join(', ')}; use a placeholder`);
            typedAll.push(...b.typed);
          }
          if (b.unknown.length) problems.push(`sentence ${i + 1}: unknown placeholder ${b.unknown.map((u) => `{${u}}`).join(', ')}`);
        });
        if (problems.length) {
          return {
            ok: false,
            summary: typedAll.length ? `typed figure ${[...new Set(typedAll)].slice(0, 3).join(', ')}` : `${problems[0].slice(0, 80)}`,
            content: { accepted: false, problems, instruction: 'Fix exactly these problems and call save_narrative again.' },
          };
        }
        const b = bind(texts, slots, allowed);
        saved = b.bound.map((s, i) => ({ ...s, sources: [{ kind: 'tlf', tlf: 'Patient data', table: 'narrative_patients' }], heading: i === 0 ? heading : undefined }));
        return { ok: true, summary: `saved ${usubjid}: ${texts.length} sentences, ${b.figures} figures bound`, content: { accepted: true }, stop: true };
      },
    },
  ];
  const r = await agentLoop({
    name: `narrative:${usubjid}`,
    system: SKILLS['safety-narratives'],
    user: `Draft the narrative for patient ${usubjid}.`,
    tools,
    parent: root,
    maxTurns: 5,
    maxTokens: 2500,
    onTool,
  });
  const out = saved as Sentence[] | null;
  if (!out) throw new Error('no narrative saved');
  void st;
  return { sentences: out, log: r.log };
}

// ------------------------------------------------------------------------------------------------
// QC & Consistency Agent
// ------------------------------------------------------------------------------------------------

async function runQc(
  st: RunState,
  sec: CsrSection,
  reg: RegistrySection,
  passages: SourceRef[],
  extra: string,
  tlfNumbers: Set<string>,
  typed: string[],
  unknown: string[],
  root: LiveSpan,
  onTool: (c: ToolCallRecord) => void,
) {
  let finished = false;
  let judgedMissing: string[] | null = null;
  const applyJudgedCoverage = () => {
    if (!judgedMissing) return;
    const c = sec.checks.find((x) => x.id === 'required_content');
    if (c) {
      c.ok = judgedMissing.length === 0;
      c.detail = judgedMissing.length ? `missing (judge): ${judgedMissing.join('; ')}` : `${reg.required_content.length} items (judge)`;
    }
  };
  const tools: ToolDef[] = [
    {
      name: 'run_section_checks',
      description: 'Code checks on the section: typed figures, unbound placeholders, table references, required content, a source for every sentence.',
      parameters: { type: 'object', properties: {} },
      run: () => {
        sec.checks = sectionChecks(sec, reg, tlfNumbers, typed, unknown);
        applyJudgedCoverage();
        const failed = sec.checks.filter((c) => !c.ok);
        return { ok: true, summary: `${sec.checks.length - failed.length} of ${sec.checks.length} checks passed`, content: sec.checks };
      },
    },
    {
      name: 'judge_section',
      description: 'Ask a judge from a second model family (GPT 5.5) whether the section is supported by its sources and contradicts nothing.',
      parameters: { type: 'object', properties: {} },
      run: async () => {
        const j = await judge(sec, reg, passages, extra, root);
        sec.judge = { verdict: j.verdict, reason: j.reason, model: j.model };
        // Coverage of the required content is a question of meaning, so the judge answers it when it can.
        if (j.missing) {
          if (sec.checks.length === 0) sec.checks = sectionChecks(sec, reg, tlfNumbers, typed, unknown);
          judgedMissing = j.missing;
          applyJudgedCoverage();
        }
        return { ok: sec.judge.verdict !== 'unavailable', summary: `judge: ${sec.judge.verdict}, ${sec.judge.reason.slice(0, 90)}`, content: sec.judge };
      },
    },
    {
      name: 'flag_for_person',
      description: 'Put a sentence (1-based index) or the whole section on the "needs a person" list, with a one-sentence reason.',
      parameters: {
        type: 'object',
        properties: { sentence_idx: { type: 'integer' }, reason: { type: 'string' }, kind: { type: 'string', enum: ['interpretation', 'check_failed', 'judge', 'qc_flag'] } },
        required: ['reason'],
      },
      run: (a) => {
        const idx = typeof a.sentence_idx === 'number' && a.sentence_idx >= 1 && a.sentence_idx <= sec.sentences.length ? a.sentence_idx : undefined;
        const kind = (['interpretation', 'check_failed', 'judge', 'qc_flag'] as const).find((k) => k === a.kind) ?? 'qc_flag';
        const np: NeedsPerson = { sentence_idx: idx, reason: str(a.reason).slice(0, 300), kind };
        sec.needs_person.push(np);
        return { ok: true, summary: `flagged${idx ? ` sentence ${idx}` : ''}: ${np.reason.slice(0, 80)}`, content: { flagged: true } };
      },
    },
    {
      name: 'finish_review',
      description: 'Finish the review of the section.',
      parameters: { type: 'object', properties: { status: { type: 'string', enum: ['checked', 'needs_person'] } }, required: ['status'] },
      run: (a) => {
        finished = true;
        return { ok: true, summary: `review finished: ${String(a.status)}`, content: { done: true }, stop: true };
      },
    },
  ];
  const r = await agentLoop({
    name: `qc:${sec.section}`,
    system: SKILLS['csr-qc'],
    user:
      `Review section ${sec.section} ${sec.title}. Figures in square brackets were filled by SQL from certified table cells.\n` +
      sec.sentences.map((s, i) => `${i + 1}. ${s.heading ? `[${s.heading}] ` : ''}${bracketed(s)}${s.interpretation ? '  (marked by the author as interpretation)' : ''}`).join('\n'),
    tools,
    parent: root,
    maxTurns: 6,
    maxTokens: 2500,
    onTool,
  });
  if (sec.checks.length === 0) sec.checks = sectionChecks(sec, reg, tlfNumbers, typed, unknown);
  applyJudgedCoverage();
  sec.tool_log = [...sec.tool_log, ...r.log];
  if (!finished) sec.needs_person.push({ reason: 'The QC agent did not finish its review.', kind: 'check_failed' });
  void st;
}

async function runTickAndTie(st: RunState, tlfs: TlfData[], root: LiveSpan, onTool: (c: ToolCallRecord) => void): Promise<GenieCheck[]> {
  const bound = new Map<string, { p: Extract<Sentence['parts'][number], { slot: string }> }>();
  for (const s of st.sections.values()) for (const x of s.sentences) for (const p of x.parts) if ('slot' in p && /^(eff|saf)_/.test(p.slot)) bound.set(p.slot, { p });
  const headline = ['eff_trt_responders', 'saf_trt_serious_ae'].filter((k) => bound.has(k));
  for (const k of bound.keys()) if (headline.length < 2 && !headline.includes(k) && !headline.some((h) => h.slice(0, 3) === k.slice(0, 3))) headline.push(k);
  if (headline.length === 0) return [];
  const checks: GenieCheck[] = [];
  const current = await Promise.all(
    [...new Set(headline.map((h) => bound.get(h)!.p.source_table))].map((table) => {
      const t = tlfs.find((x) => x.ref.table === table)!;
      return loadTlf({ ...t.ref, version: null });
    }),
  );
  const tools: ToolDef[] = [
    {
      name: 'tick_and_tie',
      description: 'Ask the LMN-301 Genie Agent for one figure independently, and compare it with the cell bound in the draft and with the current table version.',
      parameters: { type: 'object', properties: { slot: { type: 'string', enum: headline } }, required: ['slot'] },
      run: async (a) => {
        const b = bound.get(String(a.slot));
        if (!b) return { ok: false, summary: `slot ${String(a.slot)} is not bound in the draft`, content: { error: 'unknown slot' } };
        const p = b.p;
        if (checks.some((c) => c.slot === p.slot)) return { ok: true, summary: `${p.slot} already tied out`, content: checks.find((c) => c.slot === p.slot) };
        const question = `In the table ${p.source_table}, what is the value of the column ${p.column_name} for row_key ${p.row_key}? Return only that value.`;
        const ans = await askGenie(question);
        const first = ans.rows[0] ?? {};
        const genieValue = Object.values(first).find((v) => v !== null && /^-?\d+(\.\d+)?$/.test(v)) ?? ans.answer_text.match(/-?\d+(\.\d+)?/)?.[0] ?? '';
        const cur = current.find((c) => c.ref.table === p.source_table);
        const curSlot = cur?.slots.find((s) => s.row_key === p.row_key && s.column_name === p.column_name && !s.name.endsWith('_pct'));
        const curValue = curSlot?.value ?? '';
        const same = (x: string, y: string) => x !== '' && y !== '' && Number(x) === Number(y);
        const note =
          cur && cur.version !== p.table_version
            ? same(genieValue, p.value)
              ? `Genie Agent and the draft agree; the table is now at version ${cur.version}.`
              : `The Genie Agent reads version ${cur.version} (${curValue}); the draft is bound to version ${p.table_version} (${p.value}). This is the re-delivery, not a drafting error.`
            : `The Genie Agent and the draft agree at version ${p.table_version}.`;
        const c: GenieCheck = { question, genie_value: String(genieValue), bound_value: p.value, slot: p.slot, table_version_note: note, ok: same(genieValue, curValue) || same(genieValue, p.value) };
        checks.push(c);
        return { ok: c.ok, summary: `${p.slot}: Genie ${c.genie_value}, draft ${p.value}${cur && cur.version !== p.table_version ? ` (v${p.table_version}, table now v${cur.version})` : ''}`, content: c };
      },
    },
    {
      name: 'finish_tick_and_tie',
      description: 'Finish the tick and tie with a one-sentence summary.',
      parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      run: (a) => ({ ok: true, summary: str(a.summary).slice(0, 200), content: { done: true }, stop: true }),
    },
  ];
  await agentLoop({
    name: 'qc:tick_and_tie',
    system: SKILLS['csr-qc-document'],
    user: `Tie out these headline figures of the LMN-301 CSR draft: ${headline.join(', ')}.`,
    tools,
    parent: root,
    maxTurns: 5,
    maxTokens: 1500,
    onTool,
  });
  return checks;
}

// ------------------------------------------------------------------------------------------------
// CSR Assembler
// ------------------------------------------------------------------------------------------------

function assembleInCode(
  st: RunState,
  registry: RegistrySection[],
  meta: { text: Record<string, string>; slots: Slot[] },
  tlfs: TlfData[],
  tlfNumbers: Set<string>,
  narrativeTotal: number,
  sectionEv: (s: string, status: 'assembled', agent: AgentId) => void,
) {
  const drafted = [...st.sections.values()].filter((s) => s.kind === 'drafted' || s.kind === 'narrative');
  const parts = assembleFixedParts({
    registry,
    meta,
    tlfs,
    drafted,
    base: { checks: [], needs_person: [], tool_log: [], trace_id: st.trace_id, drafted_at: now() },
  });
  for (const p of parts) {
    st.sections.set(p.section, p);
    sectionEv(p.section, 'assembled', 'assembler');
  }
  st.document_checks = documentChecks(sortedSections(st, registry), registry, tlfNumbers, narrativeTotal);
  return parts;
}

function sortedSections(st: RunState, registry: RegistrySection[]): CsrSection[] {
  const ord = new Map(registry.map((r) => [r.section, r.ord]));
  return [...st.sections.values()].sort((a, b) => (ord.get(a.section) ?? a.ord) - (ord.get(b.section) ?? b.ord));
}

async function runAssembler(
  st: RunState,
  registry: RegistrySection[],
  meta: { text: Record<string, string>; slots: Slot[] },
  tlfs: TlfData[],
  tlfNumbers: Set<string>,
  narrativeTotal: number,
  root: LiveSpan,
  onTool: (c: ToolCallRecord) => void,
  sectionEv: (s: string, status: 'assembled', agent: AgentId) => void,
) {
  let assembled = false;
  let finalised = false;
  const tools: ToolDef[] = [
    {
      name: 'assemble_fixed_parts',
      description: 'Assemble the parts that are never written: title page, contents, abbreviations, ethics and investigator boilerplate, section 14 tables, references and appendices.',
      parameters: { type: 'object', properties: {} },
      run: () => {
        const parts = assembleInCode(st, registry, meta, tlfs, tlfNumbers, narrativeTotal, sectionEv);
        assembled = true;
        return { ok: true, summary: `${parts.length} parts assembled: ${parts.map((p) => p.section).join(', ')}`, content: parts.map((p) => ({ section: p.section, title: p.title })) };
      },
    },
    {
      name: 'run_document_checks',
      description: 'Run the document-level checks across all sections.',
      parameters: { type: 'object', properties: {} },
      run: () => {
        if (!assembled) return { ok: false, summary: 'assemble the fixed parts first', content: { error: 'call assemble_fixed_parts first' } };
        st.document_checks = documentChecks(sortedSections(st, registry), registry, tlfNumbers, narrativeTotal);
        const passed = st.document_checks.filter((c) => c.ok).length;
        return { ok: true, summary: `${passed} of ${st.document_checks.length} document checks passed`, content: st.document_checks };
      },
    },
    {
      name: 'finalise_document',
      description: 'Finalise the draft for departmental sign-off, with a one-sentence summary for the reviewers.',
      parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      run: (a) => {
        if (!assembled || st.document_checks.length === 0) return { ok: false, summary: 'run the document checks first', content: { error: 'call run_document_checks first' } };
        finalised = true;
        return { ok: true, summary: str(a.summary).slice(0, 200), content: { done: true }, stop: true };
      },
    },
  ];
  await agentLoop({
    name: 'assembler',
    system: SKILLS['ich-e3-assembly'],
    user: `Assemble the LMN-301 clinical study report. ${[...st.sections.values()].length} drafted sections are ready.`,
    tools,
    parent: root,
    maxTurns: 5,
    maxTokens: 1500,
    onTool,
  });
  if (!assembled) assembleInCode(st, registry, meta, tlfs, tlfNumbers, narrativeTotal, sectionEv);
  else st.document_checks = documentChecks(sortedSections(st, registry), registry, tlfNumbers, narrativeTotal);
  void finalised;
}

// ------------------------------------------------------------------------------------------------
// Reading runs back
// ------------------------------------------------------------------------------------------------

export interface CsrDocument {
  run_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  wall_ms: number | null;
  efficacy_version: number;
  trace_id: string | null;
  model: string;
  judge_model: string;
  plan: PlanEntry[];
  sections: CsrSection[];
  document_checks: Check[];
  genie_checks: GenieCheck[];
  redelivery: { section: string; sentence_idx: number; slot: string; v3: string; v4: string }[];
}

export async function latestDoneRunId(): Promise<string | null> {
  const r = await sqlRows(`SELECT run_id FROM ${FQ}.csr_runs WHERE status = 'done' ORDER BY finished_at DESC LIMIT 1`);
  return (r[0]?.run_id as string) ?? null;
}

async function redelivery(sections: CsrSection[]) {
  const cur = await loadTlf({ table: 'efficacy_primary', tlf: 'Table 14.2.1', alias: 'eff', version: null });
  const out: CsrDocument['redelivery'] = [];
  for (const s of sections)
    s.sentences.forEach((x, i) => {
      for (const p of x.parts) {
        if (!('slot' in p) || p.source_table !== 'efficacy_primary' || p.table_version === cur.version) continue;
        const c = cur.slots.find((v) => v.row_key === p.row_key && v.column_name === p.column_name && !v.name.endsWith('_pct'));
        if (c && c.value !== p.value) out.push({ section: s.section, sentence_idx: i + 1, slot: p.slot, v3: p.value, v4: c.value });
      }
    });
  return out;
}

const pj = <T>(s: string | null | undefined, f: T): T => {
  if (!s) return f;
  try {
    return JSON.parse(s) as T;
  } catch {
    return f;
  }
};

export async function loadDocument(runId: string): Promise<CsrDocument | null> {
  const st = runs.get(runId);
  if (st && st.status === 'running') {
    const sections = [...st.sections.values()].sort((a, b) => a.ord - b.ord);
    return {
      run_id: st.run_id,
      status: st.status,
      started_at: st.started_at,
      finished_at: null,
      wall_ms: null,
      efficacy_version: EFFICACY_DRAFT_VERSION,
      trace_id: st.trace_id,
      model: AUTHOR_LABEL,
      judge_model: JUDGE_LABEL,
      plan: st.plan,
      sections,
      document_checks: st.document_checks,
      genie_checks: st.genie_checks,
      redelivery: [],
    };
  }
  const [run] = await sqlRows(`SELECT * FROM ${FQ}.csr_runs WHERE run_id = :r`, [{ name: 'r', value: runId }]);
  if (!run) return null;
  const rows = await sqlRows(`SELECT * FROM ${FQ}.csr_sections WHERE run_id = :r ORDER BY ord, section`, [{ name: 'r', value: runId }]);
  const sections: CsrSection[] = rows.map((r) => {
    const body = pj<{ sentences: Sentence[]; html: string | null }>(r.sentences_json, { sentences: [], html: null });
    return {
      section: r.section as string,
      title: r.title as string,
      ord: Number(r.ord),
      kind: r.kind as CsrSection['kind'],
      agent: r.agent as string,
      department: r.department as string,
      status: r.status as CsrSection['status'],
      sentences: body.sentences ?? [],
      html: body.html ?? undefined,
      checks: pj<Check[]>(r.checks_json, []),
      judge: pj<CsrSection['judge']>(r.judge_json, undefined),
      needs_person: pj<NeedsPerson[]>(r.needs_person_json, []),
      tool_log: pj<CsrSection['tool_log']>(r.tool_log_json, []),
      trace_id: (r.trace_id as string) ?? null,
      drafted_at: (r.drafted_at as string) ?? null,
    };
  });
  return {
    run_id: runId,
    status: run.status as string,
    started_at: run.started_at as string,
    finished_at: (run.finished_at as string) ?? null,
    wall_ms: run.wall_ms === null ? null : Number(run.wall_ms),
    efficacy_version: Number(run.efficacy_version ?? EFFICACY_DRAFT_VERSION),
    trace_id: (run.trace_id as string) ?? null,
    model: AUTHOR_LABEL,
    judge_model: (run.judge_model as string) ?? JUDGE_LABEL,
    plan: pj<PlanEntry[]>(run.plan_json, []),
    sections,
    document_checks: pj<Check[]>(run.document_checks_json, []),
    genie_checks: pj<GenieCheck[]>(run.genie_checks_json, []),
    redelivery: await redelivery(sections).catch(() => []),
  };
}

/** The table versions a run's figures were bound to, for the sign-off record. */
export async function runTableVersions(runId: string): Promise<Record<string, number>> {
  const rows = await sqlRows(
    `SELECT source_table, CAST(MAX(table_version) AS BIGINT) AS v FROM ${FQ}.csr_figure_citations WHERE run_id = :r AND source_table NOT IN ('study_metadata', 'narrative_patients') GROUP BY source_table ORDER BY source_table`,
    [{ name: 'r', value: runId }],
  );
  return Object.fromEntries(rows.map((r) => [r.source_table as string, Number(r.v)]));
}
