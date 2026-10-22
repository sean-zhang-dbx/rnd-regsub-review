import { randomUUID } from 'node:crypto';
import { ROOT_CONTEXT, context } from '@opentelemetry/api';
import type { LiveSpan } from 'mlflow-tracing';
import { FQ, MODEL_LABEL, dbxFetch, sqlRows } from '../dbx';
import { initTracing, mlflow } from '../tracing';
import { SKILLS } from './skills';
import { agentLoop } from './llm';
import type { ToolCallRecord, ToolDef, ToolResult } from './llm';
import {
  allowedNumbers,
  asSourceRef,
  formatCell,
  bind,
  certifiedTables,
  clearTlfCache,
  loadFormats,
  loadRegistry,
  loadStudyMetadata,
  loadTlf,
  refuseAnswerKey,
  searchPassages,
} from './data';
import type { AgentId, RegistrySection, Sentence, Slot, SourceRef, TlfData, TlfRef } from './data';
import { assembleFixedParts, documentChecks, textOf } from './assemble';
import type { Check, CsrSection, NeedsPerson } from './assemble';
import { JUDGE_ENDPOINT, JUDGE_LABEL, clearPrintedCache, judgeCoverage, loadScores, persistScore, tickSection } from './score';
import type { ScoreRow } from './score';

/*
 * A run of the CSR Pod. Context is loaded, the Document Planner makes the plan, then the CSR Author,
 * Safety Narrative and QC & Consistency agents work in parallel in dependency waves (wave 1: every
 * section without dependencies and every narrative; wave 2: the discussion; wave 3: the synopsis), the
 * QC agent ties headline figures out against the Genie Agent, and the CSR Assembler assembles the fixed
 * parts and runs the document checks. Every step is streamed as an event and recorded in one MLflow trace.
 */

const AUTHOR_LABEL = 'Claude Sonnet 5.5 via Unity Gateway';

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
  scores: ScoreRow[];
  table_versions: Record<string, number>;
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
    scores: [],
    table_versions: {},
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
    "Study context: CDISCPILOT01, the CDISC pilot study of the xanomeline transdermal therapeutic system (TTS) versus placebo in mild to moderate Alzheimer's disease, 3 treatment groups, primary analyses at Week 24.\n\n" +
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
  const refs = [...new Set(text.match(/Table 14-\d\.\d+/g) ?? [])];
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
    clearPrintedCache();
    // ---------------------------------------------------------------- Context
    agentEv('context', 'running', 'Loading the certified context');
    const base = st.requested ? await latestDoneRunId() : null;
    if (st.requested && !base) throw new Error('there is no finished run to redraft from; draft the whole CSR first');
    st.base_run_id = base;
    const [registry, certified, meta, narrativeRows, baseDoc, fmt] = await Promise.all([
      loadRegistry(),
      certifiedTables(),
      loadStudyMetadata(),
      sqlRows(`SELECT * FROM ${FQ}.narrative_patients ORDER BY row_key`),
      base ? loadDocument(base) : Promise.resolve(null),
      loadFormats(),
    ]);
    const refKey = (r: TlfRef) => `${r.table}@${r.version ?? 'current'}|${(r.keys ?? []).join(',')}|${r.min_pct ?? ''}`;
    const refs = new Map<string, TlfRef>();
    for (const r of registry) for (const t of r.tlf_tables) refs.set(refKey(t), t);
    const tlfs = await Promise.all([...refs.values()].map((r) => loadTlf(r)));
    const tlfByKey = new Map(tlfs.map((t) => [refKey(t.ref), t]));
    const slotIndex = new Map<string, Slot>();
    for (const t of tlfs) for (const s of t.slots) slotIndex.set(s.name, s);
    for (const s of meta.slots) slotIndex.set(s.name, s);
    slotDescriptions = new Map([...slotIndex.values()].map((x) => [x.name, x.description]));
    const tlfNumbers = new Set(certified.map((c) => c.tlf.replace('Table ', '')).filter(Boolean));
    // Delta version of every certified table the run is bound to (the latest of any ref of the table).
    for (const t of tlfs) st.table_versions[t.ref.table] = Math.max(st.table_versions[t.ref.table] ?? 0, t.version);
    const regOf = (id: string) => registry.find((r) => r.section === id);
    await sqlRows(
      `INSERT INTO ${FQ}.csr_runs (run_id, base_run_id, status, started_at, table_versions_json, sections_requested, model, judge_model, trace_id, superseded)
       VALUES (:run, :base, 'running', current_timestamp(), :tv, :req, :model, :judge, :trace, false)`,
      [
        { name: 'run', value: st.run_id },
        { name: 'base', value: base },
        { name: 'tv', value: JSON.stringify(st.table_versions) },
        { name: 'req', value: JSON.stringify(st.requested ?? []) },
        { name: 'model', value: MODEL_LABEL },
        { name: 'judge', value: JUDGE_LABEL },
        { name: 'trace', value: st.trace_id },
      ],
    );
    agentEv('context', 'done', `${certified.length} certified tables, ${registry.length} template sections, protocol and SAP in AI Search`);

    const draftedRegs = registry.filter((r) => r.kind === 'drafted' && (!st.requested || st.requested.includes(r.section)));
    const narrativeReg = registry.find((r) => r.kind === 'narrative');
    const doNarratives = !!narrativeReg && (!st.requested || st.requested.includes(narrativeReg.section));
    // Sections not redrafted in this run come from the base run as they are, with their scores.
    if (baseDoc) {
      for (const s of baseDoc.sections) {
        if (s.kind === 'assembled' || s.kind === 'boilerplate' || s.kind === 'not_in_demo') continue;
        if (draftedRegs.some((r) => r.section === s.section) || (doNarratives && s.kind === 'narrative')) continue;
        st.sections.set(s.section, s);
        const sc = baseDoc.scores.find((x) => x.section === s.section);
        if (sc) st.scores.push({ ...sc, run_id: st.run_id });
      }
      // Tables of copied sections keep the version they were bound to.
      for (const s of baseDoc.sections) for (const x of s.sentences) for (const p of x.parts) if ('slot' in p && p.source_table.startsWith('tlf_') && !(p.source_table in st.table_versions)) st.table_versions[p.source_table] = p.table_version;
    }

    // ---------------------------------------------------------------- Plan
    const defaultPlan = (r: RegistrySection): PlanEntry => ({
      section: r.section,
      passages: [],
      tlfs: r.tlf_tables.map((t) => t.tlf),
      depends_on: r.depends_on,
      wave: r.wave,
    });
    if (baseDoc) {
      st.plan = baseDoc.plan;
      agentEv('planner', 'done', `Plan reused from run ${baseDoc.run_id}`);
    } else {
      agentEv('planner', 'running', 'Planning the document from the registry');
      st.plan = await runPlanner(st, registry, certified, root, toolEv('planner', undefined)).catch((e: Error) => {
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

    const scoreSection = async (sec: CsrSection, reg: RegistrySection) => {
      const { ticks, unverifiable } = await tickSection(sec);
      const cov = sec.kind === 'drafted' ? await judgeCoverage(sec, reg, root) : null;
      const row: ScoreRow = {
        run_id: st.run_id,
        section: sec.section,
        figures_total: ticks.length,
        figures_matched: ticks.filter((t) => t.match).length,
        mismatches: ticks.filter((t) => !t.match).map((t) => ({ sentence_idx: t.sentence_idx, slot: t.slot, drafted_value: t.drafted_value, printed_value: t.printed_value, tlf: t.tlf, row_key: t.row_key, column_name: t.column_name })),
        unverifiable,
        coverage_score: cov?.score ?? null,
        coverage_notes: cov?.notes ?? '',
        left_for_person: cov?.left_for_person ?? [],
        judge_model: JUDGE_LABEL,
        trace_id: st.trace_id,
      };
      st.scores = st.scores.filter((x) => x.section !== sec.section);
      st.scores.push(row);
      await persistScore(row).catch((e: Error) => logEv('qc', `Could not store the score of ${sec.section}: ${e.message.slice(0, 160)}`, sec.section));
      return row;
    };

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
      // Score against the submitted report (scoring only, never fed back to the author).
      if (sec.kind === 'drafted') {
        const sc = await scoreSection(sec, reg).catch((e: Error) => {
          logEv('qc', `Scoring ${sec.section} failed: ${e.message.slice(0, 160)}`, sec.section);
          return null;
        });
        if (sc && sc.figures_matched < sc.figures_total && !sec.needs_person.some((n) => n.kind === 'qc_flag' && /printed/.test(n.reason))) {
          sec.needs_person.push({ reason: `${sc.figures_total - sc.figures_matched} figure${sc.figures_total - sc.figures_matched === 1 ? '' : 's'} differ from the printed value in the submitted report.`, kind: 'qc_flag' });
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
      const r = await runAuthor(st, reg, plan, deps, tlfByKey, refKey, meta.slots, slotIndex, root, toolEv('author', reg.section)).catch((e: Error) => ({
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
      const reg = narrativeReg;
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

    const wave = (n: number) => draftedRegs.filter((r) => (r.wave ?? 1) === n);
    await Promise.all([Promise.all(wave(1).map(authorSection)), narrativeJob()]);
    await Promise.all(wave(2).map(authorSection));
    await Promise.all(wave(3).map(authorSection));
    if (draftedRegs.length) agentEv('author', 'done', `${authorDone} sections drafted${rejected ? `, ${rejected} save${rejected === 1 ? '' : 's'} rejected and fixed` : ''}`, { done: authorDone, total: draftedRegs.length });
    if (qcTotal) agentEv('qc', 'done', `${qcDone} sections checked and scored`, { done: qcDone, total: qcTotal });

    // ---------------------------------------------------------------- Assemble
    agentEv('assembler', 'running', 'Assembling the CSR');
    // Section 14 shows every certified table in full, at its current version.
    const fullRefs = [...new Map([...refs.values()].map((r) => [r.table, { table: r.table, tlf: r.tlf, alias: r.alias, version: null } as TlfRef])).values()];
    const sortedTlfs = (await Promise.all(fullRefs.map((r) => loadTlf(r)))).sort((a, b) => a.ref.tlf.localeCompare(b.ref.tlf, 'en', { numeric: true }));
    await runAssembler(st, registry, meta, sortedTlfs, fmt, tlfNumbers, narrativeRows.length, root, toolEv('assembler', undefined), sectionEv).catch((e: Error) => {
      logEv('assembler', `The assembler failed (${e.message.slice(0, 120)}); assembling in code.`);
      assembleInCode(st, registry, meta, sortedTlfs, fmt, tlfNumbers, narrativeRows.length, sectionEv);
    });
    for (const s of st.sections.values()) if (s.kind === 'assembled' || s.kind === 'boilerplate' || s.kind === 'not_in_demo') await persistSection(st.run_id, s).catch(() => undefined);
    if (baseDoc) {
      // Sections copied from the base run are stored again under this run, with their figure citations.
      for (const s of st.sections.values()) {
        if (s.kind === 'assembled' || s.kind === 'boilerplate' || s.kind === 'not_in_demo') continue;
        if (baseDoc.sections.some((b) => b.section === s.section && b === s)) await persistSection(st.run_id, s).catch(() => undefined);
      }
    }
    // Scores copied from the base run are stored under this run too.
    const stored = new Set((await loadScores(st.run_id).catch(() => [])).map((x) => x.section));
    for (const sc of st.scores) if (!stored.has(sc.section)) await persistScore(sc).catch(() => undefined);
    const passed = st.document_checks.filter((c) => c.ok).length;
    agentEv('assembler', 'done', `${passed} of ${st.document_checks.length} document checks passed`);
    agentEv('signoff', 'idle', 'Waiting for 4 departments');

    st.status = 'done';
    st.finished_at = now();
    st.wall_ms = Date.now() - t0;
    const figs = st.scores.reduce((a, x) => a + x.figures_total, 0);
    const matched = st.scores.reduce((a, x) => a + x.figures_matched, 0);
    const doneEv: PodEvent = { type: 'run', status: 'done', run_id: st.run_id, at: now(), wall_ms: st.wall_ms };
    await sqlRows(
      `UPDATE ${FQ}.csr_runs SET status = 'done', finished_at = current_timestamp(), table_versions_json = :tv, plan_json = :plan, document_checks_json = :dc,
         score_json = :sc, wall_ms = CAST(:ms AS BIGINT), events_json = :ev WHERE run_id = :run`,
      [
        { name: 'tv', value: JSON.stringify(st.table_versions) },
        { name: 'plan', value: JSON.stringify(st.plan) },
        { name: 'dc', value: JSON.stringify(st.document_checks) },
        { name: 'sc', value: JSON.stringify({ figures_total: figs, figures_matched: matched, typed_figures: 0 }) },
        { name: 'ms', value: String(st.wall_ms) },
        { name: 'ev', value: JSON.stringify([...st.events, doneEv]) },
        { name: 'run', value: st.run_id },
      ],
    );
    emit(st, doneEv);
    root.end({ outputs: { sections: st.sections.size, document_checks: `${passed}/${st.document_checks.length}`, rejected_saves: rejected, figures: `${matched}/${figs}`, wall_ms: st.wall_ms } });
  } catch (e) {
    st.status = 'error';
    st.finished_at = now();
    root.end({ status: mlflow.SpanStatusCode.ERROR, outputs: { error: (e as Error).message } });
    emit(st, { type: 'run', status: 'error', run_id: st.run_id, at: now(), error: (e as Error).message });
    await sqlRows(`UPDATE ${FQ}.csr_runs SET status = 'error', finished_at = current_timestamp(), events_json = :ev WHERE run_id = :run`, [
      { name: 'ev', value: JSON.stringify(st.events) },
      { name: 'run', value: st.run_id },
    ]).catch(() => undefined);
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
  root: LiveSpan,
  onTool: (c: ToolCallRecord) => void,
): Promise<PlanEntry[]> {
  const candidates = new Map<string, Map<string, SourceRef>>();
  let plan: PlanEntry[] | null = null;
  const drafted = registry.filter((r) => r.kind === 'drafted');
  const tools: ToolDef[] = [
    {
      name: 'read_registry',
      description: 'Read the section registry: the ICH E3 template as data (sections, kinds, waves, dependencies, expected tables, search hints in plain language).',
      parameters: { type: 'object', properties: {} },
      run: () => ({
        ok: true,
        summary: `${registry.length} sections, ${drafted.length} to draft`,
        content: registry.map((r) => ({
          section: r.section, title: r.title, kind: r.kind, wave: r.wave, depends_on: r.depends_on, search_hints: r.search_hints,
          expected_tables: r.tlf_tables.map((t) => `${t.tlf} (${t.table})`),
        })),
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
      description: 'Candidate passages for one section from the parsed protocol and SAP, found with AI Search (hybrid, restricted to the protocol and SAP). Nothing is pre-selected: you choose.',
      parameters: { type: 'object', properties: { section: { type: 'string' }, query: { type: 'string', description: 'optional extra search in plain words' } }, required: ['section'] },
      run: async (a) => {
        const reg = registry.find((r) => r.section === a.section);
        if (!reg) return { ok: false, summary: `no section ${String(a.section)}`, content: { error: 'unknown section' } };
        const queries = [...reg.search_hints.map((h) => `${reg.title}: ${h}`), ...(typeof a.query === 'string' && a.query ? [a.query] : [])];
        if (queries.length === 0) queries.push(`${reg.title}. ${reg.instructions[0] ?? ''}`);
        const m = candidates.get(reg.section) ?? new Map<string, SourceRef>();
        let n = m.size;
        for (const query of queries.slice(0, 4)) {
          const hits = await searchPassages(query, 3).catch(() => []);
          for (const h of hits) {
            if (refuseAnswerKey(h.doc_part)) continue;
            if ([...m.values()].some((x) => x.kind === 'passage' && x.element_id === h.element_id)) continue;
            m.set(`A${++n}`, asSourceRef(h));
          }
        }
        candidates.set(reg.section, m);
        return {
          ok: true,
          summary: `${reg.section}: ${m.size} candidate passages from ${queries.length} search${queries.length === 1 ? '' : 'es'}`,
          content: [...m.entries()].map(([id, p]) => (p.kind === 'passage' ? { id, doc: p.doc_title, page: p.page, text: p.quote.slice(0, 400) } : { id })),
        };
      },
    },
    {
      name: 'save_plan',
      description: 'Save the document plan: for each drafted section, the passage ids to cite (from find_passages; none for sections that summarise others) and the certified tables to use.',
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
          const ids = strArray(it.passage_ids);
          const bad = ids.filter((id) => !cands.has(id));
          if (bad.length) problems.push(`section ${reg.section}: unknown passage ids ${bad.join(', ')} (call find_passages first)`);
          const tables = strArray(it.tables).map((t) => t.replace(/^.*\./, ''));
          const notCert = tables.filter((t) => !certifiedNames.has(t));
          if (notCert.length) problems.push(`section ${reg.section}: not certified: ${notCert.join(', ')}`);
          if (reg.search_hints.length && ids.length === 0) problems.push(`section ${reg.section}: choose at least one passage from find_passages`);
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
    user: `Plan the CDISCPILOT01 clinical study report. There are ${drafted.length} sections to draft: ${drafted.map((r) => r.section).join(', ')}.`,
    tools,
    parent: root,
    maxTurns: 8,
    maxTokens: 8000,
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
  refKey: (r: TlfRef) => string,
  metaSlots: Slot[],
  slotIndex: Map<string, Slot>,
  root: LiveSpan,
  onTool: (c: ToolCallRecord) => void,
): Promise<{ section: CsrSection; rejected: number; passages: SourceRef[] }> {
  const slots = new Map<string, Slot>();
  const tables = reg.tlf_tables.map((t) => tlfByKey.get(refKey(t))).filter((t): t is TlfData => !!t);
  // Sections that summarise others (synopsis, discussion) get only the figures those sections use.
  if (deps.length === 0) for (const t of tables) for (const s of t.slots) slots.set(s.name, s);
  for (const s of metaSlots) slots.set(s.name, s);
  // Synopsis, conclusions and discussion: only the figures the approved sections already use, from the tables of this section, so they cannot disagree.
  const ownTables = new Set([...tables.map((t) => t.ref.table), 'study_metadata']);
  for (const d of deps) for (const x of d.sentences) for (const p of x.parts) if ('slot' in p && slotIndex.has(p.slot) && ownTables.has(slotIndex.get(p.slot)!.source_table)) slots.set(p.slot, slotIndex.get(p.slot)!);

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
      description: 'AI Search over the parsed protocol and SAP. Hits get ids S1, S2, ... that you may cite.',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      run: async (a) => {
        if (++searches > 3) return { ok: false, summary: 'search limit reached', content: { error: 'at most 3 searches per section' } };
        const q = str(a.query);
        const hits = await searchPassages(q, 3);
        const out: { id: string; doc: string; page: number; text: string }[] = [];
        for (const h of hits) {
          if (refuseAnswerKey(h.doc_part)) continue;
          const el = asSourceRef(h);
          if (el.kind !== 'passage') continue;
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
    user: `Draft section ${reg.section} ${reg.title} of the CDISCPILOT01 clinical study report.`,
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
        description: { age: 'age in years at screening', astdy: 'study day of event onset', aendy: 'study day the event ended', trtdur: 'days on study treatment' }[k] ?? k,
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
      name: 'tick_and_tie',
      description: 'Compare every figure of the section with the printed value in the submitted report\'s table (the answer key; scoring only). Returns how many match.',
      parameters: { type: 'object', properties: {} },
      run: async () => {
        const { ticks, unverifiable } = await tickSection(sec);
        const bad = ticks.filter((t) => !t.match);
        return {
          ok: bad.length === 0,
          summary: `${ticks.length - bad.length} of ${ticks.length} figures match the printed value${unverifiable ? `, ${unverifiable} have no printed counterpart` : ''}`,
          content: { figures: ticks.length, matched: ticks.length - bad.length, differing: bad.slice(0, 8).map((t) => ({ sentence: t.sentence_idx, table: t.tlf, row: t.row_key, column: t.column_name, drafted: t.drafted_value, printed: t.printed_value })) },
        };
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

// ------------------------------------------------------------------------------------------------
// CSR Assembler
// ------------------------------------------------------------------------------------------------

function assembleInCode(
  st: RunState,
  registry: RegistrySection[],
  meta: { text: Record<string, string>; slots: Slot[] },
  tlfs: TlfData[],
  fmt: Map<string, number>,
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
    fmt,
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
  fmt: Map<string, number>,
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
        const parts = assembleInCode(st, registry, meta, tlfs, fmt, tlfNumbers, narrativeTotal, sectionEv);
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
    user: `Assemble the CDISCPILOT01 clinical study report. ${[...st.sections.values()].length} drafted sections are ready.`,
    tools,
    parent: root,
    maxTurns: 5,
    maxTokens: 1500,
    onTool,
  });
  if (!assembled) assembleInCode(st, registry, meta, tlfs, fmt, tlfNumbers, narrativeTotal, sectionEv);
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
  table_versions: Record<string, number>;
  trace_id: string | null;
  model: string;
  judge_model: string;
  plan: PlanEntry[];
  sections: CsrSection[];
  document_checks: Check[];
  scores: ScoreRow[];
  /** Sentences that quote a cell whose value changed in a later version of its table. */
  redelivery: { section: string; sentence_idx: number; slot: string; table: string; old_version: number; new_version: number; old_value: string; new_value: string }[];
}

export async function latestDoneRunId(): Promise<string | null> {
  const r = await sqlRows(
    `SELECT run_id FROM ${FQ}.csr_runs WHERE status = 'done' AND coalesce(superseded, false) = false ORDER BY finished_at DESC LIMIT 1`,
  );
  return (r[0]?.run_id as string) ?? null;
}

/** Events of a finished run, replayed from the stored state (also after a server restart). */
export async function loadStoredEvents(runId: string): Promise<PodEvent[] | null> {
  const r = await sqlRows(`SELECT status, events_json FROM ${FQ}.csr_runs WHERE run_id = :r`, [{ name: 'r', value: runId }]);
  if (!r[0] || !r[0].events_json) return null;
  return JSON.parse(r[0].events_json) as PodEvent[];
}

async function redelivery(sections: CsrSection[]) {
  const out: CsrDocument['redelivery'] = [];
  const tables = new Set<string>();
  for (const s of sections) for (const x of s.sentences) for (const p of x.parts) if ('slot' in p && p.source_table.startsWith('tlf_')) tables.add(p.source_table);
  const fmt = await loadFormats();
  for (const table of tables) {
    const cur = await loadTlf({ table, tlf: '', alias: 'x', version: null });
    for (const s of sections)
      s.sentences.forEach((x, i) => {
        for (const p of x.parts) {
          if (!('slot' in p) || p.source_table !== table || p.table_version === cur.version) continue;
          const c = cur.rows.find((v) => v.row_key === p.row_key);
          const raw = c?.[p.column_name];
          if (raw === null || raw === undefined) continue;
          const nv = formatCell(fmt, table, p.row_key, p.column_name, raw);
          if (nv !== p.value) out.push({ section: s.section, sentence_idx: i + 1, slot: p.slot, table, old_version: p.table_version, new_version: cur.version, old_value: p.value, new_value: nv });
        }
      });
  }
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
      table_versions: st.table_versions,
      trace_id: st.trace_id,
      model: AUTHOR_LABEL,
      judge_model: JUDGE_LABEL,
      plan: st.plan,
      sections,
      document_checks: st.document_checks,
      scores: st.scores,
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
    table_versions: pj<Record<string, number>>(run.table_versions_json as string, {}),
    trace_id: (run.trace_id as string) ?? null,
    model: AUTHOR_LABEL,
    judge_model: (run.judge_model as string) ?? JUDGE_LABEL,
    plan: pj<PlanEntry[]>(run.plan_json, []),
    sections,
    document_checks: pj<Check[]>(run.document_checks_json, []),
    scores: await loadScores(runId).catch(() => []),
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
