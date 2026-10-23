/*
 * What stands behind each part of the screen. One entry per marker, in the order of the plan's X-ray table
 * (docs/DEMO_PLAN.md section 2). Statuses are the ones in the plan's section 3 mapping.
 */
export type XRayEntry = {
  id: string;
  /** Where on screen the marker sits. */
  area: string;
  /** Databricks object names, as in the plan. */
  objects: string[];
  status: string;
  /** Two or three plain sentences. The screen itself stays quiet. */
  text: string;
  code?: { label: string; body: string };
  /** Key in config/demo-links.json. */
  linkKey: string;
  linkLabel: string;
};

const S = 'sean_zhang_catalog.rnd_csr_pod';

export const XRAY: Record<string, XRayEntry> = {
  scorecard: {
    id: 'scorecard',
    area: 'Scorecard strip',
    objects: [`${S}.csr_scores`, 'Judge traces (MLflow)'],
    status: 'GA',
    text: 'One row per drafted section. Figures matched is the count of drafted figures equal to the printed value in the submitted CSR. Coverage is a 1 to 5 score from a judge on a second model family (databricks-gpt-5-5) against the submitted section text.',
    code: {
      label: 'SQL',
      body: `SELECT section, figures_total, figures_matched, coverage_score\nFROM ${S}.csr_scores\nWHERE run_id = :run_id\nORDER BY section;`,
    },
    linkKey: 'beat3_scores',
    linkLabel: 'Scores table in Catalog Explorer',
  },
  sources_adam: {
    id: 'sources_adam',
    area: 'Sources: analysis data',
    objects: [`${S}.adam_adsl`, `${S}.adam_adae`, `${S}.adam_adqsadas`, `${S}.adam_adqscibc`, `${S}.adam_adtte`],
    status: 'GA',
    text: 'The five ADaM datasets loaded from the CDISC .xpt files with the same rows and values. A checksum per table is compared with the file.',
    linkKey: 'beat1_adam',
    linkLabel: 'ADaM tables in Catalog Explorer',
  },
  sources_tlf: {
    id: 'sources_tlf',
    area: 'Sources: certified tables',
    objects: [`${S}.tlf_*`, 'Certification tag system.certification_status', 'Table lineage'],
    status: 'GA',
    text: 'A Lakeflow Job builds the TLF tables from the ADaM tables and tags them as certified. Unity Catalog records the lineage from each ADaM table to the tables built from it, and the graph on this screen reads it from system.access.table_lineage.',
    code: { label: 'SQL', body: `SELECT * FROM ${S}.tlf_14_3_01_adascog_w24\nORDER BY row_order;` },
    linkKey: 'beat1_tlf',
    linkLabel: 'Lineage of the TLF tables',
  },
  sources_docs: {
    id: 'sources_docs',
    area: 'Sources: documents',
    objects: ['Volume source_docs', `${S}.doc_elements`, 'ai_parse_document'],
    status: 'GA',
    text: 'The 492-page PDF sits in a volume as downloaded. ai_parse_document turns it into typed elements with page and box coordinates, and each page is tagged by part. The parts that belong to the submitted CSR are excluded from search and are used for scoring.',
    code: {
      label: 'SQL',
      body: `SELECT doc_part, MIN(page) AS page_from, MAX(page) AS page_to, COUNT(*) AS elements\nFROM ${S}.doc_elements\nGROUP BY doc_part;`,
    },
    linkKey: 'beat1_docs',
    linkLabel: 'Document elements in Catalog Explorer',
  },
  sources_search: {
    id: 'sources_search',
    area: 'Sources: search',
    objects: ['AI Search index doc_elements_index', `${S}.doc_chunks`],
    status: 'GA',
    text: 'A hybrid index over the parsed document. The planner and the author query it with a doc_part filter for the protocol and the SAP, and choose the passages themselves.',
    code: { label: 'Filter', body: "doc_part IN ('protocol', 'sap')" },
    linkKey: 'beat1_search',
    linkLabel: 'Index in Databricks',
  },
  pod: {
    id: 'pod',
    area: 'Pod',
    objects: ['MLflow experiment of the run', `${S}.csr_runs`, `${S}.csr_sections`],
    status: 'GA (MLflow tracing); status of the Node SDK is unverified',
    text: 'The model calls and tool calls of a run are recorded as one MLflow trace. The pod on this screen is replayed from the stored events of the pre-run.',
    linkKey: 'beat2',
    linkLabel: 'Trace of the run',
  },
  pod_agents: {
    id: 'pod_agents',
    area: 'Pod: agents',
    objects: [`Unity Gateway model service ${S}.csr_author`, 'Claude Sonnet 5.5'],
    status: 'GA since 4 Aug 2026',
    text: 'Each agent calls the model service through an OpenAI-compatible chat completions route with tool calling. The inference table is on.',
    linkKey: 'beat2_gateway',
    linkLabel: 'Model service in Databricks',
  },
  compare: {
    id: 'compare',
    area: 'Compare',
    objects: [`${S}.tlf_14_3_01_adascog_w24`, `${S}.submitted_tlf_cells`, `${S}.csr_figure_citations`],
    status: 'GA',
    text: 'SQL fills every figure from the certified cell and records the cell in csr_figure_citations. The printed value comes from the parsed submitted page. A tick means the two strings are equal at the printed precision. The box on the page comes from the position of the printed number in the PDF text layer.',
    code: {
      label: 'SQL',
      body: `SELECT c.slot, c.value_text AS drafted, p.printed_value AS printed\nFROM ${S}.csr_figure_citations c\nJOIN ${S}.submitted_tlf_cells p\n  ON p.tlf = c.tlf AND p.row_key = c.row_key AND p.column_name = c.column_name\nWHERE c.run_id = :run_id AND c.section = '11.4.1';`,
    },
    linkKey: 'beat3',
    linkLabel: 'Certified table in Catalog Explorer',
  },
  redelivery: {
    id: 'redelivery',
    area: 'Re-delivery',
    objects: [`${S}.tlf_14_5_01_teae`, 'Delta table history'],
    status: 'GA',
    text: 'Version 1 counted every adverse event, and version 2 keeps treatment-emergent events as the SAP specifies. Delta keeps both versions, so a draft stays bound to the version it quoted. The CDISC data is not modified; the two versions differ in the derivation rule of the TLF code.',
    code: { label: 'SQL', body: `DESCRIBE HISTORY ${S}.tlf_14_5_01_teae;\nSELECT * FROM ${S}.tlf_14_5_01_teae VERSION AS OF 1;` },
    linkKey: 'beat4',
    linkLabel: 'Table history in Catalog Explorer',
  },
  signoff: {
    id: 'signoff',
    area: 'Sign-off',
    objects: [`${S}.csr_signoffs`],
    status: 'GA',
    text: 'A sign-off is a row with the run, the department, the decision and the table versions the signer checked. Regulatory Affairs is refused until the other three departments have approved the same run.',
    code: { label: 'SQL', body: `SELECT department, signer, decision, table_versions_json, signed_at\nFROM ${S}.csr_signoffs\nWHERE run_id = :run_id;` },
    linkKey: 'beat4_signoffs',
    linkLabel: 'Sign-offs table in Catalog Explorer',
  },
};
