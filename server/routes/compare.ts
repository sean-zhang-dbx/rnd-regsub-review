import type { Application, Request, Response } from 'express';
import { VOLUME_PAGES, FQ, dbxFetchRaw, sqlRows } from '../lib/dbx';
import { latestDoneRunId, loadDocument } from '../lib/pod/run';
import { loadScores, submittedText, tickSection } from '../lib/pod/score';

/*
 * GET /api/compare?run_id=&section=  (defaults: the latest done run, section 11.4.1)
 * The drafted section on one side, the submitted CSR on the other: the parsed pages of the submitted section and of
 * the printed tables, a tick per drafted figure against its printed cell, and the wording score.
 * GET /api/page-image?path=  serves a page image from volume parsed_pages.
 */

const RUN_ID = /^csr-[\w-]{6,40}$/;

export function registerCompare(app: Application) {
  app.get('/api/compare', async (req: Request, res: Response) => {
    try {
      const requested = typeof req.query.run_id === 'string' ? req.query.run_id : '';
      if (requested && !RUN_ID.test(requested)) {
        res.status(400).json({ error: 'bad run id' });
        return;
      }
      const section = typeof req.query.section === 'string' && /^[\d.]{1,8}$/.test(req.query.section) ? req.query.section : '11.4.1';
      const runId = requested || (await latestDoneRunId());
      if (!runId) {
        res.status(404).json({ error: 'there is no finished run yet' });
        return;
      }
      const doc = await loadDocument(runId);
      const sec = doc?.sections.find((s) => s.section === section);
      if (!doc || !sec) {
        res.status(404).json({ error: `run ${runId} has no section ${section}` });
        return;
      }
      const { ticks } = await tickSection(sec);
      const range = await sqlRows(
        `SELECT min(page_from) AS a, max(page_to) AS b FROM ${FQ}.submitted_csr_sections WHERE section = :s OR section LIKE concat(:s, '.%')`,
        [{ name: 's', value: section }],
      );
      const from = Number(range[0]?.a ?? 0);
      const to = Number(range[0]?.b ?? 0);
      const pageNos = new Set<number>();
      if (from > 0) for (let p = from; p <= to; p++) pageNos.add(p);
      for (const t of ticks) pageNos.add(t.printed_page);
      const ordered = [...pageNos].sort((a, b) => a - b);
      const pages = ordered.length
        ? await Promise.all(
            ordered.map(async (page) => {
              const [pg, els] = await Promise.all([
                sqlRows(`SELECT image_path, width, height FROM ${FQ}.doc_pages WHERE page = CAST(:p AS INT)`, [{ name: 'p', value: String(page) }]),
                sqlRows(
                  `SELECT element_id, element_type, x0, y0, x1, y1, content FROM ${FQ}.doc_elements
                   WHERE page = CAST(:p AS INT) AND element_type NOT IN ('page_header','page_footer','page_number') ORDER BY element_id`,
                  [{ name: 'p', value: String(page) }],
                ),
              ]);
              return {
                page,
                image_path: (pg[0]?.image_path as string) ?? '',
                width: Number(pg[0]?.width ?? 0),
                height: Number(pg[0]?.height ?? 0),
                elements: els.map((e) => ({
                  element_id: Number(e.element_id),
                  element_type: e.element_type as string,
                  x0: Number(e.x0),
                  y0: Number(e.y0),
                  x1: Number(e.x1),
                  y1: Number(e.y1),
                  content: (e.content as string) ?? '',
                })),
              };
            }),
          )
        : [];
      const score = (await loadScores(runId)).find((s) => s.section === section);
      res.json({
        run_id: runId,
        section,
        drafted: sec.sentences,
        submitted: { pages, text: await submittedText(section) },
        ticks: ticks.map((t) => ({
          sentence_idx: t.sentence_idx,
          slot: t.slot,
          drafted_value: t.drafted_value,
          tlf: t.tlf,
          row_key: t.row_key,
          column_name: t.column_name,
          table_version: t.table_version,
          printed_value: t.printed_value,
          printed_page: t.printed_page,
          printed_element_id: t.printed_element_id,
          match: t.match,
        })),
        wording: {
          coverage_score: score?.coverage_score ?? null,
          notes: score?.coverage_notes ?? '',
          left_for_person: score?.left_for_person ?? [],
        },
      });
    } catch (e) {
      console.error('[compare]', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/page-image', async (req: Request, res: Response) => {
    const path = typeof req.query.path === 'string' ? req.query.path : '';
    if (!path.startsWith(VOLUME_PAGES) || !/^[\w./-]+\.jpg$/.test(path) || path.includes('..')) {
      res.status(400).json({ error: 'path must be a page image in volume parsed_pages' });
      return;
    }
    try {
      const r = await dbxFetchRaw(`/api/2.0/fs/files${path}`);
      if (!r.ok) {
        res.status(r.status === 404 ? 404 : 502).json({ error: `page image not available (${r.status})` });
        return;
      }
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
