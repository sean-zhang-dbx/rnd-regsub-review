# Run of show: LMN-301 submission review

About 7 minutes, for the regulatory section of the Jiajie Zhang call (Tue 20 Oct 2026, 14:00 UK). All data is synthetic, for the fictional study LMN-301.

## Before the call (10 minutes ahead)

1. Reset the demo, so every finding starts as "Ready for review":
   ```bash
   cd ~/Projects/gsk/rnd_regsub_review && uv run --python 3.12 --with databricks-sql-connector python scripts/reset_demo.py
   ```
2. Open the app (https://rnd-regsub-review-7474654216647582.aws.databricksapps.com, or http://localhost:8000 as the fallback) in a browser window about 1440 pixels wide, and wait until the QC log has loaded. This warms the SQL warehouse, so nothing shows "warming up" on the call.
3. Check that the "Databricks" switch in the top bar is off, and the browser zoom is 100%.
4. Keep `docs/screenshots/vault/` open in a second window as the fallback.
5. After the last rehearsal, score its wording checks and drafts so the judged traces are ready to show in beat 5 (about 1 minute):
   ```bash
   cd ~/Projects/gsk/rnd_regsub_review && uv run --python 3.12 --with "mlflow[databricks]>=3.5" --with databricks-sql-connector python scripts/judge_traces.py
   ```

## The walk

### 1. QC log: what did the re-delivery break? (1 minute)
On screen: the TLF re-delivery card for Table 14.2.1 (v3 Superseded, v4 Current), the dossier tree with a count on each affected document, and the QC log.

Say: "Biostatistics has re-delivered the primary efficacy table. Before anyone opens a document, the reviewer can see every sentence that quotes a changed cell, across the CSR, Module 2 and the label."

Then scroll to "Reference documents outside the dossier".

Say: "The Investigator's Brochure and the briefing book were written outside this workflow, so they carry no links to the data. AI Search finds the old result in their text, and the owners are notified. Nothing outside the dossier is rewritten."

Then click "Open the parsed page" under the briefing book row. Document parsing opens at page 6: the page on the left with a coloured box for each element ai_parse_document found, and the parsed content on the right, with "412" highlighted. Click the next-page arrow to page 9. The chart is detected as a figure (confidence 0.94), with a description and the values read from the chart, 66.7 and 47.1. Switch to JSON to show the raw output, then press the back arrow.

Say: "This is what ai_parse_document gives us for each PDF: the layout, the text, tables as HTML, and figures with a description and the values read off the chart. The old result is in this chart too, not just in the text."

Optional: click "Notify owners", or type `412` in the search box in the top bar.

### 2. Viewer: where did this number come from? (1 minute)
Click "CSR 11.4.1" in the first row. The CSR page opens next to the Table 14.2.1 output, with the Information panel on the right.

Hover "412" in the text. Its cell lights up in the table, and the citation card shows the table, row, column, version and who released it.

Say: "This is the tick and tie a QC reviewer already does, but every figure is tied to its cell in the table. The yellow cells are the ones that changed, and the text still quotes version 3."

### 2b. How the section is drafted (1 minute 15 seconds)
In the Information panel, click "Draft this section" under Drafting workflow. 5 steps stream in over about 12 seconds:
1. **Read the protocol and SAP.** The SAP page opens in the middle pane, with the ai_parse_document layout drawn over it and the passage the draft uses outlined in blue. Hover an element to show its type.
2. **Find the certified table.** Table 14.2.1, version 3, certified in Unity Catalog.
3. **Draft the sentences.** The model's sentences appear with grey placeholders where the figures go.
4. **Fill the figures with SQL.** The table pane comes back at version 3, and the placeholders become blue figures. Hover one to light up its cell.
5. **Check the draft.** A code check confirms the model typed no figures, and a GPT 5.5 judge confirms the draft agrees with the protocol and SAP.

Say, while step 1 runs: "The workflow starts the way a writer would, with the protocol and the SAP. ai_parse_document has already turned those PDFs into elements with their positions on the page, so the workflow can take the endpoint definition from the SAP and show exactly where it came from."

Say, at step 3: "The model drafts the text, but it is never given the numbers. It writes a placeholder for each figure."

Say, at step 5: "SQL fills each placeholder from version 3 of the certified table, so each figure is tied to its cell from the start. A code check confirms the model typed no number itself, and a judge from a different model family checks the draft against the protocol and SAP. Each step is a span in one MLflow trace."

Then point to the "about two-thirds" sentence on the CSR page.

Say: "The model can't describe a result in words like 'about two-thirds', because it never sees the values. That phrase is the writer's interpretation, and it is the sentence we'll come back to."

### 3. Hero: fix the numbers, flag the meaning (1.5 minutes)
Click "Recompute from Table 14.2.1 v4". The figures flip on the page, the yellow cells turn green, and after a few seconds the "about two-thirds" sentence turns amber with "With the writer".

Hover the amber "With the writer" tag to show the reason.

Say: "SQL recomputed every figure from the released table, so no number was retyped. A model then read each updated sentence and flagged the one whose wording may no longer hold, because 66.2% is below two-thirds. The writer decides. The label sentence went to Labelling."

### 4. Check and sign off (1.5 minutes)
In the Information panel, click "Open the assistant". The reviewer assistant opens over the panel. Click the first suggested question, about the treatment arm after the restatement. It takes about 20 seconds: the assistant asks the Genie Agent for the figure and searches the documents at the same time. It returns 409 of 618 (66.2%) with the SQL, and notes that the brochure and the briefing book still quote 412 of 618.

Say: "The reviewer can ask questions in plain language. For figures, the assistant asks a Genie Agent over the certified tables and shows the SQL it ran. For anything about the documents, it uses AI Search over the parsed PDFs and cites the page."

Optional, if there is time: click the second suggested question, about missing Week 52 assessments, then click citation 1. The SAP page opens in the middle pane with the cited passage outlined.

Close the assistant with the X, then click "Approve the recomputed figures".

Say: "The sign-off is recorded with a name, a time and the table version."

### 5. Close (30 seconds)
Close the viewer with the X. The QC log now shows the figure rows as Approved, one sentence with the writer and the label sentence sent to Labelling.

Then press `D` and open "MLflow traces in Databricks". Open a `wording_check` trace from the rehearsal (the ones with a prompt preview) and point to the 2 assessment columns.

Say: "Each call to the checker is traced, and then checked twice. A code check confirms that every figure equals the cell in Table 14.2.1, and a judge from a different model family checks that the verdict follows from the sentence. That is the same evaluation a team would run before switching to a newer model, which is the next slide."

The trace from the live run has no scores yet, because the judges run after the review. Use one from the rehearsal.

If asked where else this lives in Databricks: the other "See it in Databricks" links cover table history, lineage, the AI Search index, the Unity Gateway inference table, the Genie Agent and the sign-off table.

## If something goes wrong

- **Warehouse slow on first load:** wait; the toast at the bottom left shows progress. Talk through the QC log layout in the meantime.
- **Wording check slow:** after 8 seconds the app uses the saved result for each sentence, so the amber flag still appears.
- **Drafting slow:** after 25 seconds the app shows the last stored draft and says so under the draft.
- **Drafting workflow slow:** after 25 seconds the draft step uses the last stored draft and says so; the other steps still run.
- **Genie Agent slow (more than 30 seconds):** say "the agent is still answering" and show `docs/screenshots/vault/3b-genie.png`.
- **Anything else:** switch to the screenshots in `docs/screenshots/vault/`, in file-name order.

## After the call

Run the reset command again, so the next run starts clean. Run `scripts/judge_traces.py` again to score the traces from the call.
