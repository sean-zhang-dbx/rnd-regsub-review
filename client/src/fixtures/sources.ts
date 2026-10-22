import type { Sources } from '../data/types';

/* FIXTURE. Row counts are the ones named in the plan; the rest is invented. */
export const sourcesFixture: Sources = {
  adam: [
    { table: 'adam_adsl', rows: 254, columns: 49, checksum_ok: true },
    { table: 'adam_adae', rows: 1191, columns: 55, checksum_ok: true },
    { table: 'adam_adqsadas', rows: 12463, columns: 44, checksum_ok: true },
    { table: 'adam_adqscibc', rows: 730, columns: 41, checksum_ok: true },
    { table: 'adam_adtte', rows: 254, columns: 26, checksum_ok: true },
  ],
  tlfs: [
    { table: 'tlf_14_1_01_populations', tlf: 'Table 14-1.01', version: 1, certified: true, upstreams: ['adam_adsl'] },
    { table: 'tlf_14_1_02_disposition', tlf: 'Table 14-1.02', version: 1, certified: true, upstreams: ['adam_adsl'] },
    { table: 'tlf_14_2_01_demographics', tlf: 'Table 14-2.01', version: 1, certified: true, upstreams: ['adam_adsl'] },
    { table: 'tlf_14_3_01_adascog_w24', tlf: 'Table 14-3.01', version: 1, certified: true, upstreams: ['adam_adsl', 'adam_adqsadas'] },
    { table: 'tlf_14_3_02_cibic_w24', tlf: 'Table 14-3.02', version: 1, certified: true, upstreams: ['adam_adsl', 'adam_adqscibc'] },
    { table: 'tlf_14_4_01_exposure', tlf: 'Table 14-4.01', version: 1, certified: true, upstreams: ['adam_adsl'] },
    { table: 'tlf_14_5_01_teae', tlf: 'Table 14-5.01', version: 1, certified: true, upstreams: ['adam_adsl', 'adam_adae'] },
    { table: 'tlf_14_5_02_sae', tlf: 'Table 14-5.02', version: 1, certified: true, upstreams: ['adam_adsl', 'adam_adae'] },
  ],
  docs: {
    file: 'cdiscpilot01.pdf',
    pages: 492,
    parts: [
      { doc_part: 'csr_body', page_from: 1, page_to: 41, elements: 1020, searchable: false },
      { doc_part: 'csr_tlf', page_from: 42, page_to: 151, elements: 2660, searchable: false },
      { doc_part: 'protocol', page_from: 157, page_to: 215, elements: 1140, searchable: true },
      { doc_part: 'protocol_appendix', page_from: 216, page_to: 415, elements: 2310, searchable: false },
      { doc_part: 'sap', page_from: 416, page_to: 464, elements: 980, searchable: true },
    ],
  },
  index: { name: 'doc_elements_index', chunks: 1984 },
};
