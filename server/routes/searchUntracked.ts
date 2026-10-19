import type { Application, Request, Response } from 'express';
import { INDEX_NAME, dbxFetch } from '../lib/dbx';

interface Hit {
  doc_title: string;
  file_path: string;
  page: number;
  snippet: string;
  score: number;
}

const cache = new Map<string, Hit[]>();

/** Numbers worth matching: decimals or 3+ digit integers. Plain 2-digit integers such as 95 or 52 are noise. */
function numberTokens(values: string[]): string[] {
  const out = new Set<string>();
  for (const v of values) {
    for (const m of v.matchAll(/\d+(?:\.\d+)?/g)) {
      if (m[0].includes('.') || m[0].length >= 3) out.add(m[0]);
    }
  }
  return [...out];
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
}

function matches(text: string, tokens: string[]): string[] {
  return tokens.filter((t) =>
    new RegExp(`(?<![\\d.])${t.replace('.', '\\.')}(?![\\d]|\\.\\d)`).test(text),
  );
}

function snippetAround(text: string, tokens: string[]): string {
  const clean = stripHtml(text);
  const idx = Math.min(...tokens.map((t) => clean.search(new RegExp(`(?<![\\d.])${t.replace('.', '\\.')}`))).filter((i) => i >= 0));
  const start = Number.isFinite(idx) ? Math.max(0, idx - 90) : 0;
  const piece = clean.slice(start, start + 260).trim();
  return `${start > 0 ? '...' : ''}${piece}${start + 260 < clean.length ? '...' : ''}`;
}

export function registerSearchUntracked(app: Application) {
  app.post('/api/search-untracked', async (req: Request, res: Response) => {
    const oldValues = (req.body as { old_values?: unknown })?.old_values;
    if (!Array.isArray(oldValues) || oldValues.length === 0 || oldValues.length > 40 || !oldValues.every((v) => typeof v === 'string')) {
      res.status(400).json({ error: 'old_values must be a non-empty array of strings' });
      return;
    }
    const values = oldValues as string[];
    const key = JSON.stringify([...values].sort());
    const hit = cache.get(key);
    if (hit) {
      res.json(hit);
      return;
    }
    const tokens = numberTokens(values);
    if (tokens.length === 0) {
      res.json([]);
      return;
    }
    try {
      // Hybrid (vector + keyword) query. The old values are the keyword part; the plain-language
      // variant is added so the semantic part finds passages that describe the old result in words.
      const queryText = `${values.join(' ')} about two-thirds of participants responded`;
      const out = await dbxFetch<{
        result?: { data_array?: [string, string, number, string, number][] };
      }>(`/api/2.0/vector-search/indexes/${INDEX_NAME}/query`, {
        body: {
          query_text: queryText,
          columns: ['doc_title', 'file_path', 'page', 'chunk_text'],
          num_results: 5,
          query_type: 'HYBRID',
        },
      });
      const rows = out.result?.data_array ?? [];
      const hits: Hit[] = [];
      for (const [doc_title, file_path, page, chunk, score] of rows) {
        const text = stripHtml(chunk);
        const found = matches(text, tokens);
        if (found.length === 0) continue; // no match on an old value: not quoting the old result
        hits.push({ doc_title, file_path, page: Number(page), snippet: snippetAround(chunk, found), score: Number(score) });
      }
      cache.set(key, hits);
      res.json(hits);
    } catch (e) {
      console.error('[search-untracked]', e);
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
