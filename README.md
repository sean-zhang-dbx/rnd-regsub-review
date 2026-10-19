# rnd-regsub-review

A regulatory reviewer can't tell which sentences in the CSR, Module 2 and the label carry wrong numbers after a certified analysis table is restated, and finding them costs days of manual cross-checking on the critical path to submission. This demo shows that with Databricks they see every affected sentence within seconds. The corrected figures are recomputed from the certified source, and the single wording change that still needs a person is flagged for them.

All data is synthetic. The demo uses 1 fictional Phase III study, `LMN-301` (LMN-4471 400 mg once daily vs placebo, 52 weeks), so no GSK product or data appears.

The full plan is in `docs/DEMO_PLAN.md`, and every workspace object is listed in `docs/RESOURCES.md`.

## The beats

1. **What did this change break?** The opening screen shows that Biostatistics restated `efficacy_primary` (version 3 to 4). The restatement touches 7 sentences in 4 sections, and 6 safety sentences stay unchanged. AI Search also finds 2 documents outside the dossier that still quote the old result. "Notify owners" records a hand-off for each one.
2. **Where did this number come from?** Open CSR 11.4.1 and hover a figure. The citation card shows the certified table, row, column, version and certification.
3. **Hero: fix the numbers, but tell me where the meaning changed.** Click "Recompute from source". SQL recomputes every figure (412 of 618 becomes 409 of 618, and 66.7% becomes 66.2%). A traced model call through Unity Gateway reads each updated sentence and flags "about two-thirds" for the writer. The label sentence goes to Labelling.
4. **Can I trust the fix?** Ask the Genie Agent "How many participants in the treatment arm met the primary endpoint after the restatement?" It answers 409 of 618 and shows its SQL. Approve the figures, and a named sign-off is written to `review_signoffs`.

Presenter toggle: press `D`, or use the "Databricks" switch at the top right, to show the "See it in Databricks" links. They are hidden by default.

## Databricks features used

Statuses come from plan section 3 and the Azure release notes up to 19 Oct 2026, unless an item is marked unverified.

| Feature | Used for | Status |
|---|---|---|
| Delta table version history (`DESCRIBE HISTORY`, `VERSION AS OF`) on a Unity Catalog table | Comparing version 3 and version 4 of `efficacy_primary` | GA |
| Unity Catalog certification tag and column lineage | The certified tables and the citation card | GA |
| Unity Catalog volume, `ai_parse_document` | Storing and parsing the 6 PDFs outside the dossier | GA |
| AI Search (hybrid, Delta Sync index on `sz-shared-vs`) | Finding documents that still quote the old result | GA |
| Unity Gateway model service with an inference table, routing to `databricks-claude-sonnet-5-5` | The wording check | GA (Unity Gateway since 4 Aug 2026) |
| MLflow 3 tracing, through the `mlflow-tracing` Node SDK | Tracing every wording-check call | GA (MLflow 3 tracing); Node SDK status unverified |
| Genie Agent and Conversation API, on behalf of the user | Beat 4 question | GA |
| SQL warehouse (AppKit analytics plugin) | Every query in `config/queries/` | GA |
| Databricks Apps (AppKit) | The app | GA |

No Preview feature is on the main path. The model service rejects `temperature`, so the wording check doesn't set it. It relies on a JSON-only prompt instead, and its verdicts were stable over 3 runs.

## Run it

Workspace profile `fe-vm-sean-zhang`. Global pnpm 12 breaks installs on this Mac, so use a pnpm 11 shim:

```bash
mkdir -p /tmp/shim && printf '#!/bin/bash\nexec npx -y pnpm@11.0.8 "$@"\n' > /tmp/shim/pnpm && chmod +x /tmp/shim/pnpm
export PATH=/tmp/shim:$PATH DATABRICKS_CONFIG_PROFILE=fe-vm-sean-zhang
pnpm install
pnpm run dev          # http://localhost:8000
```

Set `DATABRICKS_CONFIG_PROFILE`, because 2 profiles share this host and typegen reports every query as OFFLINE without it.

## Rebuild and check the data

```bash
uv run --python 3.12 --with databricks-sql-connector --with databricks-sdk python scripts/check_must_be_true.py
```

This prints PASS or FAIL for the 9 must-be-true checks in plan section 4. Checks 6 to 8 call the running app (`APP_URL`, default `http://localhost:8000`). The data, PDFs, search index and Genie Agent are built by `scripts/generate_data.py`, `make_pdfs.py`, `build_search.py` and `create_genie.py`.

## Deploy

```bash
databricks bundle deploy -p fe-vm-sean-zhang
databricks bundle run app -p fe-vm-sean-zhang
```

After the first deploy, grant the app's service principal access to the data with `scripts/grant_app_sp.py <client-id>`, and give it EXECUTE on the model service `sean_zhang_catalog.rnd_regsub_review.wording_check`.
