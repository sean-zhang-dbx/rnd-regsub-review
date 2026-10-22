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

/** Arm name of a column ('pbo_n' is Placebo). Columns that are not an arm ('p_value') get a plain name. */
export function columnLabel(column: string): string {
  if (column === 'p_value') return 'p value';
  return ARM[column.split('_')[0]] ?? column;
}

/** What the column holds, for a re-delivery label: 'n' for counts, '%' for percentages, '' for the rest. */
export function columnUnit(column: string): string {
  if (column.endsWith('_n')) return 'n';
  if (column.endsWith('_pct')) return '%';
  return '';
}
