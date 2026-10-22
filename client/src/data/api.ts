/* Fetch helpers for the routes in docs/DEMO_PLAN.md section 4. */
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

/* The server answers 404 with "there is no finished run yet" before the first run: show it as empty, not as an error. */
function emptyScorecard(e: unknown): Scorecard {
  if (e instanceof Error && /no finished run/i.test(e.message)) {
    return { run: { run_id: '' }, headline: { wall_ms: null, figures_total: 0, figures_matched: 0, typed_figures: 0 }, rows: [] };
  }
  throw e;
}
export const getScorecard = (): Promise<Scorecard> => getJson<Scorecard>('/api/scorecard').catch(emptyScorecard);
export const getSources = (): Promise<Sources> => getJson('/api/sources');
export const getPod = (): Promise<PodDef> => getJson('/api/csr/pod');
export const getLatestRun = (): Promise<CsrDocument | null> => getJson('/api/csr-run/latest');
export const getActiveRun = (): Promise<string | null> =>
  getJson<{ run_id: string | null }>('/api/csr-run/active').then((r) => r.run_id);
export const getCompare = (runId: string | undefined, section: string): Promise<Compare> =>
  getJson(`/api/compare?${runId ? `run_id=${encodeURIComponent(runId)}&` : ''}section=${encodeURIComponent(section)}`);
export const getSignoffs = (runId: string): Promise<SignoffState> =>
  getJson(`/api/csr/signoffs?run_id=${encodeURIComponent(runId)}`);
export const postSignoff = async (body: { run_id: string; department: string; decision: 'approved' | 'changes_requested'; note?: string }): Promise<void> => {
  await postJson<unknown>('/api/csr/signoff', body);
};
export const postRedeliver = (): Promise<Redelivery> => postJson('/api/redeliver', { table: 'tlf_14_5_01_teae' });
export const exportUrl = (runId: string) => `/api/csr-run/${encodeURIComponent(runId)}/export.doc`;

/** Page images are served from the volume by path. */
export const pageImageUrl = (path: string) => `/api/page-image?path=${encodeURIComponent(path)}`;

/** Subscribes to the run's event stream (replayed from the start, then live). Returns the unsubscribe function. */
export function subscribeRun(runId: string, onEvent: (e: PodEvent) => void, onLost?: () => void): () => void {
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
