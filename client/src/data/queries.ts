import { useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';
import type { TlfCell } from './types';

export function useRestatementSummary() {
  return useAnalyticsQuery('restatement_summary', {});
}

export function useImpactList() {
  return useAnalyticsQuery('impact_list', {});
}

export function useUnchangedSentences() {
  return useAnalyticsQuery('unchanged_sentences', {});
}

export function useDocumentSection(section: string) {
  return useAnalyticsQuery('document_section', { section: sql.string(section) });
}

export function useCitationDetail(citationId: string) {
  return useAnalyticsQuery('citation_detail', { citation_id: sql.string(citationId) });
}

/** Runs only when mounted: mount it when the reviewer clicks "Recompute from source". */
export function useRecomputeFigures() {
  return useAnalyticsQuery('recompute_figures', {});
}

/** Table 14.2.1 at version 3 and now, for the TLF pane. */
export function useTlfTable() {
  const q = useAnalyticsQuery('tlf_table', {});
  return { ...q, data: (q.data as TlfCell[] | null) ?? null };
}
