import { TEAE_TABLE, tableVersion, teaeReleases } from './dbx';

/*
 * In-memory caching for the read routes. Entries are keyed by what they depend on: the run, the section and the
 * state of Table 14-5.01 (its current Delta version and the release labels recorded in demo_state). A re-delivery
 * or a reset (scripts/reset_demo.py runs out of process) changes that state, so old entries are never served for
 * the new state. The state is read at most once per STATE_FRESH_MS and refreshed in the background, so a warm
 * request does no warehouse round trip at all.
 */

const STATE_FRESH_MS = 3000;

export interface TeaeState {
  delta: number;
  releases: Map<number, number>;
  key: string;
}

let state: TeaeState | null = null;
let stateAt = 0;
let refresh: Promise<TeaeState> | null = null;

async function readState(): Promise<TeaeState> {
  const [delta, releases] = await Promise.all([tableVersion(TEAE_TABLE), teaeReleases()]);
  const key = `${delta}:${[...releases.entries()].sort((a, b) => a[0] - b[0]).map(([d, r]) => `${d}=${r}`).join(',')}`;
  state = { delta, releases, key };
  stateAt = Date.now();
  return state;
}

function refreshState(): Promise<TeaeState> {
  refresh ??= readState().finally(() => {
    refresh = null;
  });
  return refresh;
}

/** Current state of Table 14-5.01. Served from memory; refreshed in the background when older than STATE_FRESH_MS. */
export async function teaeState(): Promise<TeaeState> {
  if (!state) return refreshState();
  if (Date.now() - stateAt > STATE_FRESH_MS) void refreshState().catch(() => undefined);
  return state;
}

/** Read the state now, bypassing the freshness window (after this server changed the table). */
export function teaeStateNow(): Promise<TeaeState> {
  return refreshState();
}

const stores = new Map<string, Map<string, Promise<unknown>>>();

/** Memoise an async computation per namespace and key. Failures and results the caller rejects are not kept. */
export function memo<T>(ns: string, key: string, compute: () => Promise<T>, keep: (v: T) => boolean = () => true, max = 300): Promise<T> {
  let m = stores.get(ns);
  if (!m) stores.set(ns, (m = new Map<string, Promise<unknown>>()));
  const hit = m.get(key);
  if (hit) return hit as Promise<T>;
  const p = compute();
  m.set(key, p);
  if (m.size > max) m.delete(m.keys().next().value as string);
  p.then(
    (v) => {
      if (!keep(v) && m.get(key) === p) m.delete(key);
    },
    () => {
      if (m.get(key) === p) m.delete(key);
    },
  );
  return p;
}

export function peek<T>(ns: string, key: string): Promise<T> | undefined {
  return stores.get(ns)?.get(key) as Promise<T> | undefined;
}

// Page images: file names are content hashes, so an image never changes. Bounded in memory.
const IMAGE_MAX_BYTES = 120 * 1024 * 1024;
const images = new Map<string, Buffer>();
let imageBytes = 0;

export function imageGet(path: string): Buffer | undefined {
  const b = images.get(path);
  if (b) {
    images.delete(path);
    images.set(path, b); // most recently used last
  }
  return b;
}

export function imagePut(path: string, b: Buffer) {
  if (images.has(path)) return;
  images.set(path, b);
  imageBytes += b.length;
  while (imageBytes > IMAGE_MAX_BYTES) {
    const [k, v] = images.entries().next().value as [string, Buffer];
    images.delete(k);
    imageBytes -= v.length;
  }
}
