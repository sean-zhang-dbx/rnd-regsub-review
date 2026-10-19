# Run of show: LMN-301 submission review

About 8 minutes, for the regulatory section of the Jiajie Zhang call (Tue 20 Oct 2026, 14:00 UK). All data is synthetic, for the fictional study LMN-301.

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

The demo follows the workflow bar under the app header: 1 Parse sources, 2 Draft, 3 Re-delivery and QC, 4 Review and sign-off. The lines to say are in `docs/SCRIPT.md`, section "Demo"; this list is the click path.

1. **Parse sources (1 minute).** Click "1 Parse sources": Document parsing opens on the SAP, page 2. Hover the text block. Pick the advisory briefing book, go to page 9, hover the chart (figure, confidence 0.94, values 66.7 and 47.1). Optionally show JSON.
2. **Draft (1 minute 15 seconds).** Click "Next: Draft": CSR 11.4.1 opens against Table 14.2.1 v3, with the Drafting workflow outlined. Click "Draft this section"; 5 steps stream in over about 12 seconds (SAP page in the middle pane, placeholders, figures filled from v3, code check and judge). Point to "about two-thirds".
3. **Re-delivery and QC (1 minute).** Click "Next: Re-delivery and QC": the QC log with the re-delivery card and the 7 findings. Scroll to "Reference documents outside the dossier" (brochure p.4, briefing book p.6). Optionally "Open the parsed page".
4. **Review and sign-off (2 minutes 45 seconds).** Click "Next: Review and sign-off": hover "412", click "Recompute from Table 14.2.1 v4" (figures flip, "about two-thirds" turns amber), open the assistant and ask the first suggested question (409 of 618 with SQL), close it, approve, close the viewer. Press `D` and open a judged `wording_check` trace from the rehearsal.

## If something goes wrong

- **Warehouse slow on first load:** wait; the toast at the bottom left shows progress. Talk through the QC log layout in the meantime.
- **Wording check slow:** after 8 seconds the app uses the saved result for each sentence, so the amber flag still appears.
- **Drafting slow:** after 25 seconds the app shows the last stored draft and says so under the draft.
- **Drafting workflow slow:** after 25 seconds the draft step uses the last stored draft and says so; the other steps still run.
- **Genie Agent slow (more than 30 seconds):** say "the agent is still answering" and show `docs/screenshots/vault/3b-genie.png`.
- **Anything else:** switch to the screenshots in `docs/screenshots/vault/`, in file-name order.

## After the call

Run the reset command again, so the next run starts clean. Run `scripts/judge_traces.py` again to score the traces from the call.
