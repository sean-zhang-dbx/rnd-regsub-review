import type { DocType } from '../data/types';

/** The reviewer is fictional. The sign-off route records the same name server-side. */
export const REVIEWER_SHORT = 'A. Okafor';
export const STUDY = 'LMN-301';

export function docLabel(docType: DocType, section: string): string {
  if (docType === 'csr') return `CSR ${section}`;
  if (docType === 'label') return `Label ${section}`;
  return `Module ${section}`;
}

/* Restatement time is business time carried in the data (UTC), so it reads 09:12 as recorded. */
export function formatClockUtc(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
}

export function formatDateUtc(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatSignedAt(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date}, ${time}`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The reviewer as the sign-off route records them. */
export const REVIEWER_FULL = 'Dr. Amara Okafor, Regulatory Review';

/** Unity Gateway model service behind the wording check. Single place to change it. */
export const WORDING_SERVICE = 'sean_zhang_catalog.rnd_regsub_review.wording_check';

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** TLF IDs for the certified tables. The tables play the role of the TLFs (tables, listings, figures). */
export const TLF: Record<string, string> = {
  efficacy_primary: 'Table 14.2.1',
  safety_overview: 'Table 14.3.1',
};

export function tlfName(table: string): string {
  const t = table.split('.').pop() ?? table;
  return TLF[t] ? `${TLF[t]} (${t})` : t;
}

/** Cell behind each efficacy figure key (the contract's fig_key to row key and column). */
export const FIG_CELL: Record<string, { row: string; column: string }> = {
  trt_resp: { row: 'TRT', column: 'responders' },
  trt_n: { row: 'TRT', column: 'n' },
  trt_rate: { row: 'TRT', column: 'rate_pct' },
  pbo_resp: { row: 'PBO', column: 'responders' },
  pbo_n: { row: 'PBO', column: 'n' },
  pbo_rate: { row: 'PBO', column: 'rate_pct' },
  diff: { row: 'DIFF', column: 'diff_pct' },
  ci_low: { row: 'DIFF', column: 'ci_low' },
  ci_high: { row: 'DIFF', column: 'ci_high' },
};

export const DRAFT_LABEL = 'Draft 0.4, In review';

export function docTitle(docType: string, section: string): string {
  if (docType === 'csr') return 'Clinical Study Report';
  if (docType === 'label') return 'Prescribing Information';
  return `Module ${section}`;
}
