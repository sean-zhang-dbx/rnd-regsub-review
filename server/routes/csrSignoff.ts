import { randomUUID } from 'node:crypto';
import type { Application, Request, Response } from 'express';
import { FQ, releasesOfVersions, sqlRows, teaeReleases } from '../lib/dbx';
import { DEPARTMENTS, PREREQUISITE_DEPARTMENTS, RELEASE_DEPARTMENT } from '../lib/pod/pod';
import { runTableVersions } from '../lib/pod/run';

/*
 * Departmental sign-off of a CSR Pod run. Each agent is a governed extension of a responsible department,
 * so each department signs its own contribution, with the table versions the figures were bound to.
 * Regulatory Affairs cannot release the CSR until Medical Writing, Biostatistics and Clinical Safety have
 * approved the same run. Named approvers, not a validated e-signature.
 */

interface Signoff {
  signoff_id: string;
  run_id: string;
  department: string;
  scope: string;
  signer: string;
  role: string;
  decision: 'approved' | 'changes_requested';
  note: string | null;
  table_versions: Record<string, number>;
  signed_at: string;
}

async function signoffsFor(runId: string): Promise<{ signoffs: Signoff[]; release_blocked_by: string[] }> {
  const rows = await sqlRows(`SELECT * FROM ${FQ}.csr_signoffs WHERE run_id = :r ORDER BY signed_at`, [{ name: 'r', value: runId }]);
  const teae = await teaeReleases();
  const signoffs = rows.map((r) => ({
    signoff_id: r.signoff_id as string,
    run_id: r.run_id as string,
    department: r.department as string,
    scope: r.scope as string,
    signer: r.signer as string,
    role: r.role as string,
    decision: r.decision as Signoff['decision'],
    note: r.note,
    table_versions: releasesOfVersions(JSON.parse((r.table_versions_json as string) || '{}') as Record<string, number>, teae),
    signed_at: r.signed_at as string,
  }));
  const latest = new Map<string, Signoff>();
  for (const s of signoffs) latest.set(s.department, s);
  const release_blocked_by = PREREQUISITE_DEPARTMENTS.filter((d) => latest.get(d)?.decision !== 'approved');
  return { signoffs, release_blocked_by };
}

export function registerCsrSignoff(app: Application) {
  app.get('/api/csr/signoffs', async (req: Request, res: Response) => {
    const runId = typeof req.query.run_id === 'string' ? req.query.run_id : '';
    if (!/^csr-[\w-]{6,40}$/.test(runId)) {
      res.status(400).json({ error: 'run_id is required' });
      return;
    }
    try {
      res.json(await signoffsFor(runId));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/csr/signoff', async (req: Request, res: Response) => {
    const { run_id, department, decision, note } = (req.body ?? {}) as Record<string, unknown>;
    const dept = DEPARTMENTS.find((d) => d.department === department);
    if (typeof run_id !== 'string' || !/^csr-[\w-]{6,40}$/.test(run_id) || !dept) {
      res.status(400).json({ error: `run_id and a department (${DEPARTMENTS.map((d) => d.department).join(', ')}) are required` });
      return;
    }
    if (decision !== 'approved' && decision !== 'changes_requested') {
      res.status(400).json({ error: 'decision must be approved or changes_requested' });
      return;
    }
    if (note !== undefined && (typeof note !== 'string' || note.length > 1000)) {
      res.status(400).json({ error: 'note must be a string of at most 1000 characters' });
      return;
    }
    try {
      const [run] = await sqlRows(`SELECT status FROM ${FQ}.csr_runs WHERE run_id = :r`, [{ name: 'r', value: run_id }]);
      if (!run || run.status !== 'done') {
        res.status(404).json({ error: 'only a finished run can be signed' });
        return;
      }
      if (dept.department === RELEASE_DEPARTMENT && decision === 'approved') {
        const { release_blocked_by } = await signoffsFor(run_id);
        if (release_blocked_by.length) {
          res.status(409).json({ error: `Release is blocked until ${release_blocked_by.join(', ')} approve this draft.`, release_blocked_by });
          return;
        }
      }
      const versions = await runTableVersions(run_id);
      const email = req.headers['x-forwarded-email'];
      const recordedBy = typeof email === 'string' && email ? `Recorded by ${email}.` : '';
      await sqlRows(
        `INSERT INTO ${FQ}.csr_signoffs (signoff_id, run_id, department, scope, signer, role, decision, note, table_versions_json, signed_at)
         VALUES (:id, :run, :dept, :scope, :signer, :role, :decision, :note, :tv, current_timestamp())`,
        [
          { name: 'id', value: randomUUID() },
          { name: 'run', value: run_id },
          { name: 'dept', value: dept.department },
          { name: 'scope', value: dept.scope },
          { name: 'signer', value: dept.signer },
          { name: 'role', value: dept.role },
          { name: 'decision', value: decision },
          { name: 'note', value: [typeof note === 'string' ? note : '', recordedBy].filter(Boolean).join(' ') || null },
          { name: 'tv', value: JSON.stringify(versions) },
        ],
      );
      res.json(await signoffsFor(run_id));
    } catch (e) {
      console.error('[csr-signoff]', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
