/*
 * "See it in Databricks" links. Read from config/demo-links.json, which the backend writes. The file may be
 * missing (before the backend has run) and may be shaped as { key: url } or { key: { url } }, optionally
 * under a "links" key. URLs are never hardcoded in the client.
 */
const files = import.meta.glob('../../../config/demo-links.json', { eager: true, import: 'default' });

function toMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const root = raw as Record<string, unknown>;
  const src = root.links && typeof root.links === 'object' ? (root.links as Record<string, unknown>) : root;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) {
    if (typeof v === 'string' && /^https?:\/\//.test(v)) out[k] = v;
    else if (v && typeof v === 'object' && typeof (v as { url?: unknown }).url === 'string') out[k] = (v as { url: string }).url;
  }
  return out;
}

const LINKS = toMap(Object.values(files)[0]);

/** The URL for a link key, or null when the file or the key is missing. */
export function linkFor(key: string | undefined): string | null {
  return key ? (LINKS[key] ?? null) : null;
}
