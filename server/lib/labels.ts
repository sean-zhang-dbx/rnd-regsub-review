import { FQ, sqlRows } from './dbx';
import { memo } from './cache';

/** Printed-row labels of a TLF table (row_label by row_key). Labels do not change between releases. */
export function rowLabels(table: string): Promise<Map<string, string>> {
  if (!/^tlf_14_\w+$/.test(table)) return Promise.resolve(new Map<string, string>());
  return memo<Map<string, string>>('labels', table, async () => {
    const rows = await sqlRows(`SELECT row_key, row_label FROM ${FQ}.${table}`);
    return new Map<string, string>(rows.map((r) => [r.row_key as string, (r.row_label as string) ?? (r.row_key as string)]));
  });
}

const ARM: Record<string, string> = { pbo: 'Placebo', low: 'Xanomeline Low Dose', high: 'Xanomeline High Dose', total: 'Total' };

/**
 * Arm name of a column ('pbo_n' is Placebo). null for a column that is not an arm ('p_value'): the row label then
 * carries the whole description, so the two labels never repeat each other.
 */
export function columnLabel(column: string): string | null {
  return ARM[column.split('_')[0]] ?? null;
}

/**
 * Plain phrase for a printed row: "p value, dose response" reads "Dose response p value", "p value, xanomeline versus
 * placebo" reads "p value vs placebo", "95% CI lower limit versus placebo" reads "95% CI lower bound vs placebo".
 */
export function rowPhrase(label: string): string {
  let t = label;
  const p = /^p value, (.*)$/.exec(t);
  if (p) {
    const rest = p[1].replace(/^xanomeline /, '');
    t = /\bversus\b/.test(rest) ? `p value ${rest}` : `${rest.charAt(0).toUpperCase()}${rest.slice(1)} p value`;
  }
  if (t.startsWith('95% CI')) t = t.replace(/\blimit\b/, 'bound');
  return t.replace(/\bversus\b/g, 'vs');
}

/** What the column holds, for a re-delivery label: 'n' for counts, '%' for percentages, '' for the rest. */
export function columnUnit(column: string): string {
  if (column.endsWith('_n')) return 'n';
  if (column.endsWith('_pct')) return '%';
  return '';
}
