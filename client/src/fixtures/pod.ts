import type { CsrDocument, CsrSection, PodDef, PodEvent, SourceRef } from '../data/types';

/* FIXTURE. Shapes follow rnd_regsub_review docs/CSR_POD_BUILD.md section 3.1; the text is invented. */

export const podFixture: PodDef = {
  columns: [
    { title: 'Context', members: ['context'] },
    { title: 'Plan', edge: 'section plan', members: ['planner'] },
    { title: 'Draft and check', parallel: true, edge: 'passages and tables', members: ['author', 'narrative', 'qc'] },
    { title: 'Assemble', edge: 'checked sections', members: ['assembler'] },
    { title: 'Sign-off', edge: 'full draft', members: ['signoff'] },
  ],
  members: [
    {
      id: 'context',
      kind: 'source',
      title: 'Certified context',
      actsFor: 'Biostatistics',
      note: 'Certified tables, study metadata and the empty ICH E3 template.',
      calls: ['tlf_* tables', 'study_metadata', 'section_registry'],
    },
    {
      id: 'planner',
      kind: 'agent',
      title: 'Document Planner',
      actsFor: 'Medical Writing',
      how: {
        name: 'plan-csr-sections',
        text: 'Read the template. For every section, decide which certified tables it quotes and which protocol or SAP passages it needs.\nSearch the protocol and the SAP with plain-language queries. Never ask for a page number.\nOrder the sections in waves so a section is drafted after the sections it depends on.',
      },
      acts: ['read_registry', 'find_passages', 'list_tlf_tables', 'save_plan'],
      calls: ['AI Search'],
    },
    {
      id: 'author',
      kind: 'agent',
      title: 'CSR Author',
      actsFor: 'Medical Writing',
      how: {
        name: 'write-csr-section',
        text: 'Write each sentence as a template with named slots. A slot is filled from one certified cell, never typed.\nSearch the protocol and the SAP for the wording of methods and populations.\nMark interpretation sentences so a person reviews them.',
      },
      acts: ['search_documents', 'read_tlf_cells', 'save_csr_draft'],
      calls: ['AI Search', 'Unity Gateway model service'],
    },
    {
      id: 'narrative',
      kind: 'agent',
      title: 'Safety Narrative',
      actsFor: 'Clinical Safety',
      how: {
        name: 'write-patient-narratives',
        text: 'For each death and serious adverse event, write a narrative from the patient record.\nUse only the fields in the narrative table.',
      },
      acts: ['read_narrative_patients', 'save_csr_draft'],
      calls: ['Unity Gateway model service'],
    },
    {
      id: 'qc',
      kind: 'agent',
      title: 'QC and Consistency',
      actsFor: 'Biostatistics',
      how: {
        name: 'check-csr-section',
        text: 'Check that every figure equals its certified cell.\nCompare the cells with the printed values in the submitted report, which only this agent can read.\nScore the wording against the submitted section with a model from a second family.',
      },
      acts: ['run_section_checks', 'tick_and_tie', 'judge_section', 'flag_for_person'],
      calls: ['Foundation Model API judge'],
    },
    {
      id: 'assembler',
      kind: 'agent',
      title: 'CSR Assembler',
      actsFor: 'Medical Writing',
      how: { name: 'assemble-csr', text: 'Put the sections in ICH E3 order, build the title page, contents, abbreviations and the tables of section 14.' },
      acts: ['assemble_document', 'run_document_checks'],
    },
    {
      id: 'signoff',
      kind: 'gate',
      title: 'Departmental sign-off',
      actsFor: 'Medical Writing, Biostatistics, Clinical Safety, then Regulatory Affairs',
      note: 'Nothing is released until the responsible people sign.',
    },
  ],
  departments: [
    { department: 'Medical Writing', signer: 'Dr. Priya Raman', role: 'Medical Writing Lead', scope: 'Narrative sections and overall draft', sections: ['2', '9.1', '9.4', '13'] },
    { department: 'Biostatistics', signer: 'Tomas Berg', role: 'Lead Biostatistician', scope: 'Efficacy and statistical sections', sections: ['9.7', '10.1', '10.2', '11.3', '11.4.1', '11.4.2', '12.1'] },
    { department: 'Clinical Safety', signer: 'Dr. Hana Okafor', role: 'Safety Physician', scope: 'Adverse events and narratives', sections: ['12.2', '12.3'] },
    { department: 'Regulatory Affairs', signer: 'Elena Marchetti', role: 'Regulatory Lead', scope: 'Release of the draft', sections: [] },
  ],
};

const passages: SourceRef[] = [
  {
    kind: 'passage',
    doc_title: 'Protocol',
    file_path: 'cdiscpilot01.pdf',
    page: 171,
    element_id: 4412,
    quote: 'Fixture passage: the primary efficacy endpoints are the change from baseline to Week 24 in the ADAS-Cog (11) total score and in the CIBIC+ score.',
  },
  {
    kind: 'passage',
    doc_title: 'SAP',
    file_path: 'cdiscpilot01.pdf',
    page: 432,
    element_id: 7108,
    quote: 'Fixture passage: the primary analysis is an ANCOVA with treatment, site group and baseline score, using the last observation carried forward.',
  },
  {
    kind: 'passage',
    doc_title: 'SAP',
    file_path: 'cdiscpilot01.pdf',
    page: 427,
    element_id: 7011,
    quote: 'Fixture passage: adverse events are treatment-emergent if they start on or after the first dose of study drug.',
  },
];

function section(partial: Partial<CsrSection> & Pick<CsrSection, 'section' | 'title' | 'ord' | 'agent' | 'department'>): CsrSection {
  return {
    kind: 'drafted',
    status: 'checked',
    sentences: [],
    checks: [],
    needs_person: [],
    tool_log: [],
    trace_id: 'fixture-trace',
    drafted_at: '2026-10-22T09:15:10Z',
    ...partial,
  };
}

export const csrDocFixture: CsrDocument = {
  run_id: 'fixture-run-0001',
  started_at: '2026-10-22T09:14:02Z',
  finished_at: '2026-10-22T09:17:06Z',
  wall_ms: 184000,
  table_versions_json: JSON.stringify({ tlf_14_5_01_teae: 1, tlf_14_3_01_adascog_w24: 1 }),
  trace_id: 'fixture-trace',
  model: 'databricks-claude-sonnet-5-5',
  judge_model: 'databricks-gpt-5-5',
  plan: [
    { section: '11.4.1', passages: passages.slice(0, 2), tlfs: ['tlf_14_3_01_adascog_w24'], depends_on: ['11.3'], wave: 2 },
    { section: '12.2', passages: passages.slice(2), tlfs: ['tlf_14_5_01_teae'], depends_on: ['12.1'], wave: 2 },
  ],
  sections: [
    section({
      section: '11.4.1',
      title: 'ADAS-Cog primary endpoint',
      ord: 41,
      agent: 'author',
      department: 'Biostatistics',
      tool_log: [
        { tool: 'search_documents', args: { query: 'primary efficacy endpoint ADAS-Cog change from baseline Week 24', filter: { doc_part: ['protocol', 'sap'] } }, ok: true, result_summary: '6 passages, best match SAP page 432', ms: 640 },
        { tool: 'search_documents', args: { query: 'analysis method for the ADAS-Cog primary endpoint', filter: { doc_part: ['protocol', 'sap'] } }, ok: true, result_summary: '5 passages, best match SAP page 432', ms: 590 },
        { tool: 'read_tlf_cells', args: { tlf: 'tlf_14_3_01_adascog_w24', rows: ['n', 'ls_mean_change', 'diff_vs_pbo'] }, ok: true, result_summary: '13 cells read at version 1', ms: 310 },
        { tool: 'save_csr_draft', args: { section: '11.4.1', sentences: 5 }, ok: true, result_summary: 'Saved. 13 slots filled from certified cells.', ms: 220 },
      ],
    }),
    section({
      section: '12.2',
      title: 'Adverse events',
      ord: 52,
      agent: 'author',
      department: 'Clinical Safety',
      tool_log: [
        { tool: 'search_documents', args: { query: 'definition of treatment-emergent adverse event', filter: { doc_part: ['protocol', 'sap'] } }, ok: true, result_summary: '4 passages, best match SAP page 427', ms: 610 },
        { tool: 'read_tlf_cells', args: { tlf: 'tlf_14_5_01_teae', rows: ['ANY', 'top PT rows'] }, ok: true, result_summary: '20 cells read at version 1', ms: 340 },
        { tool: 'save_csr_draft', args: { section: '12.2', sentences: 6 }, ok: true, result_summary: 'Saved. 20 slots filled from certified cells.', ms: 205 },
      ],
    }),
    section({
      section: '12.3',
      title: 'Deaths, serious and other significant adverse events',
      ord: 53,
      agent: 'narrative',
      department: 'Clinical Safety',
      kind: 'narrative',
      status: 'needs_person',
      tool_log: [
        { tool: 'read_narrative_patients', args: { reason: 'death or serious adverse event' }, ok: true, result_summary: '5 patients', ms: 280 },
        { tool: 'save_csr_draft', args: { section: '12.3', sentences: 9 }, ok: true, result_summary: 'Saved.', ms: 190 },
      ],
    }),
  ],
  document_checks: [],
};

/* A short scripted stream, used by the fixture build of the replay and the redraft. */
function ev<T extends PodEvent['type']>(e: Extract<PodEvent, { type: T }>): PodEvent {
  return e;
}
const at = (s: number) => new Date(Date.UTC(2026, 9, 22, 9, 14, s)).toISOString();

export function replayEvents(runId: string): PodEvent[] {
  return [
    ev({ type: 'run', status: 'running', run_id: runId, at: at(2) }),
    ev({ type: 'agent', agent: 'context', status: 'done', at: at(3), summary: '8 certified tables read' }),
    ev({ type: 'agent', agent: 'planner', status: 'running', at: at(4) }),
    ev({ type: 'tool', agent: 'planner', tool: 'find_passages', args: { query: 'analysis populations', filter: { doc_part: ['protocol', 'sap'] } }, ok: true, result_summary: '7 passages', ms: 580, at: at(8) }),
    ev({ type: 'agent', agent: 'planner', status: 'done', at: at(30), summary: '30 sections planned in 3 waves' }),
    ev({ type: 'agent', agent: 'author', status: 'running', at: at(31), progress: { done: 0, total: 21 } }),
    ev({ type: 'agent', agent: 'narrative', status: 'running', at: at(31) }),
    ev({ type: 'agent', agent: 'qc', status: 'running', at: at(60) }),
    ev({ type: 'agent', agent: 'author', status: 'running', at: at(90), progress: { done: 14, total: 21 } }),
    ev({ type: 'agent', agent: 'narrative', status: 'done', at: at(110) }),
    ev({ type: 'agent', agent: 'author', status: 'done', at: at(150), progress: { done: 21, total: 21 } }),
    ev({ type: 'agent', agent: 'qc', status: 'done', at: at(170), summary: '212 of 219 figures match the submitted CSR' }),
    ev({ type: 'agent', agent: 'assembler', status: 'done', at: at(184) }),
    ev({ type: 'run', status: 'done', run_id: runId, at: at(186), wall_ms: 184000 }),
  ];
}

export function redraftEvents(runId: string): PodEvent[] {
  return [
    ev({ type: 'run', status: 'running', run_id: runId, at: at(0) }),
    ev({ type: 'agent', agent: 'author', status: 'running', at: at(1), progress: { done: 0, total: 1 } }),
    ev({ type: 'section', section: '12.2', status: 'drafting', agent: 'author', at: at(2) }),
    ev({ type: 'tool', agent: 'author', section: '12.2', tool: 'read_tlf_cells', args: { tlf: 'tlf_14_5_01_teae' }, ok: true, result_summary: '20 cells read at version 2', ms: 300, at: at(3) }),
    ev({ type: 'tool', agent: 'author', section: '12.2', tool: 'save_csr_draft', args: { section: '12.2' }, ok: true, result_summary: 'Saved. 20 slots filled from certified cells.', ms: 210, at: at(4) }),
    ev({ type: 'agent', agent: 'author', status: 'done', at: at(5), progress: { done: 1, total: 1 } }),
    ev({ type: 'agent', agent: 'qc', status: 'running', at: at(6) }),
    ev({ type: 'section', section: '12.2', status: 'checked', agent: 'qc', at: at(7) }),
    ev({ type: 'agent', agent: 'qc', status: 'done', at: at(8), summary: '20 of 20 figures match the submitted CSR' }),
    ev({ type: 'run', status: 'done', run_id: runId, at: at(9), wall_ms: 9000 }),
  ];
}
