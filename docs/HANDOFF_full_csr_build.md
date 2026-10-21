# Handoff: build the full-CSR demo (21 Oct 2026)

Start a fresh session in `~/Projects/gsk/rnd_regsub_review` and say: "Read docs/HANDOFF_full_csr_build.md and build the full-CSR demo from docs/PRD_document_drafting.md, Part B."

## Where things are
- PRD (source of truth): `docs/PRD_document_drafting.md`; HTML `docs/PRD_document_drafting.html`; Google Doc https://docs.google.com/document/d/1scEfzqqId7ahY3iH9_CeFy9NkE6QTgOZQfrn6l0Bob8/edit (Internal)
- Research behind it: `docs/research/internal_genie_one_2026-10-21.md`, `docs/research/external_2026-10-21.md`
- Live app (1-section demo, 4 workflow steps): https://rnd-regsub-review-7474654216647582.aws.databricksapps.com
- Repo: https://github.com/sean-zhang-dbx/rnd-regsub-review (private), last pushed commit d73e667
- Deck: https://docs.google.com/presentation/d/1NIuGc-eNnNr-bg7R1YbyLrsfTo9Lg75xaeHAVkOKkGQ/edit ; script `docs/SCRIPT.md` / `.html`
- Workspace `fe-vm-sean-zhang`, schema `sean_zhang_catalog.rnd_regsub_review`, warehouse `16ad82bead3f55b5`, app SP `2dfcc8b5-6e43-44e9-983d-4cba8cd00c62`

## Why
On the 20 Oct call, Jiajie (GSK) asked to see how to write a whole CSR from an empty template, not one section. Mike Sanky wants a customer-ready version (1:1 "Connect on CSR demo", Fri 23 Oct 16:30 UK). The Elanco team (Johnathan Jackson, Hayley Johanson) wants an animal-health regulatory-submission POC; confirm the call date (Genie One said Fri 24 Oct, which is a Saturday).

## Rule 1: do not break the existing demo
The current 4-step flow (Sources, Draft, Re-delivery and QC, Review and sign-off), its tables, PDFs, element ids, `source_citations`, the AI Search index and the script all depend on the current data. Do not regenerate the existing PDFs or the existing tables. Add new tables and a new page. Reset the demo when done: `uv run --python 3.12 --with databricks-sql-connector python scripts/reset_demo.py`.

## Build plan (PRD Part B), with the decisions already made

**M1 data (new script `scripts/generate_csr_data.py`, SQL connector via `scripts/dbx.py`, fixed seed)**
- Existing facts to stay consistent with: adsl 1,227 rows (TRT "LMN-4471 400 mg" 618, Placebo 609; F 735 / M 492; mean age about 54; 10 countries, 62 sites; usubjid like LMN301-1001-003). efficacy_primary current (v4): TRT 409/618 66.18%, PBO 287/609 47.13%, diff 19.05 (13.61 to 24.50); v3 had 412 and 66.67, 19.54 (14.11 to 24.97). safety_overview: TRT n 618, any TEAE 441, SAE 53, AE discontinuation 38, deaths 2; PBO 609, 419, 41, 22, 3.
- New analysis tables: disposition (completed or discontinued with reason), protocol deviations, exposure, AEs by SOC and PT (counts must reproduce safety_overview exactly), SAEs and deaths with dates, a few labs, 2 secondary endpoints (symptom score change Week 24 and 52; time to first response), subgroup data for age, sex, region, baseline severity.
- New certified TLF tables, built with CREATE TABLE AS SELECT from the analysis tables so Unity Catalog lineage exists, then `ALTER TABLE ... SET TAGS ('system.certification_status' = 'certified')` plus the `sz_domain`, `sz_project`, `asset_class` tags: 14.1.1 disposition, 14.1.2 demographics, 14.2.2 per-protocol, 14.2.3 secondary, 14.2.4 subgroups, 14.3.2 AEs by SOC/PT, 14.3.3 exposure. Use a `row_key` column and numeric columns like efficacy_primary, so slots can be generated generically.
- `section_registry` table: section number, title, order, kind (assembled, boilerplate, drafted, narrative), instructions, source passages (doc title + content match), TLF tables, depends_on. Drafted sections: 7, 8, 9, 10, 11.1, 11.4.1, 11.4.2, 11.4.3, 12.1, 12.2, 12.3, 13, then 2 (synopsis) last. Assembled: 1, 3, 4, 14, 15, 16. Boilerplate: 5, 6.
- No new PDFs needed: the existing Protocol v3 (6 pages: synopsis and objectives p1, background p2, endpoints p3, eligibility p4, treatment and schedule p5, statistics and safety oversight p6) and SAP v2 (5 pages: analysis sets p1, primary p2, secondary and multiplicity p3, safety and subgroups p4, TLF list p5) cover sections 7 to 12.

**M2 engine (new route, e.g. `server/routes/csrRun.ts`, SSE like `server/routes/draftRun.ts`)**
- Reuse `bind()`, `callModel()`, `persist()` from `server/routes/draftSection.ts`, `judge()` and the step and SSE pattern from `draftRun.ts`, spans from `server/lib/tracing.ts` (start the root span in `context.with(ROOT_CONTEXT, ...)`; the Apps proxy sends an unsampled parent).
- Slots generated per section from its TLF tables: one slot per (row_key, column), named `<alias>_<row>_<col>`, with a description from the column comment; efficacy_primary is read at `VERSION AS OF 3` (the draft version), the other tables at their current version.
- Typed-number check: `bind()` flags numbers outside placeholders against `ALLOWED_NUMBERS`. Generalise: a number is allowed only if it appears in the section's cited passages or the registry text (Week 52, 400 mg, 95%, table numbers).
- Waves: all independent drafted sections in parallel, then 13, then 2. Narratives per SAE patient in parallel, figures from rows. Judge each drafted section on `databricks-gpt-5-5`.
- Document checks (code): every synopsis figure bound to a cell also used in the body; every "Table 14.x" reference exists in the TLF catalogue; abbreviations defined; required content per section present; no typed figures.
- Persist to new tables: `csr_runs`, `csr_sections` (rendered text, templates, kind, status, needs-a-person list, sources, checks, judge, trace id), `csr_figure_citations`. Add MODIFY grants for them in `scripts/grant_app_sp.py` and run it.
- Also `GET /api/csr-run/latest` so a pre-run document can be shown on stage.

**M3 UI (new page `/csr`, register in `client/src/App.tsx`)**
- Left: section tree with status (assembled, drafted, checked, needs a person). Top: the plan table, and a "Draft the whole CSR" button with streamed progress. Middle: the document with figures highlighted (hover shows the cell) and source chips. Right: sources, checks, judge, needs-a-person list for the selected section. Header: document check summary and "Export for Word" (HTML served as `.doc`; no new npm dependency).
- Re-delivery banner on `/csr`: sentences in this draft that cite efficacy_primary cells that changed between v3 and v4.
- Stepper (`client/src/components/Stepper.tsx`): point step 2 (Draft) to `/csr`, and link section 11.4.1 to the existing section view `/review/csr-11.4.1-02?step=draft`.
- Match the existing look (tokens in `client/src/index.css`, patterns in `client/src/pages/Sources.tsx` and `Documents.tsx`).

**M4 package**
- Make catalog, schema, Genie Agent, experiment, warehouse and reviewer configurable where it is cheap (`server/lib/dbx.ts`, `scripts/dbx.py`); note in the README that `config/queries/*.sql` still hard-code the catalog.
- Update README (features and statuses), `docs/SCRIPT.md` step 2, and screenshot the new page with Playwright (`/tmp/regsub_shots/steps.py` is a template; local server is `pnpm dev` on port 8000).

## Deploy and verify
- `pnpm typecheck`, `npx eslint <changed files>` (2 errors in Overview.tsx predate this work), `pnpm build`, then `databricks bundle deploy -p fe-vm-sean-zhang` and `databricks bundle run app -p fe-vm-sean-zhang`.
- Check the routes as the app with `curl -H "Authorization: Bearer $(databricks auth token -p fe-vm-sean-zhang ...)"` against the app URL.

## Gotchas
- Commit with `git commit -F <file>` in a short command; a hook misreads long commands as --no-verify. End messages with "Co-authored-by: Isaac <no-reply@databricks.com>". Print the Isaac /review tip once before pushing.
- Never let Prettier reformat whole files; edit only the lines you mean to.
- Slides API needs `gcloud auth application-default print-access-token`; object ids must be at least 5 characters.
- Chrome's `scrollIntoView` returns a Promise; never return it from a useEffect arrow.
- The demo state lives in `review_signoffs`; anyone clicking Recompute changes it, so reset before showing.
- Voice for all prose: no em dashes, numbers as digits, no AI phrasing; product names per `~/.claude/databricks-naming.md`.
- Sean does not want new slides for presenting techniques (script only), and wants new features visible from the opening screen with exact click paths.

## Before Friday (Sean)
1. Read the Friday brief at the top of the PRD.
2. Confirm the Elanco call date; accept Mike's invite.
3. Send Mike the deck, repo access and a short recording (he likely cannot log in to FEVM).
