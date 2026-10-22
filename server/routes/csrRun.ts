import type { Application, Request, Response } from 'express';
import { loadRegistry } from '../lib/pod/data';
import { exportHtml } from '../lib/pod/assemble';
import { POD } from '../lib/pod/pod';
import { activeRunId, latestDoneRunId, loadDocument, loadStoredEvents, startRun, subscribe } from '../lib/pod/run';
import type { PodEvent } from '../lib/pod/run';

/*
 * The CSR Pod: the pod definition, the template registry, starting a run (whole CSR or chosen sections),
 * streaming its events, reading a finished run back, and the Word export.
 */

const RUN_ID = /^csr-[\w-]{6,40}$/;

export function registerCsrRun(app: Application) {
  app.get('/api/csr/pod', (_req: Request, res: Response) => {
    res.json(POD);
  });

  app.get('/api/csr/registry', async (_req: Request, res: Response) => {
    try {
      res.json({ sections: await loadRegistry() });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post('/api/csr-run', (req: Request, res: Response) => {
    const sections = (req.body as { sections?: unknown })?.sections;
    if (sections !== undefined && (!Array.isArray(sections) || sections.length > 20 || !sections.every((s) => typeof s === 'string' && /^[\d.]{1,8}$/.test(s)))) {
      res.status(400).json({ error: 'sections must be an array of section numbers' });
      return;
    }
    try {
      res.json({ run_id: startRun(sections as string[] | undefined) });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 500;
      res.status(status).json({ error: (e as Error).message, run_id: activeRunId() });
    }
  });

  app.get('/api/csr-run/active', (_req: Request, res: Response) => {
    res.json({ run_id: activeRunId() });
  });

  app.get('/api/csr-run/latest', async (_req: Request, res: Response) => {
    try {
      const id = await latestDoneRunId();
      res.json(id ? await loadDocument(id) : null);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Server-sent events. A run on this server is replayed from memory and then live; a finished run (the pre-run,
  // or any run after a server restart) is replayed from the events stored with the run.
  app.get('/api/csr-run/:id/events', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!RUN_ID.test(id)) {
      res.status(400).json({ error: 'bad run id' });
      return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (e: PodEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const finished = (e: PodEvent) => e.type === 'run' && e.status !== 'running';
    let closed = false;
    let beat: NodeJS.Timeout | undefined;
    let sub: ReturnType<typeof subscribe> = null;
    const close = () => {
      if (closed) return;
      closed = true;
      if (beat) clearInterval(beat);
      sub?.unsubscribe();
      res.end();
    };
    req.on('close', close);
    sub = subscribe(id, (e) => {
      send(e);
      if (finished(e)) close();
    });
    if (sub) {
      // Keep the Apps proxy from closing a quiet stream.
      beat = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
      for (const e of sub.replay) send(e);
      if (sub.done) close();
      return;
    }
    try {
      const stored = await loadStoredEvents(id);
      if (stored) for (const e of stored) send(e);
      else send({ type: 'run', status: 'error', run_id: id, at: new Date().toISOString(), error: 'no such run' });
    } catch (e) {
      send({ type: 'run', status: 'error', run_id: id, at: new Date().toISOString(), error: (e as Error).message });
    }
    close();
  });

  app.get('/api/csr-run/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!RUN_ID.test(id)) {
      res.status(400).json({ error: 'bad run id' });
      return;
    }
    try {
      const doc = await loadDocument(id);
      if (!doc) res.status(404).json({ error: 'no such run' });
      else res.json(doc);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get('/api/csr-run/:id/export.doc', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (!RUN_ID.test(id)) {
      res.status(400).json({ error: 'bad run id' });
      return;
    }
    try {
      const doc = await loadDocument(id);
      if (!doc) {
        res.status(404).json({ error: 'no such run' });
        return;
      }
      res.setHeader('Content-Type', 'application/msword');
      res.setHeader('Content-Disposition', 'attachment; filename="CDISCPILOT01_CSR_draft.doc"');
      res.send(exportHtml(doc.sections, doc));
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
