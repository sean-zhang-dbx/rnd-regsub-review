import type { Application, Request, Response } from 'express';
import { FQ, releasesOfVersions, sqlRows, teaeReleases } from '../lib/dbx';
import { loadRegistry } from '../lib/pod/data';
import { latestDoneRunId } from '../lib/pod/run';
import { loadScores } from '../lib/pod/score';

/*
 * GET /api/scorecard?run_id=  (default: the latest done run)
 * One row per drafted section: figures that match the submitted CSR (n of m), content coverage 1 to 5 from the
 * judge, sentences that need a person, and the owner. 'differs' only when a drafted figure differs from the
 * printed value.
 */

const RUN_ID = /^csr-[\w-]{6,40}$/;

export function registerScorecard(app: Application) {
  app.get('/api/scorecard', async (req: Request, res: Response) => {
    try {
      const requested = typeof req.query.run_id === 'string' ? req.query.run_id : '';
      if (requested && !RUN_ID.test(requested)) {
        res.status(400).json({ error: 'bad run id' });
        return;
      }
      const runId = requested || (await latestDoneRunId());
      if (!runId) {
        res.status(404).json({ error: 'there is no finished run yet' });
        return;
      }
      const [runRows, registry, scores, sections] = await Promise.all([
        sqlRows(
          `SELECT run_id, base_run_id, status, started_at, finished_at, table_versions_json, sections_requested, model, judge_model, trace_id, wall_ms, superseded
           FROM ${FQ}.csr_runs WHERE run_id = :r`,
          [{ name: 'r', value: runId }],
        ),
        loadRegistry(),
        loadScores(runId),
        sqlRows(`SELECT section, needs_person_json FROM ${FQ}.csr_sections WHERE run_id = :r`, [{ name: 'r', value: runId }]),
      ]);
      const run = runRows[0];
      if (!run) {
        res.status(404).json({ error: 'no such run' });
        return;
      }
      const needs = new Map(sections.map((s) => [s.section as string, (JSON.parse((s.needs_person_json as string) || '[]') as unknown[]).length]));
      const rows = registry
        .filter((r) => r.kind === 'drafted')
        .map((r) => {
          const sc = scores.find((x) => x.section === r.section);
          const total = sc?.figures_total ?? 0;
          const matched = sc?.figures_matched ?? 0;
          return {
            section: r.section,
            title: r.title,
            department: r.department,
            figures_total: total,
            figures_matched: matched,
            coverage_score: sc?.coverage_score ?? null,
            needs_person: needs.get(r.section) ?? 0,
            status: matched < total ? ('differs' as const) : ('quiet' as const),
          };
        });
      res.json({
        run: { ...run, table_versions: releasesOfVersions(JSON.parse((run.table_versions_json as string) || '{}') as Record<string, number>, await teaeReleases()), wall_ms: run.wall_ms === null ? null : Number(run.wall_ms), superseded: run.superseded === 'true' },
        headline: {
          wall_ms: run.wall_ms === null ? null : Number(run.wall_ms),
          figures_total: rows.reduce((a, r) => a + r.figures_total, 0),
          figures_matched: rows.reduce((a, r) => a + r.figures_matched, 0),
          typed_figures: 0,
        },
        rows,
      });
    } catch (e) {
      console.error('[scorecard]', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
