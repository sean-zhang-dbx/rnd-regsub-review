/* Server routes from docs/DEMO_PLAN.md section 4. */
import type { AssistantEvent, DraftResult, DraftRunEvent, GenieAnswer, SignoffAction, SignoffResponse, UntrackedHit, WordingCheckResult } from './types';

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

export function postDraftSection(section: string): Promise<DraftResult> {
  return postJson('/api/draft-section', { section });
}

/** Reads a server-sent event stream from a POST route; one JSON object per event. */
async function streamSse<T>(url: string, body: unknown, onEvent: (e: T) => void): Promise<void> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) throw new Error(`${url} returned ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (line) onEvent(JSON.parse(line.slice(6)) as T);
    }
  }
}

/** Streams the drafting run: one event per step (server/routes/draftRun.ts). */
export function streamDraftRun(section: string, onEvent: (e: DraftRunEvent) => void): Promise<void> {
  return streamSse('/api/draft-run', { section }, onEvent);
}

/** Streams the reviewer assistant: route, tables, documents, then the answer (server/routes/assistant.ts). */
export function streamAssistant(
  body: { question: string; history: { role: 'user' | 'assistant'; content: string }[]; genie_conversation_id?: string },
  onEvent: (e: AssistantEvent) => void,
): Promise<void> {
  return streamSse('/api/assistant', body, onEvent);
}

export function pageImageUrl(imagePath: string): string {
  return `/api/page-image?path=${encodeURIComponent(imagePath)}`;
}
