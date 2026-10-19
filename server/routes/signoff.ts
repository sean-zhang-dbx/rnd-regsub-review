import { randomUUID } from 'node:crypto';
import type { Application, Request, Response } from 'express';
import { FQ, REVIEWER, currentEfficacyVersion, sqlRows } from '../lib/dbx';

export const ACTIONS = ['approved', 'sent_to_labelling', 'sent_to_writer', 'notified_owner'] as const;
type Action = (typeof ACTIONS)[number];

export function registerSignoff(app: Application) {
  app.post('/api/signoff', async (req: Request, res: Response) => {
    const { sentence_ids, action } = (req.body ?? {}) as { sentence_ids?: unknown; action?: unknown };
    if (
      !Array.isArray(sentence_ids) ||
      sentence_ids.length === 0 ||
      sentence_ids.length > 50 ||
      !sentence_ids.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 400)
    ) {
      res.status(400).json({ error: 'sentence_ids must be a non-empty array of strings (at most 50)' });
      return;
    }
    if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
      res.status(400).json({ error: `action must be one of ${ACTIONS.join(', ')}` });
      return;
    }
    try {
      const version = await currentEfficacyVersion();
      const ids = sentence_ids as string[];
      // For notified_owner the "sentence id" is the file path of the untracked document.
      const values = ids.map((_, i) => `(:id${i}, :sid${i}, :action, :reviewer, CAST(:ver AS BIGINT), current_timestamp())`).join(', ');
      const params = [
        { name: 'action', value: action as Action },
        { name: 'reviewer', value: REVIEWER },
        { name: 'ver', value: String(version) },
        ...ids.flatMap((sid, i) => [
          { name: `id${i}`, value: randomUUID() },
          { name: `sid${i}`, value: sid },
        ]),
      ];
      await sqlRows(
        `INSERT INTO ${FQ}.review_signoffs (signoff_id, sentence_id, action, reviewer, table_version, signed_at) VALUES ${values}`,
        params,
      );
      res.json({ written: ids.length });
    } catch (e) {
      console.error('[signoff]', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
