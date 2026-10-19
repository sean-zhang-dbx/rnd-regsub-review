# Resources: rnd_regsub_review

Every workspace object this demo creates. "See it in Databricks" links and teardown both come from this file.
Workspace: `fe-vm-sean-zhang` (https://fevm-sean-zhang.cloud.databricks.com)
Repo: https://github.com/sean-zhang-dbx/rnd-regsub-review (private, topics `account-gsk`, `app`, `demo`, `domain-rnd`, created 2026-10-19)

| Type | Name | ID | URL | Created |
|---|---|---|---|---|
| Schema | `sean_zhang_catalog.rnd_regsub_review` (tags `sz_domain=rnd`, `sz_project=regsub_review`, `asset_class=app`) | | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_regsub_review | 2026-10-19 |

Shared, not owned by this demo: SQL warehouse `Serverless Starter Warehouse` (`16ad82bead3f55b5`), AI Search endpoint `sz-shared-vs`, serving endpoint `databricks-claude-sonnet-5-5`.
| Table | `sean_zhang_catalog.rnd_regsub_review.adsl` (tags) | a table | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_regsub_review/adsl | 2026-10-19 |
| Table | `sean_zhang_catalog.rnd_regsub_review.adeff` (tags) | | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_regsub_review/adeff | 2026-10-19 |
| Table | `sean_zhang_catalog.rnd_regsub_review.efficacy_primary` (certified, Delta versions 0 to 4) | a7b915f3-a905-4510-9db9-e258d323b955 | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_regsub_review/efficacy_primary | 2026-10-19 |
| Table | `sean_zhang_catalog.rnd_regsub_review.safety_overview` (certified) | | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_regsub_review/safety_overview | 2026-10-19 |
| Table | `sean_zhang_catalog.rnd_regsub_review.document_sentences` | | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_regsub_review/document_sentences | 2026-10-19 |
| Table | `sean_zhang_catalog.rnd_regsub_review.figure_citations` | | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_regsub_review/figure_citations | 2026-10-19 |
| Table | `sean_zhang_catalog.rnd_regsub_review.wording_checks` | | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_regsub_review/wording_checks | 2026-10-19 |
| Table | `sean_zhang_catalog.rnd_regsub_review.review_signoffs` | 2ae1c799-f031-448a-b6dd-f6be79f72ad1 | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_regsub_review/review_signoffs | 2026-10-19 |
| Table | `sean_zhang_catalog.rnd_regsub_review.doc_chunks` (Change Data Feed on) | | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_regsub_review/doc_chunks | 2026-10-19 |
| Volume | `sean_zhang_catalog.rnd_regsub_review.source_docs` (6 PDFs) | 6500b0be-4e46-400a-8f7b-c85ca065de13 | https://fevm-sean-zhang.cloud.databricks.com/explore/data/volumes/sean_zhang_catalog/rnd_regsub_review/source_docs | 2026-10-19 |
| AI Search index | `sean_zhang_catalog.rnd_regsub_review.doc_chunks_index` (Delta Sync, hybrid, endpoint `sz-shared-vs`) | | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_regsub_review/doc_chunks_index | 2026-10-19 |
| Unity Gateway model service | `sean_zhang_catalog.rnd_regsub_review.wording_check` (routes to `system.ai.databricks-claude-sonnet-5-5`, inference logging on) | | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_regsub_review | 2026-10-19 |
| Table | `sean_zhang_catalog.rnd_regsub_review.wording_check_payload` (inference table of the model service) | 96039b9e-31de-4c8c-8af0-b88748dc2142 | https://fevm-sean-zhang.cloud.databricks.com/explore/data/sean_zhang_catalog/rnd_regsub_review/wording_check_payload | 2026-10-19 |
| Genie Agent | Regsub Review: LMN-301 certified tables | 01f1cbc34f071871a047d7a3489ce6d3 | https://fevm-sean-zhang.cloud.databricks.com/genie/rooms/01f1cbc34f071871a047d7a3489ce6d3 | 2026-10-19 |
| MLflow experiment | `/Users/sean.zhang@databricks.com/rnd_regsub_review` | 1752849192687853 | https://fevm-sean-zhang.cloud.databricks.com/ml/experiments/1752849192687853 | 2026-10-19 |

Notes: the schema has predictive optimization disabled so the Delta versions of `efficacy_primary` stay at 0 to 4. The shared endpoint `databricks-claude-sonnet-5-5` had its legacy AI Gateway inference-table setting touched once during testing and was set back to disabled (`enabled: false`, usage tracking still on); the stray table `gw_payload` was dropped.
