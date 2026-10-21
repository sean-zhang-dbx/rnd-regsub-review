# Build contract: the CSR Pod (full-CSR demo), 21 Oct 2026

Source of truth for the M1 to M3 build. Read with `docs/HANDOFF_full_csr_build.md` and `docs/PRD_document_drafting.md` Part B.
Decisions from Sean (21 Oct): the full CSR is drafted by an **agent pod** (the concept from the Agent Pods UX, `~/agent-platform-ux/client/src/viz/PodFlow.tsx`), laid out in **5 columns with a Planner**, the agents are **real tool-calling agents** (a model loop that picks its own tools), and **departmental sign-off is real** (stored, release blocked until every department has signed).

Rule 1 still holds: do not change or regenerate the existing tables, PDFs, element ids, `source_citations`, the AI Search index or the 4-step flow. Only add.

## 1. The pod

A pod is a team running a process. Work flows left to right through handoffs. Each agent is a skill (its instructions), its tools (ACTS) and the agents or services it calls (CALLS), and each acts for a responsible department.

| Column | Member | Acts for | HOW (skill) | ACTS (tools, real names in code) | CALLS |
|---|---|---|---|---|---|
| Context | Certified context | (Unity Catalog) | | | Certified TLF tables (Unity Catalog), parsed Protocol v3 and SAP v2 (`ai_parse_document`), section registry |
| Plan | Document Planner | Medical Writing | `csr-planning` | `read_registry`, `list_certified_tables`, `find_passages`, `save_plan` | AI Search |
| Draft & check (parallel) | CSR Author Agent | Medical Writing | `csr-authoring` | `get_section_brief`, `search_documents`, `save_csr_draft` | AI Search |
| | Safety Narrative Agent | Clinical Safety | `safety-narratives` | `list_narrative_patients`, `get_patient_record`, `save_narrative` | (none) |
| | QC & Consistency Agent | Biostatistics | `csr-qc` | `run_section_checks`, `judge_section`, `tick_and_tie`, `flag_for_person` | LMN-301 Genie Agent, GPT 5.5 judge |
| Assemble | CSR Assembler | Regulatory Operations | `ich-e3-assembly` | `assemble_fixed_parts`, `run_document_checks`, `finalise_document` | (none) |
| Sign-off | Departmental sign-off | Medical Writing, Biostatistics, Clinical Safety, Regulatory Affairs | | | Nothing is released until the responsible people sign |

Edges: Context to Plan `registry + catalogue`, Plan to Draft `plan`, Draft to Assemble `sections + findings`, Assemble to Sign-off `draft`.

Waves inside "Draft & check": wave 1 = all drafted sections without dependencies (7, 8, 9, 10, 11.1, 11.2, 11.4.1, 11.4.2, 11.4.3, 12.1, 12.2, 12.3) and all narratives, in parallel; QC runs on each section as soon as it is saved. Wave 2 = 13 (needs 11.x and 12.x). Wave 3 = 2 Synopsis (needs everything). The model never sees a figure value: briefs list placeholder names and descriptions only, and synopsis and discussion are drafted from the other sections' templates (placeholders, not values).

Fictional people (named approvers; there is no native e-signature, so the UI says "Named approver"):
- Medical Writing: Dr. Hannah Reid, CSR Lead
- Biostatistics: Tom Okoye, Lead Statistician
- Clinical Safety: Dr. Leila Haddad, Safety Physician
- Regulatory Affairs: Dr. Amara Okafor, Regulatory Review (existing reviewer)

## 2. Data (M1, owned by the data build, `scripts/generate_csr_data.py`)

Schema `sean_zhang_catalog.rnd_regsub_review`. Fixed seed. Python 3.12 + Databricks Connect serverless like `scripts/generate_data.py`, or the SQL connector via `scripts/dbx.py`. Read `adsl` (do not modify it). All new tables get tags `sz_domain=rnd`, `sz_project=regsub_review`, `asset_class=app` and a table comment that says synthetic data.

Existing facts to reproduce exactly: adsl 1,227 (TRT "LMN-4471 400 mg" 618, Placebo 609; F 735 / M 492; mean age about 54; 10 countries, 62 sites). safety_overview: TRT n 618, any TEAE 441, SAE 53, AE discontinuation 38, deaths 2; PBO 609, 419, 41, 22, 3. efficacy_primary v3: TRT 412/618, PBO 287/609.

### 2.1 Analysis datasets (not certified)
- `adsl_ext` (usubjid, region `Europe`/`North America`/`Asia-Pacific` derived from adsl.country, baseline_severity `Moderate`/`Severe`, bmi DOUBLE, race STRING, pp_fl `Y`/`N`, saffl `Y`)
- `adds` disposition (usubjid, arm, dsdecod `COMPLETED` or a reason: `ADVERSE EVENT`, `LACK OF EFFICACY`, `WITHDRAWAL BY SUBJECT`, `LOST TO FOLLOW-UP`, `DEATH`, `OTHER`, dsstdy INT study day). AE discontinuations: TRT 38, PBO 22 (match safety_overview). Deaths: TRT 2, PBO 3.
- `addv` protocol deviations (usubjid, arm, dvcat, severity `Major`/`Minor`, excl_pp `Y`/`N`); per-protocol set = randomised minus subjects with an excluding major deviation (consistent with adsl_ext.pp_fl).
- `adex` exposure (usubjid, arm, trtdurd INT days, cumdose_mg DOUBLE, compliance_pct DOUBLE)
- `adae` adverse events (usubjid, arm, aesoc, aedecod, aeser `Y`/`N`, aerel `RELATED`/`NOT RELATED`, aeacn e.g. `DRUG WITHDRAWN`, aeout e.g. `RECOVERED/RESOLVED`, `FATAL`, aestdy INT, aeendy INT, aesev `MILD`/`MODERATE`/`SEVERE`). Subject counts must reproduce safety_overview exactly: subjects with any TEAE, with any SAE (aeser=Y), with aeacn=DRUG WITHDRAWN, with aeout=FATAL, per arm. Use about 8 SOCs and 2 to 4 PTs each, realistic MedDRA names.
- `adeff_sec` secondary endpoints (usubjid, arm, paramcd `SYMCHG24`/`SYMCHG52` change in symptom score, `TTRESP` time to first response in days with cnsr flag, aval DOUBLE, cnsr INT)

### 2.2 Certified TLF tables
Built with `CREATE TABLE ... AS SELECT` from the analysis tables (so Unity Catalog lineage exists), then `ALTER TABLE ... SET TAGS ('system.certification_status' = 'certified')` plus the 3 project tags, plus table comment starting `CERTIFIED by Biostatistics. Table 14.x.x <title>.`, plus a `COMMENT` on every numeric column (the slot description is built from it).

Every TLF table has the same shape so slots can be generated generically:
- `row_key STRING` (upper snake case, unique within the table, e.g. `COMPLETED`, `DISC_AE`, `AGE_MEAN`, `SOC_INFECTIONS`, `PT_NASOPHARYNGITIS`)
- `row_label STRING` (human label, e.g. `Discontinued: adverse event`)
- `row_order INT`
- numeric columns only after that (INT or DOUBLE), rounded to the displayed precision (1 decimal for percentages and means, 2 for HR, 3 for p values), NULL where not applicable.

| Table | TLF | Alias (slot prefix) | Rows | Numeric columns |
|---|---|---|---|---|
| `tlf_14_1_1_disposition` | Table 14.1.1 | `disp` | RANDOMISED, TREATED, COMPLETED, DISCONTINUED, DISC_AE, DISC_LOE, DISC_WITHDRAWAL, DISC_LTFU, DISC_DEATH, DISC_OTHER, FAS, PPS, SAF | trt_n, trt_pct, pbo_n, pbo_pct, total_n |
| `tlf_14_1_2_demographics` | Table 14.1.2 | `demo` | AGE_MEAN, AGE_SD, AGE_GE65, FEMALE, MALE, REGION_EU, REGION_NA, REGION_APAC, SEV_MODERATE, SEV_SEVERE, BMI_MEAN | trt, trt_pct, pbo, pbo_pct, total |
| `tlf_14_2_2_pp` | Table 14.2.2 | `pp` | TRT, PBO, DIFF (same columns as efficacy_primary: n, responders, rate_pct, diff_pct, ci_low, ci_high), per-protocol set, using adeff | n, responders, rate_pct, diff_pct, ci_low, ci_high |
| `tlf_14_2_3_secondary` | Table 14.2.3 | `sec` | SYMCHG24, SYMCHG52 (LS mean change), TTRESP (median days) | trt, pbo, diff, ci_low, ci_high, p_value |
| `tlf_14_2_4_subgroups` | Table 14.2.4 | `sub` | AGE_LT65, AGE_GE65, SEX_F, SEX_M, REGION_EU, REGION_NA, REGION_APAC, SEV_MODERATE, SEV_SEVERE (responder rate at Week 52 using adeff v3 state is fine, current adeff is fine too; document which) | trt_n, trt_rate, pbo_n, pbo_rate, diff, ci_low, ci_high |
| `tlf_14_3_2_ae_soc_pt` | Table 14.3.2 | `ae` | ANY_TEAE first (must equal 441 and 419), then SOC_x and PT_x rows | trt_n, trt_pct, pbo_n, pbo_pct |
| `tlf_14_3_3_exposure` | Table 14.3.3 | `exp` | DUR_MEAN, DUR_SD, DUR_GE48W, CUMDOSE_MEAN, COMPL_MEAN | trt, trt_pct, pbo, pbo_pct |

Existing certified tables, used as they are: `efficacy_primary` (Table 14.2.1, alias `eff`, drafted at `VERSION AS OF 3`) and `safety_overview` (Table 14.3.1, alias `saf`, current version). They have `row_key` but no `row_label`/`row_order`; the engine handles that.

Slot names: `<alias>_<row_key lower>_<column>`, e.g. `disp_disc_ae_trt_n`, `eff_trt_responders`. Slot description: `<row_label or row_key>: <column comment>` plus `(Table 14.x.x)`.

### 2.3 Study metadata and narrative patients
- `study_metadata` (meta_key STRING, meta_value STRING, value_type `text`/`number`/`date`): study_id LMN-301, title, phase, compound LMN-4471, dose 400 mg once daily, sponsor "Fictional sponsor", indication text consistent with the protocol PDF, n_sites 62, n_countries 10, first_patient_in, last_patient_last_visit, database_lock 2026-10-12, report_date, coordinating_investigator (fictional), ethics statement. Number-valued keys become slots `meta_<key>` for sections 1, 5 and 6.
- `narrative_patients` (one row per patient for the narratives: all deaths plus SAEs leading to withdrawal, about 10 rows): row_key = usubjid, arm, age INT, sex, aedecod, aesoc, aestdy INT, aeendy INT, aeout, aeacn, aerel, trtdurd INT, plus a `narrative_reason` (`Death`, `SAE leading to discontinuation`). Not certified, but tagged; the engine binds narrative numbers from it (alias `pt`).

### 2.4 Section registry (`section_registry`)
Columns: section STRING, title STRING, ord INT, kind STRING (`assembled`, `boilerplate`, `drafted`, `narrative`), agent STRING (`planner`, `author`, `narrative`, `qc`, `assembler`), department STRING (`Medical Writing`, `Biostatistics`, `Clinical Safety`, `Regulatory Operations`), wave INT (1, 2, 3; NULL for assembled), instructions STRING (outline points, one per line, numbers allowed only for things like Week 52, 400 mg, 95%), source_passages STRING (JSON array of `{"doc": "%Protocol%" or "%SAP%", "like": "%exact phrase%", "page": n}`, each matching exactly 1 element in `doc_elements`), tlf_tables STRING (JSON array of `{"table": "tlf_14_1_1_disposition", "tlf": "Table 14.1.1", "alias": "disp", "version": null}`; efficacy_primary has version 3), depends_on STRING (JSON array of sections), required_content STRING (JSON array of short phrases the section must cover, used by the coverage check).

Sections, in `ord` order: 1 Title page (assembled), 2 Synopsis (drafted, wave 3, depends on all drafted), 3 Table of contents (assembled), 4 List of abbreviations (assembled), 5 Ethics (boilerplate), 6 Investigators and study administrative structure (boilerplate), 7 Introduction, 8 Study objectives, 9 Investigational plan, 10 Study patients (14.1.1), 11.1 Data sets analysed (14.1.1), 11.2 Demographic and other baseline characteristics (14.1.2), 11.4.1 Primary efficacy endpoint (efficacy_primary v3, 14.2.2), 11.4.2 Secondary efficacy endpoints (14.2.3), 11.4.3 Efficacy in subgroups (14.2.4), 12.1 Extent of exposure (14.3.3), 12.2 Adverse events (safety_overview, 14.3.2), 12.3 Deaths, other serious adverse events and other significant adverse events (safety_overview; narratives go in 12.3.2, kind `narrative` row `12.3.2`), 13 Discussion and overall conclusions (wave 2), 14 Tables, figures and graphs (assembled), 15 Reference list (assembled), 16 Appendices (assembled).

Source passages: query `doc_elements` for the Protocol v3 (6 pages) and SAP v2 (5 pages) and pick 1 to 3 passages per drafted section from sections 7 to 12 that really support it.

## 3. Engine (M2, `server/routes/csrRun.ts` and `server/lib/pod/*`)

Persisted tables (created by the data script, empty; the app SP gets MODIFY):
- `csr_runs` (run_id STRING, base_run_id STRING, status STRING `running`/`done`/`error`, started_at TIMESTAMP, finished_at TIMESTAMP, efficacy_version INT, sections_requested STRING JSON, plan_json STRING, document_checks_json STRING, genie_checks_json STRING, model STRING, judge_model STRING, trace_id STRING, wall_ms BIGINT)
- `csr_sections` (run_id, section, title, ord INT, kind, agent, department, status STRING `assembled`/`drafted`/`checked`/`needs_person`/`failed`, templates_json STRING, sentences_json STRING, sources_json STRING, checks_json STRING, judge_json STRING, needs_person_json STRING, tool_log_json STRING, trace_id STRING, drafted_at TIMESTAMP)
- `csr_figure_citations` (run_id, section, sentence_idx INT, slot STRING, source_table STRING, tlf STRING, row_key STRING, column_name STRING, table_version BIGINT, value_text STRING)
- `csr_signoffs` (signoff_id, run_id, department, scope STRING, signer STRING, role STRING, decision STRING `approved`/`changes_requested`, note STRING, table_versions_json STRING, signed_at TIMESTAMP)

### 3.1 API (all JSON; `client/src/data/csr.ts` types mirror these)

`GET /api/csr/pod` -> `PodDef`
```ts
type PodMember = { id: 'context'|'planner'|'author'|'narrative'|'qc'|'assembler'|'signoff'; kind: 'source'|'agent'|'gate';
  title: string; actsFor?: string; how?: { name: string; text: string }; acts?: string[]; calls?: string[]; note?: string };
type PodDef = { columns: { title: string; parallel?: boolean; edge?: string; members: PodMember['id'][] }[]; members: PodMember[];
  departments: { department: string; signer: string; role: string; scope: string; sections: string[] }[] };
```

`GET /api/csr/registry` -> `{ sections: RegistrySection[] }` (the registry rows, JSON columns parsed).

`POST /api/csr-run` body `{ sections?: string[] }` -> `{ run_id }`. No body = whole CSR. With sections = redraft only those (and re-run QC, document checks and assembly), copying the other sections from the latest done run. Runs in the background on the server; at most 1 run at a time (409 if busy).

`GET /api/csr-run/:id/events` -> server-sent events, replayed from the start for late subscribers, then live. Each event is one JSON `data:` line:
```ts
type PodEvent =
  | { type: 'run'; status: 'running'|'done'|'error'; run_id: string; at: string; error?: string; wall_ms?: number }
  | { type: 'agent'; agent: PodMember['id']; status: 'idle'|'running'|'done'|'error'; at: string; summary?: string; progress?: { done: number; total: number } }
  | { type: 'section'; section: string; status: 'planned'|'drafting'|'drafted'|'checked'|'needs_person'|'failed'|'assembled'; agent: PodMember['id']; at: string }
  | { type: 'tool'; agent: PodMember['id']; section?: string; tool: string; args: unknown; ok: boolean; result_summary: string; ms: number; at: string }
  | { type: 'log'; agent: PodMember['id']; section?: string; text: string; at: string };
```
A rejected `save_csr_draft` (typed figure, unknown placeholder) is a `tool` event with `ok: false` and the reason; the agent then fixes and saves again. This is the hero moment.

`GET /api/csr-run/latest` -> `CsrDocument | null` (latest run with status done). `GET /api/csr-run/:id` -> `CsrDocument`.
```ts
type Part = { text: string } | { slot: string; value: string; source_table: string; tlf: string; row_key: string; column_name: string; table_version: number };
type SourceRef = { kind: 'passage'; doc_title: string; file_path: string; page: number; element_id: number; quote: string } | { kind: 'tlf'; tlf: string; table: string } | { kind: 'writer' };
type Sentence = { template: string; parts: Part[]; sources: SourceRef[]; interpretation?: boolean };
type Check = { id: string; label: string; ok: boolean; detail?: string };
type NeedsPerson = { sentence_idx?: number; reason: string; kind: 'interpretation'|'check_failed'|'judge'|'qc_flag' };
type ToolCall = { tool: string; args: unknown; ok: boolean; result_summary: string; ms: number };
type CsrSection = { section: string; title: string; ord: number; kind: 'assembled'|'boilerplate'|'drafted'|'narrative'; agent: string; department: string;
  status: 'assembled'|'drafted'|'checked'|'needs_person'|'failed'; sentences: Sentence[]; html?: string; checks: Check[];
  judge?: { verdict: 'yes'|'no'|'unavailable'; reason: string; model: string }; needs_person: NeedsPerson[]; tool_log: ToolCall[]; trace_id: string | null; drafted_at: string | null };
type CsrDocument = { run_id: string; started_at: string; finished_at: string | null; wall_ms: number | null; efficacy_version: number; trace_id: string | null;
  model: string; judge_model: string; plan: { section: string; passages: SourceRef[]; tlfs: string[]; depends_on: string[]; wave: number | null }[];
  sections: CsrSection[]; document_checks: Check[]; genie_checks: { question: string; genie_value: string; bound_value: string; slot: string; table_version_note: string; ok: boolean }[];
  redelivery: { section: string; sentence_idx: number; slot: string; v3: string; v4: string }[] };
```
Assembled sections (1, 3, 4, 14, 15, 16) carry `html` (title page, contents list, abbreviations table, the TLF tables rendered from the certified tables, references, appendix list) and no model calls.

`GET /api/csr-run/:id/export.doc` -> HTML document served with `Content-Type: application/msword` and `Content-Disposition: attachment; filename="LMN-301_CSR_draft.doc"`. No new npm dependency.

`GET /api/csr/signoffs?run_id=` -> `{ signoffs: CsrSignoff[]; release_blocked_by: string[] }`. `POST /api/csr/signoff` body `{ run_id, department, decision: 'approved'|'changes_requested', note? }` -> writes `csr_signoffs` with the current table versions; Regulatory Affairs `approved` is refused with 409 until Medical Writing, Biostatistics and Clinical Safety have approved the same run.

## 4. UI (M3, page `/csr`, owned by the frontend build)

Match the existing look: tokens in `client/src/index.css`, patterns in `client/src/pages/Sources.tsx` and `Documents.tsx`, components from `@databricks/appkit-ui/react`, icons from `lucide-react`. No Databricks palette. No new npm dependency.

Opening screen of `/csr`, top to bottom:
1. **Header row**: "LMN-301 Clinical Study Report, draft" + run facts (run time, sections drafted, figures bound, document checks n of m passed) + buttons "Draft the whole CSR" (POST /api/csr-run) and "Export for Word".
2. **The pod** (port the look of `PodFlow.tsx` from `~/agent-platform-ux`: columns with uppercase titles, `parallel` tag, cards with HOW / ACTS / CALLS chip rows, curved connectors with edge labels, Sign-off gate card in a warm tint). Intro line: "A pod is a team running a process. Work flows left to right through handoffs. Each agent is a skill, its tools and the agents it calls, and each acts for a responsible department." During a run, cards show live status (running pulse, `progress` like "9 of 12 sections") from `agent` events. Clicking an agent card opens a drawer with its skill text (HOW), its tools and a **live tool-call log** from `tool` events (rejected saves shown in the attention colour with the reason, followed by the corrected save). The pod collapses to a one-line strip after the user scrolls or clicks "Show document".
3. **Workspace**, 3 panes: left = section tree in ICH E3 order with a status chip per section (assembled, drafted, checked, needs a person) and the agent that produced it; middle = the document (serif, page-like), sentences with figures highlighted (hover shows table, row, column, version, value) and small source chips (Protocol p3, SAP p2, Table 14.2.1); right = for the selected section: Sources, Checks, Judge, Needs a person, Agent tool calls, and "Redraft this section" (POST with sections=[id]).
4. **Re-delivery banner** at the top of the workspace when `redelivery` is not empty: "Table 14.2.1 was re-delivered (v3 to v4). n sentences in this draft cite cells that changed." with a link to the sentences and to `/review/csr-11.4.1-02?step=draft`.
5. **Accountability & sign-off** card under the workspace (like the screenshot): one row per department with scope, accountable department, named signer, a "Named approver" chip, status, and Sign / Request changes buttons; Regulatory Affairs release shows "blocked until 3 departments sign" until then. Each signature shows the table versions it was signed against.

Also: register `/csr` in `client/src/App.tsx`; in `client/src/components/Stepper.tsx` point step 2 (Draft) to `/csr` (sub: "Whole CSR, drafted by the CSR Pod"), and `activeStep` returns 2 for `/csr`. On `/csr`, section 11.4.1 links to `/review/csr-11.4.1-02?step=draft`. Presenter links ("See it in Databricks", use `usePresenter`) for: the run's MLflow trace, each TLF table in Catalog Explorer, `csr_signoffs`, the Genie Agent.

Required states: loading, empty (no run yet: show the pod and the plan from the registry, and the button), error (show the message and keep the last document).
