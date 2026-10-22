/* Fetch helpers for the routes in docs/DEMO_PLAN.md section 4. With USE_FIXTURES on, they answer from src/fixtures. */
import { fx } from '../fixtures';
import { USE_FIXTURES } from '../fixtures/switch';
import type { Compare, CsrDocument, PodDef, PodEvent, Redelivery, Scorecard, SignoffState, Sources } from './types';

async function readError(url: string, res: Response): Promise<Error> {
  let detail = '';
  try {
    const raw = await res.text();
    try {
      const j: unknown = JSON.parse(raw);
      const msg: unknown = j && typeof j === 'object' ? (Object.entries(j) as [string, unknown][]).find(([k]) => k === 'error' || k === 'message')?.[1] : null;
      detail = typeof msg === 'string' ? msg : raw;
    } catch {
      detail = raw;
    }
    detail = detail.replace(/<[^>]*>/g, ' ').trim().slice(0, 200);
  } catch {
    detail = '';
  }
  return new Error(detail || `${url} returned ${res.status}`);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw await readError(url, res);
  return (await res.json()) as T;
}
async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw await readError(url, res);
  return (await res.json()) as T;
}

export const getScorecard = (): Promise<Scorecard> => (USE_FIXTURES ? fx.scorecard() : getJson('/api/scorecard'));
export const getSources = (): Promise<Sources> => (USE_FIXTURES ? fx.sources() : getJson('/api/sources'));
export const getPod = (): Promise<PodDef> => (USE_FIXTURES ? fx.pod() : getJson('/api/csr/pod'));
export const getLatestRun = (): Promise<CsrDocument | null> => (USE_FIXTURES ? fx.latestRun() : getJson('/api/csr-run/latest'));
export const getActiveRun = (): Promise<string | null> =>
  USE_FIXTURES ? fx.active().then((r) => r.run_id) : getJson<{ run_id: string | null }>('/api/csr-run/active').then((r) => r.run_id);
export const getCompare = (runId: string | undefined, section: string): Promise<Compare> =>
  USE_FIXTURES ? fx.compare(section) : getJson(`/api/compare?${runId ? `run_id=${encodeURIComponent(runId)}&` : ''}section=${encodeURIComponent(section)}`);
export const getSignoffs = (runId: string): Promise<SignoffState> =>
  USE_FIXTURES ? fx.signoffs() : getJson(`/api/csr/signoffs?run_id=${encodeURIComponent(runId)}`);
export const postSignoff = async (body: { run_id: string; department: string; decision: 'approved' | 'changes_requested'; note?: string }): Promise<void> => {
  if (USE_FIXTURES) return fx.signoff(body.department, body.decision);
  await postJson<unknown>('/api/csr/signoff', body);
};
export const postRedeliver = (): Promise<Redelivery> => (USE_FIXTURES ? fx.redeliver() : postJson('/api/redeliver', { table: 'tlf_14_5_01_teae' }));
export const exportUrl = (runId: string) => `/api/csr-run/${encodeURIComponent(runId)}/export.doc`;

/** Page images are served from the volume by path. Fixture pages carry a data URI. */
export const pageImageUrl = (path: string) => (path.startsWith('data:') ? path : `/api/page-image?path=${encodeURIComponent(path)}`);

/** Subscribes to the run's event stream (replayed from the start, then live). Returns the unsubscribe function. */
export function subscribeRun(runId: string, onEvent: (e: PodEvent) => void, onLost?: () => void): () => void {
  if (USE_FIXTURES) {
    const redraft = runId === 'fixture-redraft';
    return fx.stream(redraft ? fx.redraftEvents(runId) : fx.replayEvents(runId), (e) => {
      onEvent(e);
      if (redraft && e.type === 'run' && e.status === 'done') fx.finishRedeliver();
    });
  }
  const es = new EventSource(`/api/csr-run/${encodeURIComponent(runId)}/events`);
  es.onmessage = (m: MessageEvent<string>) => {
    try {
      onEvent(JSON.parse(m.data) as PodEvent);
    } catch {
      /* ignore a malformed line */
    }
  };
  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) onLost?.();
  };
  return () => es.close();
}
