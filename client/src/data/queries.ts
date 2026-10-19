import { useAnalyticsQuery } from '@databricks/appkit-ui/react';
import { sql } from '@databricks/appkit-ui/js';

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
