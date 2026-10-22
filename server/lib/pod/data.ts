import { CATALOG, FQ, INDEX_NAME, SCHEMA, dbxFetch, sqlRows, tableVersion } from '../dbx';

/*
 * The data side of the CSR Pod: the section registry (the company template as a table), the certified
 * TLF tables turned into placeholders, the parsed passages, and the binding of placeholders to cells.
 * Nothing here calls a model.
 */

export type Kind = 'assembled' | 'boilerplate' | 'drafted' | 'narrative' | 'not_in_demo';
export type AgentId = 'context' | 'planner' | 'author' | 'narrative' | 'qc' | 'assembler' | 'signoff';

export interface TlfRef {
  table: string;
  tlf: string;
  alias: string;
  version: number | null;
  /** Only these row keys become placeholders for the section (keeps the brief short). */
  keys?: string[];
  /** Adverse event tables: keep preferred term rows only when some arm reaches this percentage. */
  min_pct?: number;
}
export interface RegistrySection {
  section: string;
  title: string;
  ord: number;
  kind: Kind;
  agent: AgentId;
  department: string;
  wave: number | null;
  instructions: string[];
  search_hints: string[];
  tlf_tables: TlfRef[];
  depends_on: string[];
  required_content: string[];
}

export type SourceRef =
  | { kind: 'passage'; doc_title: string; doc_part?: string; file_path: string; page: number; element_id: number; quote: string }
  | { kind: 'tlf'; tlf: string; table: string }
  | { kind: 'writer' };

export interface Slot {
  name: string;
  description: string;
  value: string;
  source_table: string;
  tlf: string;
  row_key: string;
  column_name: string;
  table_version: number;
}

export type Part = { text: string } | { slot: string; value: string; source_table: string; tlf: string; row_key: string; column_name: string; table_version: number };

export interface Sentence {
  template: string;
  parts: Part[];
  sources: SourceRef[];
  interpretation?: boolean;
  heading?: string;
}

const parseJson = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export async function loadRegistry(): Promise<RegistrySection[]> {
  const rows = await sqlRows(`SELECT * FROM ${FQ}.section_registry ORDER BY ord`);
  return rows.map((r) => ({
    section: r.section as string,
    title: r.title as string,
    ord: Number(r.ord),
    kind: r.kind as Kind,
    agent: r.agent as AgentId,
    department: r.department as string,
    wave: r.wave === null ? null : Number(r.wave),
    instructions: (r.instructions ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    search_hints: parseJson<string[]>(r.search_hints, []),
    tlf_tables: parseJson<TlfRef[]>(r.tlf_tables, []),
    depends_on: parseJson<string[]>(r.depends_on, []),
    required_content: parseJson<string[]>(r.required_content, []),
  }));
}

/** Certified tables in the schema, from the governed certification tag, with the TLF number from the comment. */
export async function certifiedTables(): Promise<{ table: string; tlf: string; comment: string }[]> {
  const rows = await sqlRows(
    `SELECT t.table_name, t.comment FROM ${CATALOG}.information_schema.tables t
     JOIN ${CATALOG}.information_schema.table_tags g
       ON g.schema_name = t.table_schema AND g.table_name = t.table_name
     WHERE t.table_schema = '${SCHEMA}' AND g.tag_name = 'system.certification_status' AND g.tag_value = 'certified'
     ORDER BY t.table_name`,
  );
  return rows.map((r) => {
    const comment = (r.comment as string) ?? '';
    const tlf = comment.match(/Table 14-\d\.\d+/)?.[0] ?? '';
    return { table: r.table_name as string, tlf, comment };
  });
}

const NUMERIC = /^(INT|INTEGER|BIGINT|LONG|SMALLINT|TINYINT|DOUBLE|FLOAT|DECIMAL.*)$/i;

export interface TlfData {
  ref: TlfRef;
  version: number;
  columns: { name: string; comment: string; numeric: boolean }[];
  rows: Record<string, string | null>[];
  slots: Slot[];
}

const tlfCache = new Map<string, Promise<TlfData>>();

export function clearTlfCache() {
  tlfCache.clear();
  formatCache = undefined;
}

export { tableVersion };

/** Printed precision of every TLF cell: table -> row_key (or '*') -> column -> decimals. */
let formatCache: Promise<Map<string, number>> | undefined;
export function loadFormats(): Promise<Map<string, number>> {
  formatCache ??= sqlRows(`SELECT tlf_table, row_key, column_name, decimals FROM ${FQ}.tlf_formats`).then(
    (rows) => new Map(rows.map((r) => [`${r.tlf_table}|${r.row_key}|${r.column_name}`, Number(r.decimals)])),
  );
  return formatCache;
}

export function decimalsOf(fmt: Map<string, number>, table: string, rowKey: string, column: string): number {
  return fmt.get(`${table}|${rowKey}|${column}`) ?? fmt.get(`${table}|*|${column}`) ?? 0;
}

/** A cell as the submitted table prints it. */
export function formatCell(fmt: Map<string, number>, table: string, rowKey: string, column: string, raw: string): string {
  return Number(raw).toFixed(decimalsOf(fmt, table, rowKey, column));
}

/** A certified table at the version the run is drafted against, turned into one placeholder per (row, numeric column). */
export function loadTlf(ref: TlfRef): Promise<TlfData> {
  const key = `${ref.table}@${ref.version ?? 'current'}|${(ref.keys ?? []).join(',')}|${ref.min_pct ?? ''}`;
  let p = tlfCache.get(key);
  if (!p) {
    p = (async () => {
      const [cols, version, fmt] = await Promise.all([
        sqlRows(
          `SELECT column_name, data_type, comment FROM ${CATALOG}.information_schema.columns
           WHERE table_schema = '${SCHEMA}' AND table_name = :t ORDER BY ordinal_position`,
          [{ name: 't', value: ref.table }],
        ),
        ref.version === null ? tableVersion(ref.table) : Promise.resolve(ref.version),
        loadFormats(),
      ]);
      const all = await sqlRows(`SELECT * FROM ${FQ}.${ref.table} VERSION AS OF ${version}`);
      const columns = cols.map((c) => ({
        name: c.column_name as string,
        comment: (c.comment as string) ?? '',
        numeric: NUMERIC.test((c.data_type as string) ?? '') && c.column_name !== 'row_order',
      }));
      const order = (r: Record<string, string | null>) => (r.row_order === undefined || r.row_order === null ? 0 : Number(r.row_order));
      all.sort((a, b) => order(a) - order(b));
      // A section sees a subset of the rows: a list of keys, or the preferred terms that reach min_pct in some arm.
      const rows = all.filter((r) => {
        const rk = r.row_key as string;
        if (ref.keys && !ref.keys.includes(rk)) return false;
        if (ref.min_pct !== undefined && rk.startsWith('pt_')) {
          return ['pbo_pct', 'low_pct', 'high_pct'].some((c) => Number(r[c] ?? 0) >= ref.min_pct!);
        }
        return true;
      });
      const slots: Slot[] = [];
      for (const r of rows) {
        const rk = r.row_key as string;
        for (const c of columns) {
          if (!c.numeric || r[c.name] === null || r[c.name] === undefined) continue;
          if (c.comment.includes('[no-slot]')) continue;
          const raw = r[c.name] as string;
          // A p value stored as 0.0 means below the printed limit; it is not a figure to quote, the instructions say p < 0.001.
          if (c.name === 'p_value' && Number(raw) === 0) continue;
          slots.push({
            name: `${ref.alias}_${rk.toLowerCase()}_${c.name}`.replace(/[^a-z0-9_]/g, '_'),
            description: `${(r.row_label as string) ?? rk}: ${c.comment || c.name} (${ref.tlf})`,
            value: formatCell(fmt, ref.table, rk, c.name, raw),
            source_table: ref.table,
            tlf: ref.tlf,
            row_key: rk,
            column_name: c.name,
            table_version: version,
          });
        }
      }
      return { ref, version, columns, rows, slots };
    })();
    tlfCache.set(key, p);
    p.catch(() => tlfCache.delete(key));
  }
  return p;
}

/** Study metadata: number-valued keys become placeholders meta_<key>, text values are context. */
export async function loadStudyMetadata(): Promise<{ text: Record<string, string>; slots: Slot[] }> {
  const rows = await sqlRows(`SELECT meta_key, meta_value, value_type FROM ${FQ}.study_metadata`);
  const text: Record<string, string> = {};
  const slots: Slot[] = [];
  for (const r of rows) {
    const k = r.meta_key as string;
    const v = (r.meta_value as string) ?? '';
    if (r.value_type === 'number') {
      slots.push({ name: `meta_${k}`, description: `study metadata: ${k.replace(/_/g, ' ')}`, value: v, source_table: 'study_metadata', tlf: 'Study metadata', row_key: k, column_name: 'meta_value', table_version: 0 });
    } else text[k] = v;
  }
  return { text, slots };
}

export interface Passage {
  doc_title: string;
  doc_part: string;
  file_path: string;
  page: number;
  element_id: number;
  quote: string;
}

const PLAIN = (t: string) => t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9.]{3,}/g) ?? []);

/** The parts of the parsed package the pod may read. The submitted report (csr_body, csr_tlf) is the answer key. */
export const SEARCHABLE_PARTS = ['protocol', 'sap'];
export const refuseAnswerKey = (docPart: string) => docPart.startsWith('csr_');

/**
 * AI Search (hybrid) over the protocol and SAP chunks. Each hit is a chunk of about 600 characters; the cited
 * element is the one inside the chunk that best matches the query. The index does not hold the submitted report and
 * the filter restricts retrieval to protocol and sap; any element of a csr_ part is refused here as well.
 */
export async function searchPassages(query: string, n = 4): Promise<Passage[]> {
  const out = await dbxFetch<{ result?: { data_array?: (string | number)[][] } }>(`/api/2.0/vector-search/indexes/${INDEX_NAME}/query`, {
    body: {
      query_text: query,
      columns: ['chunk_id', 'doc_part', 'page', 'element_ids', 'chunk_text'],
      num_results: n + 4,
      query_type: 'HYBRID',
      filters_json: JSON.stringify({ doc_part: SEARCHABLE_PARTS }),
    },
  });
  const hits = (out.result?.data_array ?? []).filter((h) => !refuseAnswerKey(String(h[1])));
  const found: Passage[] = [];
  const q = words(query);
  for (const h of hits) {
    if (found.length >= n) break;
    const ids = String(h[3]).split(',').map((x) => Number(x)).filter((x) => Number.isFinite(x));
    if (ids.length === 0) continue;
    const els = await sqlRows(
      `SELECT file_path, doc_title, doc_part, page, element_id, element_type, content FROM ${FQ}.doc_elements
       WHERE page = CAST(:p AS INT) AND element_id IN (${ids.join(',')}) ORDER BY element_id`,
      [{ name: 'p', value: String(h[2]) }],
    );
    let best: Record<string, string | null> | undefined;
    let bestScore = -1;
    for (const e of els) {
      if (refuseAnswerKey(e.doc_part as string)) continue;
      if (!['text', 'table', 'caption', 'section_header', 'footnote'].includes(e.element_type as string)) continue;
      const score = [...words(e.content as string)].filter((t) => q.has(t)).length;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best) continue;
    const quote = PLAIN(best.content as string);
    if (found.some((f) => f.element_id === Number(best!.element_id))) continue;
    found.push({
      doc_title: best.doc_title as string,
      doc_part: best.doc_part as string,
      file_path: best.file_path as string,
      page: Number(best.page),
      element_id: Number(best.element_id),
      quote: quote.length > 700 ? `${quote.slice(0, 700)}...` : quote,
    });
  }
  return found;
}

export const asSourceRef = (p: Passage): SourceRef => ({ kind: 'passage', doc_title: p.doc_title, doc_part: p.doc_part, file_path: p.file_path, page: p.page, element_id: p.element_id, quote: p.quote });

const BASE_ALLOWED = ['24', '26', '95'];

/** Numbers the model may write itself: those in the section's instructions, its cited passages and the TLF and section numbers. */
export function allowedNumbers(texts: string[]): Set<string> {
  const set = new Set(BASE_ALLOWED);
  for (const t of texts) for (const n of t.match(/\d+(?:\.\d+)*/g) ?? []) set.add(n);
  return set;
}

// Study identifiers are not figures: CDISCPILOT01, the protocol number H2Q-MC-LZZT(c) and subject ids such as 01-701-1015.
const IDS = /CDISCPILOT\d+|H2Q-MC-LZZT\(c\)|\b\d{2}-\d{3}-\d{4}\b/g;
// References are not figures either: "section 11.4.1", "Table 14.2.1", "Week 24", "Appendix 16.1.9".
const REFS = /\b(?:[Ss]ections?|Tables?|Figures?|Listings?|Appendix|Appendices|Module|Weeks?)\s+\d+(?:[.-]\d+)*(?:\s*(?:,|and|to|or)\s*\d+[.-]\d+(?:\.\d+)*)*/g;

export function bind(templates: string[], slots: Map<string, Slot>, allowed: Set<string>) {
  const unknown = new Set<string>();
  const typed = new Set<string>();
  let figures = 0;
  const bound = templates.map((template) => {
    const parts: Part[] = [];
    let last = 0;
    for (const m of template.matchAll(/\{(\w+)\}/g)) {
      const at = m.index ?? 0;
      if (at > last) parts.push({ text: template.slice(last, at) });
      const s = slots.get(m[1]);
      if (s) {
        parts.push({ slot: s.name, value: s.value, source_table: s.source_table, tlf: s.tlf, row_key: s.row_key, column_name: s.column_name, table_version: s.table_version });
        figures++;
      } else {
        unknown.add(m[1]);
        parts.push({ text: m[0] });
      }
      last = at + m[0].length;
    }
    if (last < template.length) parts.push({ text: template.slice(last) });
    const own = template.replace(/\{\w+\}/g, ' ').replace(IDS, ' ').replace(REFS, ' ');
    for (const n of own.match(/\d+(?:\.\d+)*/g) ?? []) if (!allowed.has(n)) typed.add(n);
    return { template, parts };
  });
  return { bound, figures, unknown: [...unknown], typed: [...typed] };
}
