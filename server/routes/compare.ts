import type { Application, Request, Response } from 'express';
import { VOLUME_PAGES, FQ, dbxFetchRaw, releaseOf, sqlRows } from '../lib/dbx';
import { imageGet, imagePut, memo, teaeState } from '../lib/cache';
import { columnLabel, rowLabels, rowPhrase } from '../lib/labels';
import { latestDoneRunId, loadDocument } from '../lib/pod/run';
import type { CsrDocument } from '../lib/pod/run';
import { loadScores, submittedText, tickSection } from '../lib/pod/score';

/*
 * GET /api/compare?run_id=&section=  (defaults: the latest done run, section 11.4.1)
 * The drafted section on one side, the submitted CSR on the other: the parsed pages of the submitted section and of
 * the printed tables, a tick per drafted figure against its printed cell, and the wording score.
 * GET /api/page-image?path=  serves a page image from volume parsed_pages.
 *
 * Latency: the assembled answer is cached per run, section and the state of Table 14-5.01 (see lib/cache.ts) and is
 * warmed at server start (warmCompare). Page images are immutable (the file name is a content hash).
 */

const RUN_ID = /^csr-[\w-]{6,40}$/;

async function buildCompare(runId: string, section: string, doc: CsrDocument, releases: Map<number, number>) {
  const sec = doc.sections.find((s) => s.section === section);
  if (!sec) return null;
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
  const [pages, scores, text, labels] = await Promise.all([
    ordered.length
      ? sqlRows(
          `SELECT p.page, p.image_path, p.width, p.height FROM ${FQ}.doc_pages p WHERE p.page IN (${ordered.map((n) => Math.trunc(n)).join(',')})`,
        ).then(async (pg) => {
          const els = await sqlRows(
            `SELECT page, element_id, element_type, x0, y0, x1, y1, content FROM ${FQ}.doc_elements
             WHERE page IN (${ordered.map((n) => Math.trunc(n)).join(',')}) AND element_type NOT IN ('page_header','page_footer','page_number') ORDER BY page, element_id`,
          );
          return ordered.map((page) => {
            const meta = pg.find((x) => Number(x.page) === page);
            return {
              page,
              image_path: (meta?.image_path as string) ?? '',
              width: Number(meta?.width ?? 0),
              height: Number(meta?.height ?? 0),
              elements: els
                .filter((e) => Number(e.page) === page)
                .map((e) => ({
                  element_id: Number(e.element_id),
                  element_type: e.element_type as string,
                  x0: Number(e.x0),
                  y0: Number(e.y0),
                  x1: Number(e.x1),
                  y1: Number(e.y1),
                  content: (e.content as string) ?? '',
                })),
            };
          });
        })
      : Promise.resolve([]),
    loadScores(runId),
    submittedText(section),
    Promise.all([...new Set(ticks.map((t) => t.tlf))].map(async (t) => [t, await rowLabels(t)] as const)).then((e) => new Map(e)),
  ]);
  const score = scores.find((x) => x.section === section);
  return {
    run_id: runId,
    section,
    drafted: sec.sentences,
    submitted: { pages, text },
    ticks: ticks.map((t) => ({
      // The engine numbers sentences from 1; the contract indexes `drafted` from 0.
      sentence_idx: t.sentence_idx - 1,
      slot: t.slot,
      drafted_value: t.drafted_value,
      tlf: t.tlf,
      row_key: t.row_key,
      column_name: t.column_name,
      table_version: releaseOf(t.tlf, t.table_version, releases),
      printed_value: t.printed_value,
      printed_page: t.printed_page,
      printed_element_id: t.printed_element_id,
      row_label: rowPhrase(labels.get(t.tlf)?.get(t.row_key) ?? t.row_key),
      column_label: columnLabel(t.column_name),
      printed_row_idx: t.printed_row_idx,
      printed_row_count: t.printed_row_count,
      printed_col_idx: t.printed_col_idx,
      printed_col_count: t.printed_col_count,
      printed_box: t.printed_box,
      match: t.match,
    })),
    wording: {
      coverage_score: score?.coverage_score ?? null,
      notes: score?.coverage_notes ?? '',
      left_for_person: score?.left_for_person ?? [],
    },
  };
}

type CompareBody = NonNullable<Awaited<ReturnType<typeof buildCompare>>>;

/** One cached answer. A run that is still running is never cached; a run without the section answers null. */
async function compareFor(runId: string, section: string, doc?: CsrDocument | null): Promise<CompareBody | null> {
  const st = await teaeState();
  const cached = memo<{ body: CompareBody | null; final: boolean }>(
    'compare',
    `${runId}|${section}|${st.key}`,
    async () => {
      const d = doc ?? (await loadDocument(runId));
      if (!d) return { body: null, final: false };
      return { body: await buildCompare(runId, section, d, st.releases), final: d.status !== 'running' };
    },
    (v) => v.final && v.body !== null,
  );
  return (await cached).body;
}

/** Warm the cache for the latest done run: every drafted section, then the page images they show. */
export async function warmCompare(): Promise<void> {
  const runId = await latestDoneRunId();
  if (!runId) return;
  const doc = await loadDocument(runId);
  if (!doc) return;
  const drafted = doc.sections.filter((s) => s.kind === 'drafted');
  const bodies = await Promise.all(drafted.map((s) => compareFor(runId, s.section, doc).catch(() => null)));
  const paths = new Set<string>();
  for (const b of bodies) for (const p of b?.submitted.pages ?? []) if (p.image_path) paths.add(p.image_path);
  await Promise.all([...paths].map((p) => loadImage(p).catch(() => null)));
}

async function loadImage(path: string): Promise<Buffer | null> {
  const hit = imageGet(path);
  if (hit) return hit;
  const r = await dbxFetchRaw(`/api/2.0/fs/files${path}`);
  if (!r.ok) throw Object.assign(new Error(`page image not available (${r.status})`), { status: r.status });
  const b = Buffer.from(await r.arrayBuffer());
  imagePut(path, b);
  return b;
}

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
      const body = await compareFor(runId, section);
      if (!body) {
        res.status(404).json({ error: `run ${runId} has no section ${section}` });
        return;
      }
      res.json(body);
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
      const img = await loadImage(path);
      res.setHeader('Content-Type', 'image/jpeg');
      // File names are content hashes, so an image never changes.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(img);
    } catch (e) {
      const status = (e as { status?: number }).status;
      res.status(status === 404 ? 404 : status ? 502 : 500).json({ error: (e as Error).message });
    }
  });
}
