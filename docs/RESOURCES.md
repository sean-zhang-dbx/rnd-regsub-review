# Resources: rnd_csr_pod

Ledger of every workspace object this demo creates. Builders append a row as they create something.
Workspace: `fe-vm-sean-zhang` (https://fevm-sean-zhang.cloud.databricks.com), warehouse `16ad82bead3f55b5`.
All tables are in `sean_zhang_catalog.rnd_csr_pod`; each table URL is `https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_csr_pod/<table>`.

| Type | Name | Id | URL | Created |
|---|---|---|---|---|
| Schema | `sean_zhang_catalog.rnd_csr_pod` (tags `sz_domain=rnd`, `sz_project=csr_pod`, `asset_class=app`) | | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_csr_pod | 2026-10-22 |
| Volume | `source_docs` (cdiscpilot01.pdf unchanged, adam_xpt/ originals) | 69b355ea-84fa-4375-b005-50d0271acd71 | https://fevm-sean-zhang.cloud.databricks.com/explore/data/volumes/sean_zhang_catalog/rnd_csr_pod/source_docs | 2026-10-22 |
| Volume | `parsed_pages` (492 page images from ai_parse_document) | c46a540b-f48b-4034-a64a-b1e3e6ddb81c | https://fevm-sean-zhang.cloud.databricks.com/explore/data/volumes/sean_zhang_catalog/rnd_csr_pod/parsed_pages | 2026-10-22 |
| Tables (ADaM) | `adam_adsl`, `adam_adae`, `adam_adqsadas`, `adam_adqscibc`, `adam_adtte` | | see above | 2026-10-22 |
| Tables (documents) | `doc_parsed_raw`, `doc_elements`, `doc_pages`, `doc_chunks` | | see above | 2026-10-22 |
| Tables (TLF, certified) | `tlf_14_1_01_populations`, `tlf_14_1_02_disposition`, `tlf_14_2_01_demographics`, `tlf_14_3_01_adascog_w24`, `tlf_14_3_02_cibic_w24`, `tlf_14_4_01_exposure`, `tlf_14_5_01_teae`, `tlf_14_5_02_sae`, plus `tlf_formats` (printed precision) and `demo_state` (opening state for reset) | | see above | 2026-10-22 |
| Tables (answer key) | `submitted_csr_sections`, `submitted_tlf_cells` | | see above | 2026-10-22 |
| Tables (pod) | `study_metadata`, `narrative_patients`, `section_registry`, `csr_runs`, `csr_sections`, `csr_figure_citations`, `csr_signoffs`, `csr_scores` | | see above | 2026-10-22 |
| AI Search index | `sean_zhang_catalog.rnd_csr_pod.doc_elements_index` (Delta Sync, hybrid, endpoint `sz-shared-vs`, databricks-gte-large-en) | | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_csr_pod/doc_elements_index | 2026-10-22 |
| Unity Gateway model service | `sean_zhang_catalog.rnd_csr_pod.csr_author` (routes to `system.ai.databricks-claude-sonnet-5-5`, inference table on) | | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_csr_pod | 2026-10-22 |
| Table | `csr_author_payload` (inference table of the model service) | | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_csr_pod/csr_author_payload | 2026-10-22 |
| MLflow experiment | `/Users/sean.zhang@databricks.com/rnd_csr_pod` | 1287687295923748 | https://fevm-sean-zhang.cloud.databricks.com/ml/experiments/1287687295923748 | 2026-10-22 |
| Lakeflow Job | "CSR Pod: TLF build" (serverless, runs `tlf_build.py --teae-rule v1`; script copy in workspace folder `/Users/sean.zhang@databricks.com/rnd_csr_pod_files/scripts`) | 1105979386503028 | https://fevm-sean-zhang.cloud.databricks.com/jobs/1105979386503028 | 2026-10-22 |
| Databricks App | `rnd-csr-pod` (service principal `app-3qhbxn rnd-csr-pod`, client id 4d765391-7acd-4a85-9b11-015351699f2f) | | https://rnd-csr-pod-7474654216647582.aws.databricksapps.com | 2026-10-23 |
| Workspace folder | `/Users/sean.zhang@databricks.com/rnd_csr_pod_files/scripts` (`tlf_build.py`, `tlf_defs.py` for the job) | | | 2026-10-22 |

Deviations recorded: the tag `source=cdisc_pilot01` is not set because the workspace tag policy for key `source` allows only `genie-finance` and `genie-dataeng`; every table comment ends with the CDISC source line instead.

## Checksums (ADaM tables vs `.xpt`)

Source files (SHA-256 of the downloaded file, verified before every load):

| File | SHA-256 |
|---|---|
| adsl.xpt | c5139f873a93ef6add77bc4297beb6460a398bbdd036874382a9f39dfc92091d |
| adae.xpt | b8678e70946473a753bb01d002917f478bf51b59bdd0dc19587b97128059b6a0 |
| adqsadas.xpt | ac3fa1217651810b0f15fe489fdda7d99eff10553ded025156ad7c1b89f84608 |
| adqscibc.xpt | 16e7118f606d907e817f0a5885d662c2e7177c430d2b3ec6c0ba9096cb3d7bc1 |
| adtte.xpt | 68513fc4126744b6b2c7328eb70eb7b9683865d12c58b36539325f3c0c0ab93d |
| cdiscpilot01.pdf (uploaded unchanged) | 0cab016c76abb3dcaef31110611c95dbd9cd00df083b35e6d28fd69fca0d842d |

Content checksum per Delta table (SHA-256 over the canonical text of the sorted rows; computed on the decoded `.xpt` and on the Delta read-back, equal; stored as table properties `content_checksum` and `xpt_sha256`). The `.xpt` files are decoded with pyreadstat, because pandas `read_sas` decodes a SAS 0 as 5.397605346934028e-79; the two decoders agree on every other value. SAS dates (days since 1960-01-01) are DATE columns, SAS missing numerics are NULL.

| Table | Rows | Columns | Content checksum |
|---|---|---|---|
| adam_adsl | 254 | 48 | 2903d0f252b573d6720f5cd428cb1344d38f0d26f6e5b84fa58235d0ba93a3e5 |
| adam_adae | 1191 | 55 | 9b72d626b98075c9d4a645c5df874e17ea6f178b1b8832e4cfbdc750df115615 |
| adam_adqsadas | 12463 | 40 | ffc90d6a7d0d9561c7acd8450cff19530005a2c4c5bb68f3bf8a23b5a6f8bdf0 |
| adam_adqscibc | 730 | 36 | 51ad3d297330a5340123f9e27e7a349afd04e467f5286d04a2bddef004eb603f |
| adam_adtte | 254 | 26 | 2364d1fd79eb02c43ea527b1f93c896f7ceed394398fd4673b02689ba95ace9a |

## Page ranges per `doc_part`

Confirmed from the headings of the parsed document (`ai_parse_document` version 2.0, 492 pages, 4,533 elements). Differences from the plan's "about" ranges are in the last column.

| doc_part | Pages | Elements | Heading evidence | Searchable by the pod |
|---|---|---|---|---|
| csr_body | 1 to 41 | 361 | p1 "1. TITLE PAGE", p41 "13. DISCUSSION OF STUDY RESULTS AND CONCLUSIONS" | no (answer key, not indexed) |
| csr_tlf | 42 to 151 | 774 | p42 "14. SUMMARY TABLES AND FIGURES" | no (answer key, not indexed) |
| references | 152 | 7 | p152 "15. REFERENCES" | not indexed in the filter |
| appendix_index | 153 | 7 | p153 "16. APPENDICES / Appendix 1" (plan: 153 to 156; the protocol title page is p154) | not in the filter |
| protocol | 154 to 204 | 343 | p154 "Protocol H2Q-MC-LZZT(c)", p158 "1. Introduction", p204 "6. References" (plan: about 157 to 215) | yes |
| protocol_appendix | 205 to 415 | 2327 | p205 "Protocol Attachment LZZT.1" to p415 "Appendix 8" (plan: about 216 to 415) | no |
| sap | 416 to 465 | 489 | p416 "Appendix 9. Statistical Analysis Plan", p421 "1. BACKGROUND", p465 SAP appendix 3 (plan: about 416 to 464) | yes |
| other | 466 to 492 | 225 | p466 SAS output "Ad hoc Template 1" to p492 "Appendix 14" (analysis output carrying results is deliberately outside the SAP part) | no |

The index holds 966 chunks of protocol, protocol_appendix, sap, references, appendix_index and other pages; csr_body and csr_tlf are not chunked. Retrieval filter: `doc_part IN ('protocol', 'sap')`.

## Round 3 (23 Oct 2026)
| Type | Name | Id | URL | Date |
|---|---|---|---|---|
| Table columns | `sean_zhang_catalog.rnd_csr_pod.submitted_tlf_cells` (added `box_x0`, `box_y0`, `box_x1`, `box_y1`) | n/a | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_csr_pod/submitted_tlf_cells | 2026-10-23 |
| Stored value | `csr_runs.document_checks_json` of `csr-20261022151451-54d7fc` (table-reference check recomputed) | n/a | n/a | 2026-10-23 |
