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
