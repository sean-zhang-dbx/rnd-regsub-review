import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Application, Request, Response } from 'express';
import { FQ, recordTeaeRelease, releaseOf, sqlRows, tableVersion, teaeReleases } from '../lib/dbx';
import { teaeStateNow } from '../lib/cache';
import { columnLabel, columnUnit, rowLabels, rowPhrase } from '../lib/labels';
import { clearTlfCache } from '../lib/pod/data';
import { activeRunId, latestDoneRunId, loadDocument, runStatus, startRun } from '../lib/pod/run';
import { warmAll } from '../lib/warm';

/*
 * POST /api/redeliver  body { table: 'tlf_14_5_01_teae' }
 * Biostatistics re-delivers Table 14-5.01 with the corrected derivation (version 2: treatment-emergent events only,
 * ADAE.TRTEMFL = 'Y'). Runs config/redeliver_14_5_01.sql on the warehouse (the data is unchanged; one new Delta version),
 * finds the sentences of the latest run that quote cells whose value changed, and starts a redraft run for those sections.
 * Demo scenario: scripts/reset_demo.py restores the table to its first state.
 */

const TABLE = 'tlf_14_5_01_teae';
const COLS = ['pbo_n', 'pbo_pct', 'low_n', 'low_pct', 'high_n', 'high_pct'];
const LATEST_KEY = 'redeliver_latest';

interface Stored {
  old_version: number;
  new_version: number;
  old_delta_version: number;
  new_delta_version: number;
  changed_cells: number;
  affected: { section: string; sentence_idx: number; slot: string; label: string; old_value: string; new_value: string }[];
  run_id: string | null;
}

export function registerRedeliver(app: Application) {
  // The last re-delivery with the status of its redraft run. null after scripts/reset_demo.py.
  app.get('/api/redeliver/latest', async (_req: Request, res: Response) => {
    try {
      const rows = await sqlRows(`SELECT state_value FROM ${FQ}.demo_state WHERE state_key = '${LATEST_KEY}'`);
      if (!rows[0]?.state_value) {
        res.json(null);
        return;
      }
      const last = JSON.parse(rows[0].state_value) as Stored;
      res.json({ ...last, run_status: last.run_id ? await runStatus(last.run_id) : null });
    } catch (e) {
      console.error('[redeliver/latest]', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });

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
      const labels = await rowLabels(TABLE);
      const affected = (doc?.redelivery ?? [])
        .filter((r) => r.table === TABLE)
        .map((r) => {
          const part = doc?.sections
            .find((s) => s.section === r.section)
            ?.sentences[r.sentence_idx - 1]?.parts.find((p) => 'slot' in p && p.slot === r.slot);
          const bound = part && 'slot' in part ? part : null;
          const label = bound
            ? [rowPhrase(labels.get(bound.row_key) ?? bound.row_key), columnLabel(bound.column_name), columnUnit(bound.column_name)].filter(Boolean).join(', ')
            : r.slot;
          return { section: r.section, sentence_idx: r.sentence_idx - 1, slot: r.slot, label, old_value: r.old_value, new_value: r.new_value };
        });
      const sections = [...new Set(affected.map((a) => a.section))];
      const run_id = sections.length ? startRun(sections) : null;
      const result: Stored = { old_version, new_version, old_delta_version, new_delta_version, changed_cells: Number(diff[0]?.changed ?? 0), affected, run_id };
      await sqlRows(`DELETE FROM ${FQ}.demo_state WHERE state_key = '${LATEST_KEY}'`);
      await sqlRows(`INSERT INTO ${FQ}.demo_state VALUES ('${LATEST_KEY}', :v)`, [{ name: 'v', value: JSON.stringify(result) }]);
      // The table changed: read its new state now and refill the caches in the background.
      await teaeStateNow();
      void warmAll();
      res.json(result);
    } catch (e) {
      console.error('[redeliver]', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
