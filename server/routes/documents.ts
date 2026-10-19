import type { Application, Request, Response } from 'express';
import { FQ, sqlRows } from '../lib/dbx';

/*
 * Document parsing view. Reads the layout that scripts/parse_elements.py stored from ai_parse_document
 * (version 2.0): doc_pages (page images in volume parsed_pages) and doc_elements (typed elements with
 * bounding boxes, confidence, text, HTML for tables, and descriptions and extracted values for figures).
 */
export function registerDocuments(app: Application) {
  app.get('/api/documents', async (_req: Request, res: Response) => {
    try {
      const rows = await sqlRows(
        `SELECT p.file_path, p.doc_title, p.pages, coalesce(e.elements, 0) AS elements
         FROM (SELECT file_path, doc_title, count(*) AS pages FROM ${FQ}.doc_pages GROUP BY file_path, doc_title) p
         LEFT JOIN (SELECT file_path, count(*) AS elements FROM ${FQ}.doc_elements GROUP BY file_path) e ON e.file_path = p.file_path
         ORDER BY p.doc_title`,
      );
      res.json(rows.map((r) => ({ file_path: r.file_path, doc_title: r.doc_title, pages: Number(r.pages), elements: Number(r.elements) })));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/documents/page', async (req: Request, res: Response) => {
    const file = typeof req.query.file === 'string' ? req.query.file : '';
    const page = Number(typeof req.query.page === 'string' ? req.query.page : '1');
    if (!file.startsWith('/Volumes/sean_zhang_catalog/rnd_regsub_review/source_docs/') || !Number.isInteger(page) || page < 1) {
      res.status(400).json({ error: 'file must be a source document and page a positive integer' });
      return;
    }
    try {
      const params = [
        { name: 'f', value: file },
        { name: 'p', value: String(page) },
      ];
      const [pg, count, els] = await Promise.all([
        sqlRows(`SELECT doc_title, image_path, width, height FROM ${FQ}.doc_pages WHERE file_path = :f AND page = CAST(:p AS INT)`, params),
        sqlRows(`SELECT count(*) AS n FROM ${FQ}.doc_pages WHERE file_path = :f`, [params[0]]),
        sqlRows(
          `SELECT element_id, element_type, confidence, content, description, x0, y0, x1, y1
           FROM ${FQ}.doc_elements WHERE file_path = :f AND page = CAST(:p AS INT) ORDER BY element_id`,
          params,
        ),
      ]);
      if (!pg[0]) {
        res.status(404).json({ error: `no page ${page} in ${file}` });
        return;
      }
      res.json({
        file_path: file,
        doc_title: pg[0].doc_title,
        page,
        pages: Number(count[0]?.n ?? 0),
        image_path: pg[0].image_path,
        width: Number(pg[0].width),
        height: Number(pg[0].height),
        elements: els.map((e) => ({
          element_id: Number(e.element_id),
          element_type: e.element_type,
          confidence: Number(e.confidence),
          content: e.content ?? '',
          description: e.description ?? '',
          x0: Number(e.x0),
          y0: Number(e.y0),
          x1: Number(e.x1),
          y1: Number(e.y1),
        })),
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
