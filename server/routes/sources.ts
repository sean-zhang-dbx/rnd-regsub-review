import type { Application, Request, Response } from 'express';
import { CATALOG, dbxFetch, FQ, SCHEMA, sqlRows } from '../lib/dbx';
import { SOURCE_VERSION } from './draftSection';

/*
 * Sources of one CSR section, structured and unstructured. Structured: the certified table behind the
 * figures (figure_citations), its tags and its upstream tables from Unity Catalog lineage. Unstructured:
 * the parsed protocol and SAP passages each sentence draws on (source_citations joined to doc_elements).
 * Also the outputs a sentence cites that are not in this demo, and wording that is the writer's.
 */

const SECTION = '11.4.1';

interface LineageResponse {
  upstreams?: { tableInfo?: { name?: string; catalog_name?: string; schema_name?: string } }[];
}

async function upstreamsOf(table: string): Promise<string[]> {
  try {
    const r = await dbxFetch<LineageResponse>(
      `/api/2.0/lineage-tracking/table-lineage?table_name=${encodeURIComponent(`${FQ}.${table}`)}&include_entity_lineage=false`,
    );
    return (r.upstreams ?? [])
      .map((u) => u.tableInfo)
      .filter((t) => t?.catalog_name === CATALOG && t.schema_name === SCHEMA && t.name)
      .map((t) => t!.name as string)
      .sort();
  } catch {
    return [];
  }
}

export function registerSources(app: Application) {
  app.get('/api/sources', async (_req: Request, res: Response) => {
    try {
      const sp = [{ name: 's', value: SECTION }];
      const [sentences, figures, cites, tags, comment, lineage] = await Promise.all([
        sqlRows(
          `SELECT sentence_id, seq, section_title, text_v_prev AS text FROM ${FQ}.document_sentences
           WHERE doc_type = 'csr' AND section = :s ORDER BY seq`,
          sp,
        ),
        sqlRows(
          `SELECT f.sentence_id, f.source_table, f.row_key, f.column_name, f.value_text, f.table_version, f.certified_by
           FROM ${FQ}.figure_citations f JOIN ${FQ}.document_sentences d ON d.sentence_id = f.sentence_id
           WHERE d.doc_type = 'csr' AND d.section = :s ORDER BY f.citation_id`,
          sp,
        ),
        sqlRows(
          `SELECT c.sentence_id, c.kind, c.ref, c.page, c.element_id, c.quote, c.supplies,
                  e.doc_title, e.element_type, e.confidence, e.content
           FROM ${FQ}.source_citations c
           LEFT JOIN ${FQ}.doc_elements e ON e.file_path = c.ref AND e.page = c.page AND e.element_id = c.element_id
           WHERE c.sentence_id LIKE concat('csr-', :s, '-%') ORDER BY c.sentence_id, c.kind`,
          sp,
        ),
        sqlRows(
          `SELECT tag_name, tag_value FROM ${CATALOG}.information_schema.table_tags
           WHERE schema_name = '${SCHEMA}' AND table_name = 'efficacy_primary' ORDER BY tag_name`,
        ),
        sqlRows(
          `SELECT comment FROM ${CATALOG}.information_schema.tables
           WHERE table_schema = '${SCHEMA}' AND table_name = 'efficacy_primary'`,
        ),
        upstreamsOf('efficacy_primary'),
      ]);

      const counts = await Promise.all(
        lineage.map(async (t) => {
          const [n, cols] = await Promise.all([
            sqlRows(`SELECT count(*) AS n FROM ${FQ}.${t}`),
            sqlRows(
              `SELECT comment FROM ${CATALOG}.information_schema.tables WHERE table_schema = '${SCHEMA}' AND table_name = :t`,
              [{ name: 't', value: t }],
            ),
          ]);
          return { name: t, rows: Number(n[0]?.n ?? 0), comment: cols[0]?.comment ?? '' };
        }),
      );

      const cells = new Map<string, { row_key: string; column_name: string; value: string }>();
      for (const f of figures) cells.set(`${f.row_key}.${f.column_name}`, { row_key: f.row_key ?? '', column_name: f.column_name ?? '', value: f.value_text ?? '' });

      res.json({
        section: SECTION,
        section_title: sentences[0]?.section_title ?? '',
        version: SOURCE_VERSION,
        table: {
          name: 'efficacy_primary',
          fq: `${FQ}.efficacy_primary`,
          tlf: 'Table 14.2.1',
          comment: comment[0]?.comment ?? '',
          certified_by: figures[0]?.certified_by ?? 'Biostatistics',
          tags: tags.map((t) => ({ name: t.tag_name ?? '', value: t.tag_value ?? '' })),
          cells: [...cells.values()],
          upstream: counts,
        },
        sentences: sentences.map((s) => {
          const own = figures.filter((f) => f.sentence_id === s.sentence_id);
          return {
            sentence_id: s.sentence_id,
            seq: Number(s.seq),
            text: s.text ?? '',
            figures: own.map((f) => ({ row_key: f.row_key ?? '', column_name: f.column_name ?? '', value: f.value_text ?? '' })),
            sources: cites
              .filter((c) => c.sentence_id === s.sentence_id)
              .map((c) => ({
                kind: c.kind as 'document' | 'output' | 'writer',
                ref: c.ref ?? '',
                page: c.page === null ? null : Number(c.page),
                element_id: c.element_id === null ? null : Number(c.element_id),
                quote: c.quote ?? '',
                supplies: c.supplies ?? '',
                doc_title: c.doc_title ?? '',
                element_type: c.element_type ?? '',
                confidence: c.confidence === null ? null : Number(c.confidence),
                content: c.content ?? '',
              })),
          };
        }),
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
