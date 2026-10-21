# PRD: drafting whole regulated documents on Databricks, starting with the full CSR

**Internal: Databricks only.** Owner: Sean Zhang (Solutions Architect, HLS UK). Draft 1, 21 October 2026.
Readers: Mike Sanky and Christina Busmalis (HLS GTM), the Elanco account team (Johnathan Jackson, Hayley Johanson), and the GSK account team.
Research behind every claim: `docs/research/internal_genie_one_2026-10-21.md` (internal) and `docs/research/external_2026-10-21.md` (public). Claims without a source are marked UNVERIFIED.

---

## Friday brief (23 October)

**Why this exists.** On 20 October, Jiajie Zhang (VP AI and Data Science, GSK) watched the CSR section demo and said: "Nobody would be interested in the small subsection of a CSR. Everybody's interested in how to write a whole CSR." Mike asked for a version he can put in front of many customers, and Christina introduced the Elanco team, who want a regulatory-submission POC for animal health. This PRD describes how we would draft a whole document, the CSR first and then other large documents, and what it would take to build a demo of it.

**The idea in one paragraph.** A large regulated document is mostly assembled, not written. In a CSR, the title pages, contents, tables (section 14) and appendices (section 16) are assembled from metadata and outputs that already exist. Sections 9 to 12 are written from the protocol, the SAP and the analysis tables, and only the synopsis, the discussion and the interpretation sentences need judgement. So the system plans the document from a template, drafts each section with a placeholder for every figure, fills the figures from certified tables with SQL, checks every section and the document as a whole, and gives the writer a short list of the sentences that need a person. Every sentence keeps a record of its sources, so a re-delivered table can be traced to every sentence it affects, across documents.

**For the Mike 1:1 (16:30)**
1. What exists: the 1-section demo (CSR 11.4.1), deployed and scripted, with tracing and judges. Genie One found no other packaged Databricks asset for regulatory writing; the closest are Bimal's Agent Pod spec and partner accelerators (Part A, section 13).
2. Proposal: build the full-CSR demo described in Part B. It takes about 5 working days, plus a customer-ready package: configurable catalog, README, reset script and a short recording.
3. Decisions for Mike:
   - Is about 5 days the right investment, and is it for GSK first or for the field?
   - Should it be listed under go/industry-hls or become a named FY27 play?
   - Which other accounts want it? Internal research found Biogen (Project Vector, launching in November) and AstraZeneca Velocia.
   - What is the GSK next step? Jiajie asked for 3 things: a technical deep dive, a map of where GSK already uses Databricks, and our engagement and cost model.

**For the Elanco call (afternoon)**
1. Questions to settle before scoping:
   - Which documents? For example, FDA CVM technical sections and final study reports, EMA veterinary dossiers, or USDA CVB filings.
   - Where do the inputs live (analysis outputs, protocols, Veeva Vault)?
   - What does Elanco's architecture review board (SARB) need?
   - Is this for the November briefing or a real POC with success criteria?
2. What carries over unchanged: placeholders filled from certified tables, citation records, re-delivery tracing, the review and sign-off flow, and parsing with `ai_parse_document`.
3. A suggested first document: one FDA CVM effectiveness final study report (VICH GL9, section 7), because its structure maps closely to a CSR. Part A, section 3.

---

# Part A: solution design (customer-neutral)

## 1. Problem

Drafting has become fast, but finishing a document has not.

- **Today's cycle.** The EMWA survey puts database lock to final CSR at about 15 weeks for a moderately complex Phase III study, summed by stage. That is about 3 weeks to final TLFs, 3 to 4 weeks to a first draft, and about 5 weeks from first draft to final. The data is from 2008 to 2013, so use it as a planning reference rather than a current median. A 2026 paper by authors from 8 companies reports an average of 5.25 weeks from data availability to CSR approval at companies with lean authoring.
- **Generated drafts.** Pfizer reports about 18 minutes per PK section draft, at about 90% of expert quality as rated blind. That covered 7 reports and PK sections only, and revision time was not measured. Merck reports 180 to 80 hours for a fully reviewed first draft, and Novo Nordisk reports CSR first drafts in minutes.
- **Where the time goes now.** It goes into checking (tick and tie of every figure against its TLF), cross-section and cross-document consistency, re-delivery when a TLF changes late, and interpretation.
- **What peers' designs have in common.** The model reproduces numbers from the TLFs, so every figure still has to be checked by a person.

The customer problem, in Jiajie's words, is the whole document, end to end, from an empty template. Our answer is that most of the document should never be "written" by a model at all.

## 2. Users and their jobs

| User | Job in the process | What they need from the system |
|---|---|---|
| Medical writer | Owns the document, the narrative and the interpretation | A complete first draft in the company template, with the sentences that need judgement listed, and every figure already tied to its source |
| Biostatistician | Delivers and certifies TLFs and analysis datasets | To certify a TLF once, and know which sentences use each cell |
| QC reviewer | Numerical QC (tick and tie), consistency | To check sources, not retype numbers; a list of what changed since the last review |
| Clinical scientist or physician | Clinical interpretation, discussion, safety narratives | Narratives drafted from patient data, with the interpretation left to them |
| Regulatory lead | Submission readiness, cross-document consistency | One place to see the status of each section and document, and the evidence behind sign-off |
| Quality and validation | GxP validation of the system | A defined intended use, fixed model versions, traces, evaluation evidence and change control |
| Document owner outside the workflow | Owns documents written elsewhere (IB, briefing books) | A notification when their document quotes a changed result |

## 3. Scope

**Document types.** Each gets its own template, which becomes a section registry, and its own source map.

| Document | Why it fits | Priority |
|---|---|---|
| Clinical study report (ICH E3) | Large, mostly built from TLFs and the protocol and SAP; first ask from GSK | 1 (this PRD) |
| CTD Module 2.5 and 2.7 summaries | Reuse CSR content and the same TLF cells across studies | 2 |
| DSUR and PBRER | Rewritten every reporting period on new data, so re-delivery tracing pays off each cycle | 2 |
| Animal-health submissions (FDA CVM) | Final study reports (VICH GL9 section 7, VICH GL43 section 2.8) and technical sections (CVM GFI #104) follow the same pattern | 2 (Elanco) |
| CMC Module 3 | Built from process, stability and QC data; one Databricks prospect has asked for it | 3 |
| Protocol (ICH M11) | Structured protocols feed every downstream document | Input, not output, in this PRD |

**In scope:**
- Planning a document from a template.
- Drafting each section from structured and unstructured sources.
- Figures filled from certified tables.
- Patient narratives.
- Checks within each section and across the document.
- Assembly into the company template.
- Reviewer workflow and sign-off records.
- Re-delivery tracing across documents.
- Evaluation and model change control.

**Out of scope:**
- eCTD publishing and submission.
- Producing TLFs. Biostatistics still produces and certifies them.
- Replacing the company's document management system. Drafts are exported to it.
- Writing the interpretation for the writer.

## 4. What a whole document is made of

For the CSR (ICH E3), each section has a different main source and a different way of being produced. E3 allows structural adaptation, so the template is the company's version of E3.

| ICH E3 section | Main source | How the system produces it |
|---|---|---|
| 1 Title page, 3 Contents, 4 Abbreviations | Study metadata, the drafted document | Assembled, no model |
| 2 Synopsis | The approved sections | Drafted last, from approved section text; its figures are bound to the same cells as the body, so they cannot disagree |
| 5 Ethics, 6 Investigators and administrative structure | Protocol, site and investigator lists | Company boilerplate with placeholders filled from study metadata tables |
| 7 Introduction, 8 Study objectives | Protocol (parsed, or an ICH M11 structured protocol) | Drafted from protocol passages, each sentence citing its passage |
| 9 Investigational plan | Protocol, SAP, amendments | Drafted from protocol and SAP passages; changes in conduct or analysis drafted from amendments and SAP versions |
| 10 Study patients | Disposition and deviation TLFs (14.1), listings (16.2.1, 16.2.2) | Placeholders bound to certified disposition tables |
| 11 Efficacy evaluation | Efficacy TLFs (14.2), the SAP | Placeholders bound to efficacy cells; interpretation sentences flagged for the writer |
| 12 Safety evaluation | Exposure, AE, SAE, lab and vital sign TLFs (14.3); patient data for narratives | Placeholders bound to safety cells; a narrative step drafts each patient narrative (12.3.2 or 14.3.3) from analysis data rows, each with its own figure bindings |
| 13 Discussion and overall conclusions | Approved sections 11 and 12 | Drafted with each claim linked to a section; owned by the writer |
| 14 Tables, figures and graphs | Biostatistics outputs | Inserted, not generated |
| 15 Reference list | Literature list | Assembled |
| 16 Appendices | Protocol, SAP, sample CRF, patient listings, CRFs | Assembled from documents and listings, not written |

So about half of the document is assembled from things that already exist. Most of the rest is drafted from passages and certified cells, and only a few sentences per section need judgement. Structured protocols (ICH M11, final November 2025) and TransCelerate's content-reuse templates make sections 7 to 9 easier, because the protocol content arrives as data rather than as a PDF.

**The animal-health equivalent.** A CVM final study report follows its protocol's format and VICH GL9 section 7:
- Study identification.
- Materials and methods.
- Amendments and deviations.
- Statistical methods.
- Results, including adverse events.
- Evaluation, conclusions and signatures.

A technical section (GFI #104) assembles integrated summaries, the individual study reports, labelling and FOI summary material. The same split applies: assembled, drafted from sources, and judgement.

## 5. Principles

1. **The model never types a figure.**
   - It writes a placeholder, and SQL fills it from a certified table cell at a recorded version.
   - A code check rejects any section in which the model wrote a number itself.
   - Numbers read from parsed PDFs are never used as figures, only as context.
2. **Every sentence has a recorded source.** Figures carry a cell, table and version; text carries a passage in a parsed document; anything else is marked as the writer's.
3. **Assemble before you generate.** Anything that exists already (tables, appendices, boilerplate, metadata) is assembled, not regenerated.
4. **Workflow first, agents where judgement is needed.** The document plan for a known template is a fixed workflow, which is easier to validate. Agents are used where the path cannot be fixed in advance, for example choosing the passages for a section or drafting a discussion.
5. **Fixed model versions, changed on purpose.** Models are called through Unity Gateway at a fixed version, and a new version is a change-control event backed by an evaluation.
6. **Everything is traced and scored.** Every model call is an MLflow trace, and every section is scored by code checks and judges.
7. **People own interpretation and sign-off.** The system lists what needs a person, and records who signed off, when, and against which table versions.

These map onto the 10 FDA and EMA Good AI Practice principles (January 2026):
- A defined context of use.
- Risk-based controls.
- Data governance and documentation.
- Performance assessment of the whole system, including the human step.
- Life-cycle management.
- Clear communication of limits.

## 6. Solution overview: the document pod

```
Template (company E3)    Study metadata    TLF catalogue (certified UC tables)    Protocol, SAP, amendments (parsed)
            \                   |                        |                                   /
             +------------------+-------- PLAN ----------+----------------------------------+
                                         |
                    Document plan: sections, sources, slots, dependencies
                                         |
                  +----------------------+-----------------------+
                  |                      |                       |
          Section drafting        Narrative drafting       Assembly of fixed parts
        (per section, in waves)   (per patient, batch)     (title, contents, 14, 16)
                  |                      |                       |
                  +----------- CHECK (section, then whole document) -----------+
                                         |
                          Assembled draft + "needs a person" list
                                         |
                    REVIEW (app): status board, assistant, sign-off
                                         |
                RE-DELIVERY: changed TLF cell -> every affected sentence, every document
```

**Plan.**
- A planner reads the template (a section registry: order, title, instructions, source types, expected TLFs, slots and dependencies), the study metadata, the TLF catalogue and the parsed sources.
- It produces a document plan, which says for each section which passages and TLF cells it will use and what it depends on. For example, the synopsis waits for every section, and the discussion waits for sections 11 and 12.
- The plan is a table that a writer can review and edit before drafting starts.
- For a known template the planner is mostly code. A model is used to match passages to sections.

**Section drafting.** Each section runs the 5 steps already in the demo:
1. Read the sources.
2. Find the certified tables.
3. Draft with a placeholder for each figure.
4. Fill the figures with SQL.
5. Check.

Sections without dependencies run in parallel, and dependent sections run in later waves.

**Narrative drafting.** Patient narratives for deaths, serious adverse events and other significant events are drafted per patient from analysis data rows. They use the same placeholder rule, so every date, dose and lab value comes from a row. A CSR can need hundreds of them, so this runs as a batch job.

**Checks.**
- Section-level code checks:
  - No typed figures.
  - Every slot bound.
  - Every referenced TLF exists.
  - Coverage against the template's required content.
- A judge from a second model family checks that each section is supported by its sources and contradicts nothing.
- Document-level checks:
  - The same result has the same value everywhere. This holds by construction when cells are shared, and is checked for text.
  - Terminology and abbreviations are consistent.
  - Cross-references resolve.
  - The synopsis matches the body.
- Whatever fails, and every interpretation sentence, goes on the "needs a person" list.

**Assembly.** Section text, inserted TLFs, cross-references and the table of contents are put together in the company template. The draft is exported as DOCX, or handed to the document management system.

**Review.** A Databricks App shows:
- The status of each section: drafted, checked, with the writer, approved.
- A reviewer assistant: a Genie Agent over the certified tables and AI Search over the parsed documents, with citations.
- Sign-off per section and per document, stored with the table versions.

**Re-delivery.** When Biostatistics re-delivers a TLF:
1. Delta keeps both versions.
2. The citation records list every sentence that quotes a changed cell, in every document.
3. Figures are recomputed.
4. A wording check flags sentences whose wording may no longer hold.
5. Each owner gets their sentences.

AI Search finds the old result in documents written outside the system. This is the part of the current demo that already works.

## 7. Functional requirements

Priority: M = must, S = should, C = could.

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | Store a document template as a section registry: order, numbering, title, instructions, source types, expected TLFs, slots, dependencies, assembled or drafted | M |
| FR-2 | Parse source documents (protocol, SAP, amendments) into typed elements with page positions; accept structured protocols (ICH M11) when available | M |
| FR-3 | Maintain a TLF catalogue: certified tables in Unity Catalog with TLF number, version, certifier and lineage to the analysis datasets | M |
| FR-4 | Produce a document plan per run, reviewable and editable by the writer before drafting | M |
| FR-5 | Draft each section with placeholders only; reject any section in which the model typed a figure | M |
| FR-6 | Fill every placeholder from a certified cell at a recorded version, and write a figure citation | M |
| FR-7 | Record a source citation (document, page, element, quote) for each sentence drafted from a passage; mark sentences with no source as the writer's | M |
| FR-8 | Run sections in dependency order, in parallel where possible, with visible progress and resumable runs | M |
| FR-9 | Section checks: typed figures, unbound slots, missing TLFs, template coverage, a judge on source support and contradiction | M |
| FR-10 | Document checks: consistency of the same result across sections, terminology and abbreviations, cross-references, synopsis against body | M |
| FR-11 | Assemble the full document in the company template, with TLFs and appendices inserted; export DOCX | M |
| FR-12 | A "needs a person" list per section: interpretation sentences, failed checks, low-confidence passages | M |
| FR-13 | Reviewer app: section status board, side-by-side source view, reviewer assistant, sign-off per section and document | M |
| FR-14 | Re-delivery: list the affected sentences across all documents, recompute the figures, check the wording, route to the owners | M |
| FR-15 | Patient narratives drafted per patient from analysis data rows, in batch | S |
| FR-16 | Reuse approved text across documents (CSR to Module 2.7), keeping the same cell bindings | S |
| FR-17 | Feed reviewer edits back into the evaluation set | S |
| FR-18 | Notify owners of documents outside the system when they quote a changed result (AI Search) | S |
| FR-19 | Redraft one section on request without rerunning the document | S |
| FR-20 | Templates for other document types (Module 2, DSUR, CVM study report) | C |

## 8. Non-functional requirements

| Area | Requirement |
|---|---|
| Traceability | Every figure traceable to a cell and version, every drafted sentence to a passage or to the writer, every model call to an MLflow trace |
| Model control | Model versions fixed per document type and called through Unity Gateway; no change without a recorded evaluation |
| Reproducibility | Figures are deterministic (SQL), and only the wording varies between runs. We say this plainly and do not claim more |
| Performance | A full CSR draft in under 1 hour of wall-clock time for a typical Phase III study (target, to be measured); a single section in under 1 minute |
| Scale | Hundreds of narratives per study; dozens of TLFs; multiple documents sharing cells |
| Security | Unity Catalog permissions on every table, volume and model; the app runs with the signed-in user's permissions where the API allows it |
| Audit | Sign-offs, citations and check results stored in governed tables; audit logs copied on a schedule, because system table retention can be shorter than expected |
| Portability | Catalog, schema, warehouse, model service, Genie Agent and experiment set by configuration, not code |

## 9. Architecture on Databricks

| Need | Databricks component | Status (Oct 2026) |
|---|---|---|
| Certified analysis tables, versions, lineage | Unity Catalog tables with certification tags and lineage; Delta version history | GA |
| Source documents | Unity Catalog volumes; `ai_parse_document` (typed elements, page images, confidence) | GA |
| Search over documents | AI Search (hybrid index over parsed text) | GA |
| Ingestion from Veeva Vault | Lakeflow Connect Veeva Vault connector | Beta |
| Model calls at a fixed version | Unity Gateway model services | GA (service policies Beta) |
| Second-family judge | Model Serving, Foundation Model APIs | GA |
| Batch drafting (sections, narratives) | Lakeflow Jobs with for-each tasks | GA |
| Agentic planner and long runs | Agent Bricks CLI with Durable Agent Runtime (run state on Lakebase) | CLI Beta |
| Run state, review state | Lakebase or Delta tables | GA (agent sessions and memory Beta) |
| Tracing and evaluation | MLflow 3 tracing and `mlflow.genai.evaluate` with code scorers and judges | GA (production monitoring Beta) |
| Reviewer assistant | Genie Agents over the certified tables, plus AI Search | GA |
| Reviewer app | Databricks Apps (AppKit) | GA |

**Recommendation.**
- Run the production drafting path on GA components: Lakeflow Jobs, Unity Gateway, MLflow, Unity Catalog and Apps.
- Use the Agent Bricks CLI where an agent is needed and the customer accepts Beta, and keep it off the validated path until it is GA.
- The Knowledge Assistant and Supervisor Agent have been legacy since 12 October 2026 and should not appear in new designs.

**Data model (core tables).**
- `section_registry`: template sections.
- `document_runs` and `document_plans`.
- `section_drafts`: exists in the demo.
- `figure_citations`: exists.
- `source_citations`: exists.
- `check_results`.
- `narratives`.
- `review_signoffs`: exists.
- `wording_checks`: exists.

## 10. Evaluation and model change control

- **Scorers per section:**
  - Figures bound to cells (code; exists in the demo as `figures_bound_to_cells`).
  - Template coverage (code).
  - Source support and no contradiction (judge from a second model family; exists in the demo as `verdict_supported` for wording checks and a live judge for drafts).
  - Style against the company style guide (judge).
- **Evaluation set:** approved CSRs and their reviewer edits, by section. Reviewer edits are the most useful data, because they show where drafts fell short.
- **Model change:** a new model version drafts the evaluation set, and the scores are compared with the current version. The report goes into the change record, and only then is the version changed in Unity Gateway.
- **Monitoring:** live traces are scored after each run, and the same scorers run offline and on live traffic.

## 11. GxP, validation and the honest gaps

**Position.**
- Validation is a shared responsibility. Databricks provides controls, logs, SDLC evidence and change management, with the GxP whitepaper (v2.3, shareable with customers), the Due Diligence Package and IQ and some OQ material.
- The customer owns the intended use, the validation scope and IQ, OQ and PQ.
- The usual pattern is to qualify the platform once and validate each use case.
- For this system, the intended use is "drafting support with human review and sign-off". That keeps the risk lower than a system that decides anything.
- A GxP workstream belongs in the statement of work from the start, as AstraZeneca did on Velocia.
- Partners such as Purgo AI can automate IQ, OQ and Part 11 work.

**Gaps to state openly** (internal research, section 5):
1. **Run-to-run reproducibility of wording.**
   - Concede it.
   - Figures are deterministic, and only wording varies.
   - Fixed model versions, traces and human sign-off cover the rest.
2. **No native e-signature.** Sign-off records are custom tables, which the customer validates.
3. **Model retirement windows.** These are about 3 months for pay-per-token and about 6 months for provisioned throughput, which may be shorter than a revalidation cycle. Plan evaluation-backed model changes as routine.
4. **Audit log retention** in system tables can be shorter than documented. Copy logs on a schedule.
5. **Regional data processing for model calls** needs checking per customer. For example, UK South and cross-geo processing.
6. **A Sev1 report** describes the document parser changing or inventing values on clean PDFs while reporting confidence 1.00. That is why parsed numbers are never used as figures in this design, and parsed text is cited and shown to the reviewer rather than trusted silently.
7. **Serverless compute has no pinnable runtime version**, which complicates some validation evidence.
8. **Beta components** (Agent Bricks CLI, agent sessions, Unity Gateway service policies, the Veeva connector) should stay off the validated path.

## 12. Vendors, references and positioning

**Vendors.**
- **Certara CoAuthor:** Word-based authoring with templates, content reuse and source-restricted AI.
- **Yseop Copilot:** whole-document first drafts in Word and Veeva Vault.
- **Weave Bio:** dossier authoring with sentence-level source tracing and AI reviewers for cross-document inconsistencies, plus an NDA workflow with Parexel from April 2026.

None publicly claims unattended generation of a complete submission, and all keep expert review.

**Databricks references** (internal; check before naming externally):
- **AstraZeneca Velocia:** study design and authoring workspace on Apps and Lakebase.
- **Biogen with MathCo, Project Vector:** CSRs from protocol, SAP and TLFs, launching in November 2026.
- **Royal FrieslandCampina:** regulatory dossiers.
- **Tiger Analytics:** CSR generator accelerator from a partner.
- **Paradigm Health and Accumulus:** partners in submission data exchange.

**Positioning.**
- Vendors draft inside their own tools. Our difference is that the figures, sources and evidence live in the customer's governed data, where Biostatistics already certifies the tables.
- Re-delivery is traced across every document and not just inside one tool.
- The customer can use any model at a fixed version.
- Vendors and SIs can build on top of it.
- Anthropic and other model providers are partners on the reasoning layer.

## 13. Engagement model

This is the proposal, and the account team (Tansy, Mike) owns the commercial terms.

1. **Scoping, free.** The account's solution architects and HLS industry specialists work with the customer's business stakeholders (medical writing, biostatistics, regulatory, quality) to map one document type end to end.
   - It covers templates, sources, review steps, where the time goes, and validation expectations.
   - This answers Jiajie's ask for people who learn the business process before a technology is chosen.
2. **Pilot, about 4 to 6 weeks, often investment-backed.**
   - One document type and one or 2 completed studies with approved CSRs.
   - The approved CSRs are the comparison, and their reviewer edits become the evaluation set.
   - It runs on the customer's data in their workspace.
3. **Build, fixed price.** Production pipeline, templates, validation workstream and integration with the document management system. FDE-led, with a GxP workstream from the start.
4. **Extend.** Further document types (Module 2, DSUR and PBRER, CMC), more studies and more teams.

## 14. Pilot measures

| Measure | Baseline | Target (to agree with the customer) |
|---|---|---|
| Final TLFs to approved CSR | The customer's current figure, or about 8 to 10 weeks from published surveys | To be set in scoping |
| Writer and QC hours per CSR | Measured on the pilot studies | To be set in scoping |
| Figures typed by the model | (by design) | 0 |
| Numerical QC findings at review | Measured on the approved CSRs | Fewer than today |
| Reviewer edit rate by section | Measured | Falling across runs |
| Time from TLF re-delivery to updated, rechecked sentences | Measured today | Minutes |

## 15. Risks and open questions

- **Template variety.** Every company adapts E3. Mitigation: the template is data (a section registry) that is configured per customer.
- **Source quality.** Protocols and SAPs arrive as PDFs of varying quality. Mitigation: show the parsed passage next to every cited sentence; accept ICH M11 structured protocols when available.
- **Long runs.** A full CSR with narratives runs for a long time. Mitigation: batch jobs, resumable runs, progress per section, and caching of drafts that passed their checks.
- **Expectations.** "Write the whole CSR" can be heard as "no writer". Mitigation: say from the start that the system drafts and checks, and people interpret and sign.
- **Open:** which customer templates and approved CSRs are available for an evaluation set; who owns validation; how drafts reach the customer's document management system (Veeva Vault, other).

---

# Part B: internal build plan for the full-CSR demo

Goal: on the existing app, draft a whole synthetic CSR for study LMN-301 from an empty template, and keep the 4 workflow steps (Sources, Draft, Re-delivery and QC, Review and sign-off) working on the whole document. Budget about 5 working days.

## B1. Reuse as is

| Piece | Where |
|---|---|
| Placeholder binding and the typed-figure check | `bind()`, `server/routes/draftSection.ts:94` |
| Model call through Unity Gateway | `callModel()`, `server/routes/draftSection.ts:122` |
| Storing drafts | `persist()` and `lastDraft()`, `server/routes/draftSection.ts:149`, `:166` |
| Streamed steps with MLflow spans | `registerDraftRun()`, `server/routes/draftRun.ts:153`; `server/lib/tracing.ts` |
| Live judge on a second model family | `judge()`, `server/routes/draftRun.ts:131` |
| Wording check, reviewer assistant, sign-off | `server/routes/wordingCheck.ts`, `assistant.ts`, `signoff.ts` |
| Parsing and citations | `scripts/parse_elements.py`, `scripts/build_source_citations.py`, Sources and Document parsing pages |
| Evaluation | `scripts/judge_traces.py` (`figures_bound_to_cells`, `verdict_supported`) |

## B2. Generalise

- **Section registry.** `OUTLINES` and `SLOTS` (`server/routes/draftSection.ts:15`, `:27`) become a `section_registry` table: section, title, instructions, slots and their cells, source passages, dependencies, assembled or drafted.
- **Sources per section.** `SOURCE_QUERIES` (`server/routes/draftRun.ts:34`) becomes source passages per section, chosen by the planner and stored in the plan.
- **Table versions.** `SOURCE_VERSION = 3` (`server/routes/draftSection.ts:12`) and the 5 queries with `VERSION AS OF 3` in `config/queries/` become a parameter: the version each document run was drafted against.
- **Sources page.** `SECTION = '11.4.1'` (`server/routes/sources.ts:12`) becomes a section parameter.
- **Configuration for a customer-ready version.**
  - Catalog and schema (`server/lib/dbx.ts:4`).
  - Model service.
  - Genie Agent.
  - MLflow experiment.
  - Warehouse.
  - Reviewer name.
  - The volume paths in the scripts.
  - These move to bundle variables and app environment settings.

## B3. New synthetic data (LMN-301)

- **Analysis datasets:**
  - Disposition and protocol deviations.
  - Demographics and baseline characteristics.
  - 2 secondary endpoints and 4 subgroups.
  - Exposure.
  - Adverse events by system organ class and preferred term.
  - Serious adverse events and deaths.
  - Selected labs.
- **Certified TLF tables:** 14.1.x, 14.2.2 to 14.2.4 and 14.3.x, with lineage from the analysis datasets.
- **Documents:** a longer protocol and SAP (all sections that 7 to 9 draw from), re-parsed.
- **Narratives:** about 10 patients with serious events.

## B4. New pieces

- **Planner:** builds the document plan from the registry, the TLF catalogue and the parsed sources, and shows it for review.
- **Fan-out:** sections run in dependency waves with streamed progress. A Lakeflow Job runs the full document, and the app runs single sections live.
- **Narrative step:** drafts the narratives in batch.
- **Document checks:** consistency, terminology, cross-references and synopsis against body.
- **Assembly:** HTML preview and DOCX export with TLFs inserted.
- **Whole-document views:** a status board for the document, and the Viewer and Sources pages extended to any section.

## B5. Milestones

| Milestone | Content | Estimate |
|---|---|---|
| M1 | Synthetic data, TLF tables, longer protocol and SAP, section registry | About 1 day |
| M2 | Planner, section fan-out for sections 7 to 13, narratives | About 1 to 2 days |
| M3 | Document checks, assembly and DOCX export, document status board | About 1 day |
| M4 | Customer-ready package: configuration, README, reset script, a 5-minute recording | About 1 day |

## B6. Demo plan and risks

- **On stage:** show the plan, run 1 or 2 sections live, then open the full document drafted beforehand with its "needs a person" list. Then do the re-delivery across the whole document.
- **Risks:**
  - Model latency over many sections. Mitigation: pre-run, and cache drafts that passed their checks.
  - Beta components. Mitigation: use Lakeflow Jobs and the app, not the Agent Bricks CLI, for the demo path.
  - Scope creep into Module 2. Mitigation: only the shared-cell reuse already in the demo.

---

## Appendix: open questions

**For Elanco.**
- Which documents, and for which agency (FDA CVM, EMA veterinary, USDA CVB)?
- Where do the analysis outputs and protocols live?
- Is Veeva Vault in use?
- What does SARB require for a Databricks App?
- Is this for the November briefing or a POC with success criteria?

**For Mike.**
- A named FY27 play or a go/industry-hls listing?
- Which accounts besides GSK and Elanco want it (Biogen, AstraZeneca)?
- Who funds a GSK pilot?
- Who joins the London session with Jiajie?

**For GSK (through Tansy).**
- Which document type first?
- Are there approved CSRs with reviewer edits to use as an evaluation set?
- Who owns validation?
- How does Sonata, or any existing authoring workstream, relate to this?

**UNVERIFIED items to check before external use.**
- FDA Real-Time Clinical Trials initiative (April 2026).
- Public 2026 announcements from AstraZeneca, Sanofi and Lilly on CSR generation.
- Partner names (Paradigm, Accumulus): check go/reffy.
- The full-CSR wall-clock target, which will be measured in M2.
