# Run of show: LMN-301 submission review

About 6 minutes, for the regulatory section of the Jiajie Zhang call (Tue 20 Oct 2026, 14:00 UK). All data is synthetic, for the fictional study LMN-301.

## Before the call (10 minutes ahead)

1. Reset the demo, so every finding starts as "Ready for review":
   ```bash
   cd ~/Projects/gsk/rnd_regsub_review && uv run --python 3.12 --with databricks-sql-connector python scripts/reset_demo.py
   ```
2. Open the app (https://rnd-regsub-review-7474654216647582.aws.databricksapps.com, or http://localhost:8000 as the fallback) in a browser window about 1440 pixels wide, and wait until the QC log has loaded. This warms the SQL warehouse, so nothing shows "warming up" on the call.
3. Check that the "Databricks" switch in the top bar is off, and the browser zoom is 100%.
4. Keep `docs/screenshots/vault/` open in a second window as the fallback.
5. After the last rehearsal, score its wording checks so the judged traces are ready to show in beat 5 (about 1 minute):
   ```bash
   cd ~/Projects/gsk/rnd_regsub_review && uv run --python 3.12 --with "mlflow[databricks]>=3.5" --with databricks-sql-connector python scripts/judge_traces.py
   ```

## The walk

### 1. QC log: what did the re-delivery break? (1 minute)
On screen: the TLF re-delivery card for Table 14.2.1 (v3 Superseded, v4 Current), the dossier tree with a count on each affected document, and the QC log.

Say: "Biostatistics has re-delivered the primary efficacy table. Before anyone opens a document, the reviewer can see every sentence that quotes a changed cell, across the CSR, Module 2 and the label."

Then scroll to "Reference documents outside the dossier".

Say: "The Investigator's Brochure and the briefing book were written outside this workflow, so they carry no links to the data. AI Search finds the old result in their text, and the owners are notified. Nothing outside the dossier is rewritten."

Optional: click "Notify owners", or type `412` in the search box in the top bar.

### 2. Viewer: where did this number come from? (1 minute)
Click "CSR 11.4.1" in the first row. The CSR page opens next to the Table 14.2.1 output, with the Information panel on the right.

Hover "412" in the text. Its cell lights up in the table, and the citation card shows the table, row, column, version and who released it.

Say: "This is the tick and tie a QC reviewer already does, but every figure is tied to its cell in the table. The yellow cells are the ones that changed, and the text still quotes version 3."

### 3. Hero: fix the numbers, flag the meaning (1.5 minutes)
Click "Recompute from Table 14.2.1 v4". The figures flip on the page, the yellow cells turn green, and after a few seconds the "about two-thirds" sentence turns amber with "With the writer".

Hover the amber "With the writer" tag to show the reason.

Say: "SQL recomputed every figure from the released table, so no number was retyped. A model then read each updated sentence and flagged the one whose wording may no longer hold, because 66.2% is below two-thirds. The writer decides. The label sentence went to Labelling."

### 4. Check and sign off (1.5 minutes)
In the Information panel, click "Ask" under Genie Agent. The answer takes about 15 seconds; use the time to say the line below. It returns 409 of 618 (66.2%), with the SQL.

Say: "The reviewer checks the figure with a Genie Agent that queries the same governed tables, without emailing the statistician."

Click "Approve the recomputed figures".

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
- **Genie Agent slow (more than 30 seconds):** say "the agent is still answering" and show `docs/screenshots/vault/3b-genie.png`.
- **Anything else:** switch to the screenshots in `docs/screenshots/vault/`, in file-name order.

## After the call

Run the reset command again, so the next run starts clean. Run `scripts/judge_traces.py` again to score the traces from the call.
