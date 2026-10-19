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
