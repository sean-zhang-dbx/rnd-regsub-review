import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Application, Request, Response } from 'express';
import { FQ, recordTeaeRelease, releaseOf, sqlRows, tableVersion, teaeReleases } from '../lib/dbx';
import { clearTlfCache } from '../lib/pod/data';
import { activeRunId, latestDoneRunId, loadDocument, startRun } from '../lib/pod/run';

/*
 * POST /api/redeliver  body { table: 'tlf_14_5_01_teae' }
 * Biostatistics re-delivers Table 14-5.01 with the corrected derivation (version 2: treatment-emergent events only,
 * ADAE.TRTEMFL = 'Y'). Runs config/redeliver_14_5_01.sql on the warehouse (the data is unchanged; one new Delta version),
 * finds the sentences of the latest run that quote cells whose value changed, and starts a redraft run for those sections.
 * Demo scenario: scripts/reset_demo.py restores the table to its first state.
 */

const TABLE = 'tlf_14_5_01_teae';
const COLS = ['pbo_n', 'pbo_pct', 'low_n', 'low_pct', 'high_n', 'high_pct'];

export function registerRedeliver(app: Application) {
  app.post('/api/redeliver', async (req: Request, res: Response) => {
    const table = (req.body as { table?: unknown })?.table;
    if (table !== TABLE) {
      res.status(400).json({ error: `table must be ${TABLE}` });
      return;
    }
    if (activeRunId()) {
      res.status(409).json({ error: `run ${activeRunId()} is still running`, run_id: activeRunId() });
      return;
    }
    try {
      const baseRun = await latestDoneRunId();
      if (!baseRun) {
        res.status(409).json({ error: 'there is no finished run to redraft from' });
        return;
      }
      const old_delta_version = await tableVersion(TABLE);
      const old_version = releaseOf(TABLE, old_delta_version, await teaeReleases());
      const sql = (await readFile(resolve(process.cwd(), 'config', 'redeliver_14_5_01.sql'), 'utf8')).trim().replace(/;\s*$/, '');
      await sqlRows(sql);
      clearTlfCache();
      const new_delta_version = await tableVersion(TABLE);
      await recordTeaeRelease(new_delta_version, 2);
      const new_version = 2;
      const diff = await sqlRows(
        `SELECT sum(${COLS.map((c) => `CASE WHEN o.${c} IS DISTINCT FROM n.${c} THEN 1 ELSE 0 END`).join(' + ')}) AS changed
         FROM ${FQ}.${TABLE} VERSION AS OF ${old_delta_version} o FULL OUTER JOIN ${FQ}.${TABLE} VERSION AS OF ${new_delta_version} n ON o.row_key = n.row_key`,
      );
      const doc = await loadDocument(baseRun);
      const affected = (doc?.redelivery ?? [])
        .filter((r) => r.table === TABLE)
        .map((r) => ({ section: r.section, sentence_idx: r.sentence_idx, slot: r.slot, old_value: r.old_value, new_value: r.new_value }));
      const sections = [...new Set(affected.map((a) => a.section))];
      const run_id = sections.length ? startRun(sections) : null;
      res.json({ old_version, new_version, old_delta_version, new_delta_version, changed_cells: Number(diff[0]?.changed ?? 0), affected, run_id });
    } catch (e) {
      console.error('[redeliver]', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
