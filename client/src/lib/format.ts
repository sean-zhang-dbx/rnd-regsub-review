export function formatDuration(ms: number | null | undefined): string {
  if (!ms) return 'not recorded';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

export function formatSignedAt(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

/** `tlf_14_3_01_adascog_w24` becomes `Table 14-3.01`. Anything else is returned as it is. */
export function tlfLabel(tlf: string): string {
  const m = /^(?:[a-z_]+\.)*tlf_(\d+)_(\d+)_(\d+)/.exec(tlf);
  return m ? `Table ${m[1]}-${m[2]}.${m[3]}` : tlf;
}

const ARMS: Record<string, string> = {
  pbo: 'Placebo',
  low: 'Xanomeline Low Dose',
  high: 'Xanomeline High Dose',
  total: 'Total',
};
export const armLabel = (column: string) => ARMS[column] ?? column.replace(/_/g, ' ');

/** Row keys are machine names; show them as plain words. */
export const rowWords = (rowKey: string) => rowKey.replace(/_/g, ' ');

/** Fixture and live sentences differ only in where the text comes from; this joins parts for aria labels. */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function parseVersions(json?: string | null, parsed?: Record<string, number>): string {
  let v = parsed;
  if (!v && json) {
    try {
      v = JSON.parse(json) as Record<string, number>;
    } catch {
      v = undefined;
    }
  }
  if (!v) return '';
  return Object.entries(v)
    .map(([t, n]) => `${tlfLabel(t)} v${n}`)
    .join(', ');
}
