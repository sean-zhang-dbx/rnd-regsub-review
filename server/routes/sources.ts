import type { Application, Request, Response } from 'express';
import { CATALOG, FQ, INDEX_NAME, SCHEMA, sqlRows, tableVersion } from '../lib/dbx';

/*
 * GET /api/sources: what the pod draws from. The ADaM tables (rows, columns, checksum recorded at load), the
 * certified TLF tables with their Delta version and upstream tables from lineage, and the parsed CSR package with
 * the page range of every doc_part and whether the pod may search it. The submitted report parts are locked.
 */

const ADAM = ['adam_adsl', 'adam_adae', 'adam_adqsadas', 'adam_adqscibc', 'adam_adtte'];
const EXPECTED_ROWS: Record<string, number> = { adam_adsl: 254, adam_adae: 1191, adam_adqsadas: 12463, adam_adqscibc: 730, adam_adtte: 254 };
// Used when the lineage system table is not readable by the app identity.
const STATIC_UPSTREAMS: Record<string, string[]> = {
  tlf_14_1_01_populations: ['adam_adsl'], tlf_14_1_02_disposition: ['adam_adsl'], tlf_14_2_01_demographics: ['adam_adsl'],
  tlf_14_3_01_adascog_w24: ['adam_adsl', 'adam_adqsadas'], tlf_14_3_02_cibic_w24: ['adam_adsl', 'adam_adqscibc'],
  tlf_14_4_01_exposure: ['adam_adsl'], tlf_14_5_01_teae: ['adam_adsl', 'adam_adae'], tlf_14_5_02_sae: ['adam_adsl', 'adam_adae'],
};

export function registerSources(app: Application) {
  app.get('/api/sources', async (_req: Request, res: Response) => {
    try {
      const [adam, tlfRows, parts, chunks, pages, lineage] = await Promise.all([
        Promise.all(
          ADAM.map(async (table) => {
            const [n, cols, props] = await Promise.all([
              sqlRows(`SELECT count(*) AS n FROM ${FQ}.${table}`),
              sqlRows(`SELECT count(*) AS n FROM ${CATALOG}.information_schema.columns WHERE table_schema = '${SCHEMA}' AND table_name = '${table}'`),
              sqlRows(`SHOW TBLPROPERTIES ${FQ}.${table}`),
            ]);
            const prop = (k: string) => props.find((p) => p.key === k)?.value ?? null;
            const rows = Number(n[0]?.n ?? 0);
            return { table, rows, columns: Number(cols[0]?.n ?? 0), checksum: prop('content_checksum'), xpt_sha256: prop('xpt_sha256'), checksum_ok: !!prop('content_checksum') && !!prop('xpt_sha256') && rows === EXPECTED_ROWS[table] };
          }),
        ),
        sqlRows(
          `SELECT t.table_name, t.comment FROM ${CATALOG}.information_schema.tables t
           LEFT JOIN ${CATALOG}.information_schema.table_tags g ON g.schema_name = t.table_schema AND g.table_name = t.table_name AND g.tag_name = 'system.certification_status'
           WHERE t.table_schema = '${SCHEMA}' AND t.table_name LIKE 'tlf\\_14\\_%' ORDER BY t.table_name`,
        ),
        sqlRows(`SELECT doc_part, min(page) AS page_from, max(page) AS page_to, count(*) AS elements FROM ${FQ}.doc_elements GROUP BY doc_part ORDER BY min(page)`),
        sqlRows(`SELECT count(*) AS n FROM ${FQ}.doc_chunks`),
        sqlRows(`SELECT count(*) AS n FROM ${FQ}.doc_pages`),
        sqlRows(
          `SELECT DISTINCT source_table_name AS src, target_table_name AS tgt FROM system.access.table_lineage
           WHERE target_table_catalog = '${CATALOG}' AND target_table_schema = '${SCHEMA}' AND source_table_schema = '${SCHEMA}' AND source_table_name LIKE 'adam\\_%'`,
        ).catch(() => []),
      ]);
      const certTags = await sqlRows(
        `SELECT table_name, tag_value FROM ${CATALOG}.information_schema.table_tags WHERE schema_name = '${SCHEMA}' AND tag_name = 'system.certification_status'`,
      ).catch(() => []);
      const certified = new Set(certTags.filter((t) => t.tag_value === 'certified').map((t) => t.table_name as string));
      const tlfs = await Promise.all(
        tlfRows
          .filter((t) => !(t.table_name as string).includes('check'))
          .map(async (t) => {
            const table = t.table_name as string;
            const fromLineage = lineage.filter((l) => l.tgt === table).map((l) => l.src as string);
            return {
              table,
              tlf: (((t.comment as string) ?? '').match(/Table (14-\d\.\d+)/) ?? [])[1] ?? '',
              version: await tableVersion(table),
              certified: certified.has(table),
              upstreams: fromLineage.length ? fromLineage : (STATIC_UPSTREAMS[table] ?? []),
            };
          }),
      );
      res.json({
        adam,
        tlfs,
        docs: {
          file: 'cdiscpilot01.pdf',
          pages: Number(pages[0]?.n ?? 0),
          parts: parts.map((p) => ({
            doc_part: p.doc_part,
            page_from: Number(p.page_from),
            page_to: Number(p.page_to),
            elements: Number(p.elements),
            // csr_body and csr_tlf are the answer key: parsed, never indexed, locked for the pod.
            searchable: !String(p.doc_part).startsWith('csr_') && ['protocol', 'sap'].includes(String(p.doc_part)),
          })),
        },
        index: { name: INDEX_NAME, chunks: Number(chunks[0]?.n ?? 0) },
      });
    } catch (e) {
      console.error('[sources]', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
