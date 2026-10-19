/*
 * Data seam. Every screen reads through these hooks and routes.
 * Today they return typed fixtures. When typegen output exists, each hook becomes a
 * `useAnalyticsQuery('<key>', params)` call and `./types` re-exports the generated row types.
 */
import {
  citationDetail,
  documentSection1141,
  impactList,
  recomputeFigures,
  restatementSummary,
  signoffRows,
  unchangedSentences,
} from '../fixtures/data';
import { useFixtureQuery } from '../fixtures/runtime';
import type { QueryState } from '../fixtures/runtime';
import type {
  CitationDetailRow,
  DocumentSectionRow,
  ImpactRow,
  RecomputeRow,
  RestatementSummaryRow,
  SignoffRow,
  UnchangedRow,
} from './types';

export type { QueryState };

export function useRestatementSummary(): QueryState<RestatementSummaryRow> {
  return useFixtureQuery(() => restatementSummary);
}

export function useImpactList(): QueryState<ImpactRow> {
  return useFixtureQuery(() => impactList);
}

export function useUnchangedSentences(): QueryState<UnchangedRow> {
  return useFixtureQuery(() => unchangedSentences);
}

export function useDocumentSection(section: string): QueryState<DocumentSectionRow> {
  return useFixtureQuery(() => (section === '11.4.1' ? documentSection1141 : []));
}

export function useCitationDetail(citationId: string): QueryState<CitationDetailRow> {
  return useFixtureQuery(() => citationDetail(citationId), 350);
}

/** Runs only when mounted: mount it when the reviewer clicks "Recompute from source". */
export function useRecomputeFigures(): QueryState<RecomputeRow> {
  return useFixtureQuery(() => recomputeFigures, 900);
}

/** `refresh` changes after a sign-off is written so the list is read again. */
export function useSignoffs(refresh: number): QueryState<SignoffRow> {
  return useFixtureQuery(() => signoffRows(), 250, refresh > 0, refresh);
}
