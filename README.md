# CSR Pod on CDISC Pilot 01

A medical writing team usually takes weeks to get from final TLFs to a complete, checked CSR draft. This demo drafts the whole clinical study report of a real public study (CDISC Pilot 01, xanomeline TTS in mild to moderate Alzheimer's disease) from an empty ICH E3 template, ties every figure to a certified table cell, and scores each section against the CSR that was actually written for the study.

It is built for field use (first audiences: GSK R&D and the Elanco regulatory team). The approved plan is in [`docs/DEMO_PLAN.md`](docs/DEMO_PLAN.md), and every workspace object is listed in [`docs/RESOURCES.md`](docs/RESOURCES.md).

## The demo in 8 minutes

| Screen | What the audience sees |
|---|---|
| Scorecard (opening) | One headline (run time, 0 figures typed by a model, figures that match the submitted CSR) and one row per ICH E3 section. Only 12.2 is loud. |
| 1. Sources | The ADaM datasets in Unity Catalog, the certified TLF tables with lineage, and the 492-page CSR package parsed into elements. The protocol and SAP are searchable; the submitted report is locked away from the pod. |
| 2. Pod | The five agents of the pre-run, replayed. Open the CSR Author to see its skill, its tool calls and the AI Search passages it chose. |
| 3. Compare (hero) | Section 11.4.1 drafted by the pod next to the submitted CSR page. A tick column checks every figure against the printed Table 14-3.01, and the judge lists what the submitted writer said that the pod left to a person. |
| 4. Re-delivery and sign-off | Biostatistics re-delivers Table 14-5.01 with the corrected derivation (treatment-emergent events only). The pod finds every sentence that quoted a changed cell, redrafts 12.2 live, and the row turns quiet. Medical Writing, Biostatistics and Clinical Safety sign, and then Regulatory Affairs can release. |

Press `X` (or use the switch in the top line) to show the Databricks object behind each area, with a "See it in Databricks" link.

The re-delivery is a demo scenario: the data is unchanged, and version 1 of Table 14-5.01 used a deliberately incorrect derivation rule (all adverse events instead of treatment-emergent ones).

## Databricks features used

| Feature | Where | Status (22 Oct 2026) |
|---|---|---|
| Unity Catalog tables, certification tag, table lineage | Sources | GA |
| Unity Catalog volumes | Sources (PDF and page images) | GA |
| `ai_parse_document` | Sources (typed elements and page images) | GA |
| AI Search (formerly Vector Search), hybrid queries with filters | Sources, Pod | GA |
| Unity Gateway model service (Claude Sonnet 5.5, tool calling) | Pod | GA |
| MLflow 3 tracing | Pod, Compare | GA (the Node SDK `mlflow-tracing` used in the app has no published status) |
| Foundation Model API, `databricks-gpt-5-5` as the judge | Compare | GA |
| SQL warehouse (serverless) | all screens | GA |
| Lakeflow Jobs (serverless), "CSR Pod: TLF build" | Sources | GA |
| Delta table history, `VERSION AS OF`, `RESTORE` | Re-delivery | GA |
| Databricks Apps (AppKit) | all screens | GA |
| Agent Bricks CLI | production route only, not on the demo path | Beta |

All components on the demo path are GA. In production, I would build the five agents with the Agent Bricks CLI, which adds managed memory, sessions and deployment; it is in Beta, so the demo runs the agents inside the app instead.

## Scope

The demo covers ICH E3 sections 1 to 16. Laboratory and vital signs (sections 12.4 and 12.5, Tables 14-6.x and 14-7.x) are marked "not part of this demo" in the template and are excluded from the score. Adding them means building those TLF tables from ADLBC, ADLBH and ADVS in `scripts/tlf_build.py`, mapping their printed cells in `scripts/build_answer_key.py`, and switching the two sections from `not_in_demo` to `drafted` in `section_registry`.

## Data

The data comes from the CDISC SDTM/ADaM Pilot Project, study CDISCPILOT01 ("Safety and Efficacy of the Xanomeline Transdermal Therapeutic System (TTS) in Patients with Mild to Moderate Alzheimer's Disease"): https://github.com/cdisc-org/sdtm-adam-pilot-project (path `updated-pilot-submission-package/900172/m5/`).

It is used under the CDISC terms of use (file `CDISC.Pilot Project Data.Website Disclaimer.v1.pdf` in that repository): do not mislead about the origin of the data, do not disassemble, modify or alter any part of the data, do not distribute it without attribution to CDISC, and do not distribute it for a fee. In this demo:

- The five ADaM `.xpt` files are loaded into Delta with the same rows and values (checksums in `docs/RESOURCES.md`). The TLF tables are new tables derived from them; no source value is changed.
- `cdiscpilot01.pdf` is stored in the volume as downloaded and parsed whole. Retrieval is restricted by document part, never by cutting the file.
- Every screen carries the attribution line, and the drafted report is labelled as produced by this demo.
- The downloaded files are not committed to this repository (`data_raw/` is ignored).

## Run it

Workspace `fe-vm-sean-zhang`, schema `sean_zhang_catalog.rnd_csr_pod`, warehouse `16ad82bead3f55b5`.

```bash
# Install (the pinned pnpm; see the note below)
npx -y pnpm@11.0.8 install

# Data checks: TLF match report and the six "must be true" statements
uv run --python 3.12 --with databricks-sql-connector python scripts/check_tlfs.py
uv run --python 3.12 --with databricks-sql-connector python scripts/check_must_be_true.py

# Local production build on http://localhost:8010
pnpm build && pnpm start

# Click-through of every screen in beat order (changes state), then reset
uv run --with playwright python tools/ui_runthrough.py http://localhost:8010
uv run --python 3.12 --with databricks-sql-connector python scripts/reset_demo.py
```

Run the reset after every rehearsal. It deletes the sign-offs, restores Table 14-5.01 to version 1 and makes the pre-run the latest run again.

Rebuilding the data from scratch, in order: `scripts/download_cdisc.py`, `load_adam.py`, `parse_docs.py`, `tlf_build.py`, `build_answer_key.py`, `pod_data.py`, then a full pod run (`POST /api/csr-run`) recorded as the pre-run.

Note: on a machine where the global pnpm is a 12.0 release candidate, AppKit's scripts fail; use a pnpm 11.0.8 shim (`npx -y pnpm@11.0.8`).

## Deploy

```bash
databricks bundle deploy -p fe-vm-sean-zhang && databricks bundle run app -p fe-vm-sean-zhang
uv run --python 3.12 --with databricks-sql-connector python scripts/grant_app_sp.py <app-service-principal-client-id>
```
