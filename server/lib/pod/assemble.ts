import type { RegistrySection, Sentence, Slot, TlfData } from './data';
import { bind, formatCell } from './data';

/*
 * The parts of the CSR that are assembled, not written: title page, contents, abbreviations, the ethics
 * and investigator boilerplate, the TLF tables of section 14, references and appendices. Plus the
 * document-level checks and the Word export. No model calls here.
 */

export interface Check {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
}
export interface NeedsPerson {
  sentence_idx?: number;
  reason: string;
  kind: 'interpretation' | 'check_failed' | 'judge' | 'qc_flag';
}
export interface ToolCall {
  tool: string;
  args: unknown;
  ok: boolean;
  result_summary: string;
  ms: number;
  detail?: unknown;
}
export interface CsrSection {
  section: string;
  title: string;
  ord: number;
  kind: RegistrySection['kind'];
  agent: string;
  department: string;
  status: 'assembled' | 'drafted' | 'checked' | 'needs_person' | 'failed';
  sentences: Sentence[];
  html?: string;
  checks: Check[];
  judge?: { verdict: 'yes' | 'no' | 'unavailable'; reason: string; model: string };
  needs_person: NeedsPerson[];
  tool_log: ToolCall[];
  trace_id: string | null;
  drafted_at: string | null;
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const ABBREVIATIONS: Record<string, string> = {
  ADAS: "Alzheimer's Disease Assessment Scale",
  AD: "Alzheimer's disease",
  ADAM: 'Analysis Data Model',
  ADRDA: "Alzheimer's Disease and Related Disorders Association",
  AE: 'adverse event',
  ANCOVA: 'analysis of covariance',
  ANOVA: 'analysis of variance',
  BMI: 'body mass index',
  CDISC: 'Clinical Data Interchange Standards Consortium',
  CI: 'confidence interval',
  CNS: 'central nervous system',
  CIBIC: "Clinician's Interview-Based Impression of Change",
  CRF: 'case report form',
  CSR: 'clinical study report',
  DAD: 'Disability Assessment for Dementia',
  GCP: 'Good Clinical Practice',
  ICH: 'International Council for Harmonisation of Technical Requirements for Pharmaceuticals for Human Use',
  ITT: 'intent-to-treat',
  LOCF: 'last observation carried forward',
  LS: 'least squares',
  MedDRA: 'Medical Dictionary for Regulatory Activities',
  MMSE: 'Mini-Mental State Examination',
  NINCDS: 'National Institute of Neurological and Communicative Disorders and Stroke',
  PT: 'preferred term',
  SAE: 'serious adverse event',
  SAP: 'statistical analysis plan',
  SD: 'standard deviation',
  SDTM: 'Study Data Tabulation Model',
  SOC: 'system organ class',
  TEAE: 'treatment-emergent adverse event',
  TLF: 'tables, listings and figures',
  TTS: 'transdermal therapeutic system',
};
// Tokens that look like abbreviations but are not: roman numerals, study codes and arm labels.
const NOT_ABBREVIATIONS = new Set(['II', 'III', 'IV', 'CDISCPILOT', 'LZZT', 'TRT', 'PBO', 'DIFF', 'MILD', 'MODERATE', 'SEVERE', 'FATAL', 'Y', 'N', 'NPI', 'LY', 'NONE', 'ID']);

export function textOf(s: Sentence): string {
  return s.parts.map((p) => ('text' in p ? p.text : p.value)).join('');
}

export function abbreviationsUsed(sections: CsrSection[]): { known: string[]; unknown: string[] } {
  const known = new Set<string>();
  const unknown = new Set<string>();
  for (const sec of sections) {
    for (const s of sec.sentences) {
      for (const tok of textOf(s).match(/\b(?:MedDRA|[A-Z]{2,6})\b/g) ?? []) {
        if (NOT_ABBREVIATIONS.has(tok)) continue;
        if (tok in ABBREVIATIONS) known.add(tok);
        else unknown.add(tok);
      }
    }
  }
  return { known: [...known].sort(), unknown: [...unknown].sort() };
}

function renderTlf(t: TlfData, fmt: Map<string, number>): string {
  const cols = t.columns.filter((c) => c.numeric && !c.comment.includes('[no-slot]'));
  const head = cols.map((c) => `<th>${esc(c.name.replace(/_/g, ' '))}</th>`).join('');
  const body = t.rows
    .map((r) => {
      const label = (r.row_label as string) ?? (r.arm as string) ?? (r.row_key as string);
      const cells = cols.map((c) => {
        const v = r[c.name];
        const shown = v === null || v === undefined ? '' : formatCell(fmt, t.ref.table, r.row_key as string, c.name, v);
        return `<td class="num">${esc(shown)}</td>`;
      });
      return `<tr><td>${esc(label)}</td>${cells.join('')}</tr>`;
    })
    .join('');
  const ver = t.ref.version === null ? `current version ${t.version}` : `version ${t.version}`;
  return (
    `<h3>${esc(t.ref.tlf)}</h3><p class="tlf-meta">Certified table ${esc(t.ref.table)}, ${esc(ver)}. Inserted as delivered by Biostatistics.</p>` +
    `<table class="tlf"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`
  );
}

export function assembleFixedParts(opts: {
  registry: RegistrySection[];
  meta: { text: Record<string, string>; slots: Slot[] };
  tlfs: TlfData[];
  drafted: CsrSection[];
  fmt: Map<string, number>;
  base: Omit<CsrSection, 'section' | 'title' | 'ord' | 'kind' | 'agent' | 'department' | 'sentences' | 'status'>;
}): CsrSection[] {
  const { registry, meta, tlfs, drafted, fmt } = opts;
  const t = meta.text;
  const metaSlots = new Map(meta.slots.map((s) => [s.name, s]));
  const reg = (id: string) => registry.find((r) => r.section === id);
  const out: CsrSection[] = [];
  const make = (id: string, extra: Partial<CsrSection>): void => {
    const r = reg(id);
    if (!r) return;
    out.push({
      ...opts.base,
      section: r.section,
      title: r.title,
      ord: r.ord,
      kind: r.kind,
      agent: 'assembler',
      department: r.department,
      status: 'assembled',
      sentences: [],
      ...extra,
    });
  };

  const titleRows = [
    ['Study', t.study_id ?? 'CDISCPILOT01'],
    ['Title', t.title ?? ''],
    ['Phase', t.phase ?? ''],
    ['Investigational product', t.product ?? ''],
    ['Indication', t.indication ?? ''],
    ['Sponsor', t.sponsor ?? ''],
    ['Protocol', t.protocol_number ?? ''],
    ['First subject visit', t.first_subject_visit ?? ''],
    ['Last subject completion', t.last_subject_completion ?? ''],
  ].filter(([, v]) => v);
  make('1', {
    html:
      `<p class="title-kicker">Clinical Study Report (ICH E3)</p><h2 class="title-main">${esc(t.title ?? 'CDISCPILOT01')}</h2>` +
      `<table class="meta">${titleRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</table>` +
      `<p class="note">Draft for review. A demonstration draft of the CSR of the public CDISC Pilot Project study, prepared by the CSR Pod from the analysis data and not released until every responsible department has signed. ${esc(t.data_source ?? '')}</p>`,
  });

  make('3', {
    html: `<ol class="toc">${registry
      .filter((r) => r.kind !== 'narrative')
      .map((r) => `<li><span class="toc-n">${esc(r.section)}</span> ${esc(r.title)}</li>`)
      .join('')}</ol>`,
  });

  const boiler = (id: string, templates: string[]) => {
    const allowed = new Set<string>();
    const b = bind(templates, metaSlots, allowed);
    make(id, {
      kind: 'boilerplate',
      sentences: b.bound.map((s) => ({ ...s, sources: [{ kind: 'tlf', tlf: 'Study metadata', table: 'study_metadata' }] })),
    });
  };
  boiler('5', [
    'The study was conducted in accordance with ICH Good Clinical Practice regulations and guidelines.',
    'The protocol was reviewed by the ethics committees or institutional review boards of the participating centres, as required by Good Clinical Practice.',
    "Written informed consent was required from each subject or the subject's representative before any study procedure.",
  ]);
  boiler(
    '6',
    [
      metaSlots.has('meta_n_sites') ? 'The study was conducted at {meta_n_sites} centres.' : '',
      'A list of principal investigators is not provided in this pilot project.',
    ].filter(Boolean),
  );

  const { known } = abbreviationsUsed([...drafted, ...out.filter((o) => o.kind === 'boilerplate')]);
  make('4', {
    html: `<table class="abbr"><tbody>${known.map((a) => `<tr><th>${esc(a)}</th><td>${esc(ABBREVIATIONS[a])}</td></tr>`).join('')}</tbody></table>`,
  });
  make('14', { html: tlfs.map((x) => renderTlf(x, fmt)).join('') });
  make('15', {
    html:
      '<ol class="refs"><li>ICH E3: Structure and Content of Clinical Study Reports.</li><li>ICH E6(R3): Guideline for Good Clinical Practice.</li>' +
      '<li>ICH E9: Statistical Principles for Clinical Trials.</li><li>MedDRA, the Medical Dictionary for Regulatory Activities.</li></ol>',
  });
  make('16', {
    html:
      '<ul class="apx"><li>16.1.1 Protocol: Protocol H2Q-MC-LZZT(c)</li><li>16.1.9 Documentation of statistical methods: Statistical Analysis Plan</li>' +
      '<li>16.2 Subject data: the analysis datasets ADSL, ADAE, ADQSADAS, ADQSCIBC and ADTTE in Unity Catalog</li></ul>',
  });
  for (const r of registry.filter((x) => x.kind === 'not_in_demo')) {
    make(r.section, { html: `<p class="note">Not part of this demo. ${esc(r.instructions.join(' ').replace(/^Not part of this demo[:.]?\s*/i, ''))}</p>` });
  }
  return out.sort((a, b) => a.ord - b.ord);
}

export function documentChecks(sections: CsrSection[], registry: RegistrySection[], tlfNumbers: Set<string>, narrativeTotal: number): Check[] {
  const drafted = sections.filter((s) => s.kind === 'drafted' || s.kind === 'narrative');
  const body = drafted.filter((s) => s.section !== '2');
  const synopsis = sections.find((s) => s.section === '2');
  const slotsIn = (secs: CsrSection[]) => new Set(secs.flatMap((s) => s.sentences.flatMap((x) => x.parts.flatMap((p) => ('slot' in p ? [p.slot] : [])))));
  const bodySlots = slotsIn(body);
  const synSlots = synopsis ? [...slotsIn([synopsis])] : [];
  const orphan = synSlots.filter((s) => !bodySlots.has(s));

  const typed = drafted.flatMap((s) => s.checks.filter((c) => c.id === 'no_typed_figures' && !c.ok).map(() => s.section));
  const figures = sections.reduce((n, s) => n + s.sentences.reduce((m, x) => m + x.parts.filter((p) => 'slot' in p).length, 0), 0);
  const unbound = sections.filter((s) => s.sentences.some((x) => x.parts.some((p) => 'text' in p && /\{\w+\}/.test(p.text)))).map((s) => s.section);

  const refs = new Set<string>();
  for (const s of sections) for (const x of s.sentences) for (const m of textOf(x).match(/Table 14\.\d+\.\d+/g) ?? []) refs.add(m.replace('Table ', ''));
  const missingRefs = [...refs].filter((r) => !tlfNumbers.has(r));

  const { unknown } = abbreviationsUsed(drafted);

  const coverageFails = drafted.filter((s) => s.checks.some((c) => c.id === 'required_content' && !c.ok)).map((s) => s.section);

  const cellValues = new Map<string, Set<string>>();
  const cellSections = new Map<string, Set<string>>();
  for (const s of sections)
    for (const x of s.sentences)
      for (const p of x.parts)
        if ('slot' in p) {
          const k = `${p.source_table}|${p.row_key}|${p.slot}|${p.table_version}`;
          if (!cellValues.has(k)) {
            cellValues.set(k, new Set());
            cellSections.set(k, new Set());
          }
          cellValues.get(k)!.add(p.value);
          cellSections.get(k)!.add(s.section);
        }
  const shared = [...cellSections.values()].filter((v) => v.size > 1).length;
  const inconsistent = [...cellValues.values()].filter((v) => v.size > 1).length;

  const narratives = sections.find((s) => s.kind === 'narrative');
  const narrativeCount = narratives ? narratives.sentences.filter((x) => x.heading).length : 0;
  const missingSections = registry.filter((r) => !sections.some((s) => s.section === r.section)).map((r) => r.section);

  return [
    { id: 'all_sections_present', label: 'Every template section is present', ok: missingSections.length === 0, detail: missingSections.length ? `missing: ${missingSections.join(', ')}` : `${registry.length} sections` },
    { id: 'no_typed_figures', label: 'No figure typed by a model', ok: typed.length === 0, detail: typed.length ? `sections ${typed.join(', ')}` : 'checked in every drafted section' },
    { id: 'figures_bound', label: 'Every figure bound to a certified cell', ok: unbound.length === 0, detail: unbound.length ? `unbound placeholders in ${unbound.join(', ')}` : `${figures} figures` },
    { id: 'same_result_same_value', label: 'The same result has the same value everywhere', ok: inconsistent === 0, detail: `${shared} cells are quoted in more than 1 section` },
    { id: 'synopsis_matches_body', label: 'Every synopsis figure is also used in the body', ok: !!synopsis && orphan.length === 0, detail: synopsis ? (orphan.length ? `only in the synopsis: ${orphan.join(', ')}` : `${synSlots.length} synopsis figures`) : 'no synopsis' },
    { id: 'tlf_references_resolve', label: 'Every table reference exists in the TLF catalogue', ok: missingRefs.length === 0, detail: missingRefs.length ? `not in the catalogue: ${missingRefs.map((r) => `Table ${r}`).join(', ')}` : `${refs.size} tables referenced` },
    { id: 'abbreviations_defined', label: 'Every abbreviation is in the list of abbreviations', ok: unknown.length === 0, detail: unknown.length ? `not defined: ${unknown.join(', ')}` : 'section 4' },
    { id: 'required_content', label: 'Required content of each section is covered', ok: coverageFails.length === 0, detail: coverageFails.length ? `gaps in ${coverageFails.join(', ')}` : `${drafted.length} sections` },
    { id: 'narratives_complete', label: 'A narrative for every death and SAE leading to withdrawal', ok: narrativeCount === narrativeTotal && narrativeTotal > 0, detail: `${narrativeCount} of ${narrativeTotal}` },
  ];
}

const DOC_CSS = `body{font-family:'Times New Roman',serif;font-size:11pt;line-height:1.4;color:#111}h1{font-size:18pt}h2{font-size:14pt;margin-top:18pt}h3{font-size:12pt}
table{border-collapse:collapse;margin:6pt 0}td,th{border:1px solid #999;padding:3pt 6pt;font-size:9.5pt;text-align:left}td.num{text-align:right}.note,.tlf-meta{color:#555;font-size:9pt}.title-kicker{text-transform:uppercase;letter-spacing:1px;color:#555}`;

export function exportHtml(sections: CsrSection[], run: { run_id: string; finished_at: string | null }): string {
  const body = sections
    .map((s) => {
      const heading = `<h2>${esc(s.section)} ${esc(s.title)}</h2>`;
      if (s.html) return heading + s.html;
      const paras: string[] = [];
      let cur: string[] = [];
      for (const x of s.sentences) {
        if (x.heading) {
          if (cur.length) paras.push(`<p>${cur.join(' ')}</p>`);
          cur = [];
          paras.push(`<h3>${esc(x.heading)}</h3>`);
        }
        cur.push(esc(textOf(x)));
      }
      if (cur.length) paras.push(`<p>${cur.join(' ')}</p>`);
      return heading + paras.join('');
    })
    .join('');
  return (
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>CDISCPILOT01 CSR draft</title><style>${DOC_CSS}</style></head>` +
    `<body><h1>CDISCPILOT01 Clinical Study Report, draft</h1><p class="note">Run ${esc(run.run_id)}${run.finished_at ? `, drafted ${esc(run.finished_at)}` : ''}. Demonstration draft. Every figure is filled from a certified table cell. Data: CDISC SDTM/ADaM Pilot Project (CDISCPILOT01), used under the CDISC terms of use.</p>${body}</body></html>`
  );
}
