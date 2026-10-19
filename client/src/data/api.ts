/* Server routes from docs/DEMO_PLAN.md section 4. */
import type { GenieAnswer, SignoffAction, SignoffResponse, UntrackedHit, WordingCheckResult } from './types';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.text()).replace(/<[^>]*>/g, ' ').trim().slice(0, 160);
    } catch {
      detail = '';
    }
    throw new Error(`${url} returned ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as T;
}

export function postWordingCheck(sentenceIds: string[], preferCached = false): Promise<WordingCheckResult[]> {
  return postJson('/api/wording-check', { sentence_ids: sentenceIds, prefer_cached: preferCached });
}

export function postSearchUntracked(oldValues: string[]): Promise<UntrackedHit[]> {
  return postJson('/api/search-untracked', { old_values: oldValues });
}

export function postSignoff(sentenceIds: string[], action: SignoffAction): Promise<SignoffResponse> {
  return postJson('/api/signoff', { sentence_ids: sentenceIds, action });
}

export function postGenieAsk(question: string): Promise<GenieAnswer> {
  return postJson('/api/genie/ask', { question });
}
