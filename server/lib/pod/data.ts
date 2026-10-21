import { CATALOG, FQ, SCHEMA, sqlRows } from '../dbx';

/*
 * The data side of the CSR Pod: the section registry (the company template as a table), the certified
 * TLF tables turned into placeholders, the parsed passages, and the binding of placeholders to cells.
 * Nothing here calls a model.
 */

export type Kind = 'assembled' | 'boilerplate' | 'drafted' | 'narrative';
export type AgentId = 'context' | 'planner' | 'author' | 'narrative' | 'qc' | 'assembler' | 'signoff';

export interface TlfRef {
  table: string;
  tlf: string;
  alias: string;
  version: number | null;
}
export interface PassageHint {
  doc: string;
  like: string;
  page?: number;
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
  source_passages: PassageHint[];
  tlf_tables: TlfRef[];
  depends_on: string[];
  required_content: string[];
}

export type SourceRef =
  | { kind: 'passage'; doc_title: string; file_path: string; page: number; element_id: number; quote: string }
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
    source_passages: parseJson<PassageHint[]>(r.source_passages, []),
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
    const tlf = comment.match(/Table 14\.\d+\.\d+/)?.[0] ?? (r.table_name === 'efficacy_primary' ? 'Table 14.2.1' : r.table_name === 'safety_overview' ? 'Table 14.3.1' : '');
    return { table: r.table_name as string, tlf, comment };
  });
}

const NUMERIC = /^(INT|INTEGER|BIGINT|LONG|SMALLINT|TINYINT|DOUBLE|FLOAT|DECIMAL.*)$/i;
// The 2 tables from the first demo store unrounded doubles; the new TLF tables are stored at display precision.
const LEGACY_ONE_DECIMAL = new Set(['efficacy_primary', 'safety_overview']);

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
}

async function tableVersion(table: string): Promise<number> {
  const r = await sqlRows(`SELECT CAST(MAX(version) AS INT) AS v FROM (DESCRIBE HISTORY ${FQ}.${table})`);
  return Number(r[0]?.v ?? 0);
}

/** A certified table at the version the run is drafted against, turned into one placeholder per (row, numeric column). */
export function loadTlf(ref: TlfRef): Promise<TlfData> {
  const key = `${ref.table}@${ref.version ?? 'current'}`;
  let p = tlfCache.get(key);
  if (!p) {
    p = (async () => {
      const [cols, version] = await Promise.all([
        sqlRows(
          `SELECT column_name, data_type, comment FROM ${CATALOG}.information_schema.columns
           WHERE table_schema = '${SCHEMA}' AND table_name = :t ORDER BY ordinal_position`,
          [{ name: 't', value: ref.table }],
        ),
        ref.version === null ? tableVersion(ref.table) : Promise.resolve(ref.version),
      ]);
      const rows = await sqlRows(`SELECT * FROM ${FQ}.${ref.table} VERSION AS OF ${version}`);
      const columns = cols.map((c) => ({
        name: c.column_name as string,
        comment: (c.comment as string) ?? '',
        numeric: NUMERIC.test((c.data_type as string) ?? '') && c.column_name !== 'row_order',
      }));
      const order = (r: Record<string, string | null>) => (r.row_order === undefined || r.row_order === null ? 0 : Number(r.row_order));
      rows.sort((a, b) => order(a) - order(b));
      const slots: Slot[] = [];
      for (const r of rows) {
        const rk = r.row_key as string;
        for (const c of columns) {
          if (!c.numeric || r[c.name] === null || r[c.name] === undefined) continue;
          const raw = r[c.name] as string;
          const isDouble = /\./.test(raw) || /DOUBLE|FLOAT|DECIMAL/i.test(c.name);
          // A p value stored as 0.0 means below 0.001; it is not a figure to quote, the instructions say p < 0.001.
          if (c.name === 'p_value' && Number(raw) === 0) continue;
          let value = LEGACY_ONE_DECIMAL.has(ref.table) && isDouble ? Number(raw).toFixed(1) : raw;
          // Counts in mixed DOUBLE columns (demographics, exposure) are stored as 362.0; show them as counts.
          if (!LEGACY_ONE_DECIMAL.has(ref.table) && /\.0$/.test(value) && !/pct|rate/.test(c.name) && !/MEAN|SD/.test(rk)) value = value.slice(0, -2);
          slots.push({
            name: `${ref.alias}_${rk.toLowerCase()}_${c.name}`.replace(/[^a-z0-9_]/g, '_'),
            description: `${(r.row_label as string) ?? rk}: ${c.comment || c.name} (${ref.tlf})`,
            value,
            source_table: ref.table,
            tlf: ref.tlf,
            row_key: rk,
            column_name: c.name,
            table_version: version,
          });
        }
      }
      // safety_overview stores counts only; the percentages of n are derived cells used in the first demo.
      if (ref.table === 'safety_overview') {
        for (const r of rows) {
          const n = Number(r.n);
          for (const col of ['any_teae', 'serious_ae', 'ae_discontinuation', 'deaths']) {
            if (!n || r[col] === null) continue;
            slots.push({
              name: `${ref.alias}_${(r.row_key as string).toLowerCase()}_${col}_pct`,
              description: `${r.arm as string}: ${col.replace(/_/g, ' ')} as a percentage of n (${ref.tlf})`,
              value: ((100 * Number(r[col])) / n).toFixed(1),
              source_table: ref.table,
              tlf: ref.tlf,
              row_key: r.row_key as string,
              column_name: col,
              table_version: version,
            });
          }
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

/** A passage hint from the registry, resolved to its element in the ai_parse_document layout. */
export async function resolvePassage(h: PassageHint): Promise<SourceRef | null> {
  const r = (
    await sqlRows(
      `SELECT file_path, doc_title, page, element_id, content FROM ${FQ}.doc_elements
       WHERE file_path LIKE :doc AND content LIKE :like ORDER BY page, element_id LIMIT 1`,
      [
        { name: 'doc', value: h.doc },
        { name: 'like', value: h.like },
      ],
    )
  )[0];
  if (!r) return null;
  return {
    kind: 'passage',
    doc_title: r.doc_title as string,
    file_path: r.file_path as string,
    page: Number(r.page),
    element_id: Number(r.element_id),
    quote: (r.content as string).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  };
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9.]{3,}/g) ?? []);

/** An AI Search hit is a page chunk; cite the element on that page that best matches the query. */
export async function bestElement(filePath: string, page: number, query: string, docTitle: string): Promise<SourceRef | null> {
  const els = await sqlRows(
    `SELECT element_id, element_type, content FROM ${FQ}.doc_elements WHERE file_path = :f AND page = CAST(:p AS INT) ORDER BY element_id`,
    [
      { name: 'f', value: filePath },
      { name: 'p', value: String(page) },
    ],
  );
  const q = words(query);
  let best: Record<string, string | null> | undefined;
  let bestScore = -1;
  for (const e of els) {
    if (!['text', 'table', 'caption', 'section_header'].includes(e.element_type as string)) continue;
    const score = [...words(e.content as string)].filter((t) => q.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  if (!best) return null;
  return {
    kind: 'passage',
    doc_title: docTitle,
    file_path: filePath,
    page,
    element_id: Number(best.element_id),
    quote: (best.content as string).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  };
}

const BASE_ALLOWED = ['52', '95', '400', '4471', '301'];

/** Numbers the model may write itself: those in the section's instructions, its cited passages and the TLF and section numbers. */
export function allowedNumbers(texts: string[]): Set<string> {
  const set = new Set(BASE_ALLOWED);
  for (const t of texts) for (const n of t.match(/\d+(?:\.\d+)*/g) ?? []) set.add(n);
  return set;
}

// Study identifiers are not figures: LMN-4471, LMN-301 and participant ids such as LMN301-1001-003.
const IDS = /LMN\d*(?:-\d+)+/g;
// References are not figures either: "section 11.4.1", "Table 14.2.1", "Week 24", "Appendix 16.1.9".
const REFS = /\b(?:[Ss]ections?|Tables?|Figures?|Listings?|Appendix|Appendices|Module|Weeks?)\s+\d+(?:\.\d+)*(?:\s*(?:,|and|to|or)\s*\d+\.\d+(?:\.\d+)*)*/g;

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
