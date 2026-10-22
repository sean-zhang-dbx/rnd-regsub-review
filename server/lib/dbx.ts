import { ServiceContext, getWarehouseId } from '@databricks/appkit';
import type { Request } from 'express';

// The schema comes from the bundle variable (app.yaml env CSRPOD_SCHEMA); the defaults match databricks.yml.
export const CATALOG = process.env.CSRPOD_CATALOG ?? 'sean_zhang_catalog';
export const SCHEMA = process.env.CSRPOD_SCHEMA ?? 'rnd_csr_pod';
export const FQ = `${CATALOG}.${SCHEMA}`;

export const INDEX_NAME = `${FQ}.doc_elements_index`;
/** Unity Gateway model service (custom, with an inference table) that routes to Claude Sonnet 5.5. */
export const MODEL_SERVICE = process.env.CSRPOD_MODEL_SERVICE ?? `${FQ}.csr_author`;
export const MODEL_LABEL = MODEL_SERVICE;
export const VOLUME_PAGES = `/Volumes/${CATALOG}/${SCHEMA}/parsed_pages/`;

/**
 * Bearer token to use for a call. When the request carries the Apps proxy header
 * x-forwarded-access-token the call runs as the signed-in user (on behalf of user),
 * otherwise as the app identity (service principal in Apps, CLI profile locally).
 */
export function userToken(req?: Request): string | undefined {
  const h = req?.headers['x-forwarded-access-token'];
  return typeof h === 'string' && h.length > 0 ? h : undefined;
}

export async function dbxFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; token?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const w = ServiceContext.get().client;
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  else await w.config.authenticate(headers);
  const host = (w.config.host ?? '').replace(/\/$/, '');
  const res = await fetch(`${host}${path}`, {
    method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: init.signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 400)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** GET a binary file (a page image from the volume) with the app identity. */
export async function dbxFetchRaw(path: string): Promise<Response> {
  const w = ServiceContext.get().client;
  const headers = new Headers();
  await w.config.authenticate(headers);
  const host = (w.config.host ?? '').replace(/\/$/, '');
  return fetch(`${host}${path}`, { headers });
}

export function workspaceHost(): string {
  return (ServiceContext.get().client.config.host ?? '').replace(/\/$/, '');
}

type SqlParam = { name: string; value: string | null; type?: string };

interface StatementResponse {
  statement_id: string;
  status: { state: string; error?: { message?: string } };
  manifest?: { schema?: { columns?: { name: string }[] } };
  result?: { data_array?: (string | null)[][] };
}

/** Run one SQL statement on the app warehouse and return rows as objects (all values are strings or null). */
export async function sqlRows(
  statement: string,
  params: SqlParam[] = [],
): Promise<Record<string, string | null>[]> {
  const warehouse_id = await getWarehouseId();
  let r = await dbxFetch<StatementResponse>('/api/2.0/sql/statements', {
    body: {
      warehouse_id,
      statement,
      wait_timeout: '30s',
      on_wait_timeout: 'CONTINUE',
      format: 'JSON_ARRAY',
      disposition: 'INLINE',
      parameters: params.length ? params : undefined,
    },
  });
  for (let i = 0; i < 60 && ['PENDING', 'RUNNING'].includes(r.status.state); i++) {
    await new Promise((ok) => setTimeout(ok, 1000));
    r = await dbxFetch<StatementResponse>(`/api/2.0/sql/statements/${r.statement_id}`);
  }
  if (r.status.state !== 'SUCCEEDED') {
    throw new Error(`SQL ${r.status.state}: ${r.status.error?.message ?? ''}`.slice(0, 500));
  }
  const cols = r.manifest?.schema?.columns?.map((c) => c.name) ?? [];
  return (r.result?.data_array ?? []).map((row) =>
    Object.fromEntries(cols.map((c, i) => [c, row[i] ?? null])),
  );
}

/** Current Delta version of a table in the schema. */
export async function tableVersion(table: string): Promise<number> {
  const rows = await sqlRows(`SELECT CAST(MAX(version) AS INT) AS v FROM (DESCRIBE HISTORY ${FQ}.${table})`);
  return Number(rows[0]?.v ?? 0);
}

/*
 * Release numbers shown to the audience. Delta versions keep growing (every re-delivery and every reset adds one), but
 * the story has two releases of Table 14-5.01: version 1 (all adverse events) and version 2 (treatment-emergent only).
 * demo_state maps each Delta version of tlf_14_5_01_teae to its release ('teae_release@<delta>'); the redeliver route
 * and scripts/reset_demo.py write it. Every other TLF has a single release.
 */
export const TEAE_TABLE = 'tlf_14_5_01_teae';

export async function teaeReleases(): Promise<Map<number, number>> {
  const rows = await sqlRows(
    `SELECT state_key, state_value FROM ${FQ}.demo_state WHERE state_key = 'teae_v1_delta_version' OR state_key LIKE 'teae_release@%'`,
  );
  const m = new Map<number, number>();
  for (const r of rows) {
    const key = r.state_key as string;
    if (key === 'teae_v1_delta_version') m.set(Number(r.state_value), 1);
    else m.set(Number(key.slice('teae_release@'.length)), Number(r.state_value));
  }
  return m;
}

export function releaseOf(table: string, delta: number, teae: Map<number, number>): number {
  return table === TEAE_TABLE ? (teae.get(delta) ?? 1) : 1;
}

export async function recordTeaeRelease(delta: number, release: 1 | 2): Promise<void> {
  await sqlRows(`DELETE FROM ${FQ}.demo_state WHERE state_key = 'teae_release@${delta}'`);
  await sqlRows(`INSERT INTO ${FQ}.demo_state VALUES ('teae_release@${delta}', '${release}')`);
}

export function releasesOfVersions(v: Record<string, number>, teae: Map<number, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(v).map(([t, d]) => [t, releaseOf(t, d, teae)]));
}
