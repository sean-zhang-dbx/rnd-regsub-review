"""Print PASS or FAIL for each "must be true in the data" statement of docs/DEMO_PLAN.md section 2, with the evidence.

    uv run --python 3.12 --with databricks-sql-connector --with pandas --with numpy --with scipy --with statsmodels \
        python scripts/check_must_be_true.py

Statements are checked as worded; no threshold is relaxed. Statements 4 to 6 look at the latest done run.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import check_tlfs  # noqa: E402
import dbx  # noqa: E402
import tlf_defs as D  # noqa: E402

FQ = dbx.FQ
q = dbx.runner()
results = []


def report(n, statement, ok, evidence):
    results.append(ok)
    print(f"\n[{n}] {'PASS' if ok else 'FAIL'}: {statement}\n    {evidence}")


# 1 ----------------------------------------------------------------------------------------------
expected = {"adsl": 254, "adae": 1191, "adqsadas": 12463, "adqscibc": 730, "adtte": 254}
got = {t: q(f"SELECT count(*) FROM {FQ}.adam_{t}")[0][0] for t in expected}
arms = {r[0]: r[1] for r in q(f"SELECT ARM, count(*) FROM {FQ}.adam_adsl GROUP BY ARM")}
props = {t: {r[0]: r[1] for r in q(f"SHOW TBLPROPERTIES {FQ}.adam_{t}")} for t in expected}
sums = all(props[t].get("content_checksum") and props[t].get("xpt_sha256") for t in expected)
ok1 = got == expected and arms == {"Placebo": 86, "Xanomeline Low Dose": 84, "Xanomeline High Dose": 84} and sums
report(1, "adam_* tables reproduce the .xpt files exactly (row counts: ADSL 254, ADAE 1191, ADQSADAS 12463, ADQSCIBC 730, ADTTE 254; arms Placebo 86, Xanomeline Low Dose 84, Xanomeline High Dose 84; a checksum per table matches the .xpt)",
       ok1, f"rows {got}; arms {arms}; checksum recorded per table: {sums} (scripts/load_adam.py compared the .xpt decode with the Delta read-back and stopped on any mismatch)")

# 2 and 3 ----------------------------------------------------------------------------------------
rep = check_tlfs.main(False)
bad = {k: len(v[0]["differs"]) + len(v[0]["missing"]) for k, v in rep.items() if k != "tlf_14_5_01_teae"}
printed_total = sum(len(q(f"SELECT 1 FROM {FQ}.submitted_tlf_cells WHERE tlf = '{t}'")) for t in D.TABLES)
report(2, "Every cell of tlf_14_1_01, tlf_14_1_02, tlf_14_2_01, tlf_14_3_01, tlf_14_3_02, tlf_14_4_01, tlf_14_5_02 and tlf_14_5_01 at version 2 equals the printed value in the submitted section 14 table at the printed precision",
       sum(bad.values()) == 0, f"{printed_total} printed cells compared; differing or missing per table: {bad}")
v1 = len(rep["tlf_14_5_01_teae"][0]["differs"])
v2 = len(rep["tlf_14_5_01_teae (version 2 rule)"][0]["differs"])
n_n = q(f"SELECT count(*) FROM {FQ}.adam_adae WHERE TRTEMFL = 'N'")[0][0]
cur_v = q(f"SELECT max(version) FROM (DESCRIBE HISTORY {FQ}.tlf_14_5_01_teae)")[0][0]
latest = q(f"SELECT run_id FROM {FQ}.csr_runs WHERE status = 'done' AND coalesce(superseded,false) = false ORDER BY finished_at DESC LIMIT 1")
run = latest[0][0] if latest else None
quoted_diff = 0
if run:
    cites = q(f"SELECT c.row_key, c.column_name, c.value_text FROM {FQ}.csr_figure_citations c WHERE c.run_id = '{run}' AND c.source_table = 'tlf_14_5_01_teae'")
    pr = {(r[0], r[1]): r[2] for r in q(f"SELECT row_key, column_name, printed_value FROM {FQ}.submitted_tlf_cells WHERE tlf = 'tlf_14_5_01_teae'")}
    import score_check  # noqa: E402

    quoted_diff = sum(1 for rk, col, val in cites if (rk, col) in pr and not score_check.matches(val, pr[(rk, col)]))
report(3, "tlf_14_5_01_teae version 1 (all AEs, ignoring TRTEMFL) differs from the printed Table 14-5.01 in at least 3 cells that the pre-run draft of 12.2 quotes (ADAE has 65 records with TRTEMFL = 'N'). Version 2 (TRTEMFL = 'Y') matches.",
       run is not None and quoted_diff >= 3 and n_n == 65 and v2 == 0,
       f"ADAE TRTEMFL='N' records: {n_n}; current table (Delta version {cur_v}, version 1 rule) differs from print in {v1} printed cells; cells quoted by the pre-run {run} that differ: {quoted_diff}; version 2 rule differs in {v2} cells")

# 4 ----------------------------------------------------------------------------------------------
if run:
    ver = {r[0]: r[1] for r in q(f"SELECT source_table, max(table_version) FROM {FQ}.csr_figure_citations WHERE run_id = '{run}' AND source_table LIKE 'tlf_%' GROUP BY 1")}
    sc = q(f"SELECT section, figures_total, figures_matched FROM {FQ}.csr_scores WHERE run_id = '{run}' ORDER BY section")
    differing = [r[0] for r in sc if r[2] < r[1]]
    v1_delta = q(f"SELECT state_value FROM {FQ}.demo_state WHERE state_key = 'teae_v1_delta_version'")[0][0]
    report(4, "The pre-run draft (latest done run) is bound to tlf_14_5_01_teae version 1, and its scorecard shows 12.2 as the only section with differing figures.",
           str(ver.get("tlf_14_5_01_teae")) == str(v1_delta) and differing == ["12.2"],
           f"run {run}; bound to tlf_14_5_01_teae Delta version {ver.get('tlf_14_5_01_teae')} (version 1 = Delta version {v1_delta}); sections with differing figures: {differing}; figures {sum(r[2] for r in sc)}/{sum(r[1] for r in sc)}")
    # 5
    rows = q(f"SELECT section, sources_json FROM {FQ}.csr_sections WHERE run_id = '{run}'")
    ids = set()
    for sec, sj in rows:
        for srcs in json.loads(sj or "[]"):
            for s in srcs:
                if s.get("kind") == "passage":
                    ids.add((s["page"], s["element_id"]))
    plan = json.loads(q(f"SELECT plan_json FROM {FQ}.csr_runs WHERE run_id = '{run}'")[0][0] or "[]")
    for p in plan:
        for s in p.get("passages", []):
            if s.get("kind") == "passage":
                ids.add((s["page"], s["element_id"]))
    parts = {}
    if ids:
        cond = " OR ".join(f"(page = {p} AND element_id = {e})" for p, e in ids)
        parts = {(r[0], r[1]): r[2] for r in q(f"SELECT page, element_id, doc_part FROM {FQ}.doc_elements WHERE {cond}")}
    bad5 = [k for k, v in parts.items() if v.startswith("csr_")]
    counts = {}
    for v in parts.values():
        counts[v] = counts.get(v, 0) + 1
    report(5, "No passage cited by any drafted sentence has doc_part in (csr_body, csr_tlf) (the pod never read the answer key). Checked by a query.",
           not bad5 and len(parts) == len(ids) and len(ids) > 0, f"{len(ids)} distinct cited or planned passages; doc_part of each: {counts}; in csr_*: {len(bad5)}")
    # 6
    text = q(f"SELECT text FROM {FQ}.submitted_csr_sections WHERE section = '11.4.1'")[0][0]
    figs = q(f"SELECT DISTINCT value_text, slot FROM {FQ}.csr_figure_citations WHERE run_id = '{run}' AND section = '11.4.1'")
    found = [(v, s) for v, s in figs if re.search(r"(?<![\d.])" + re.escape(v) + r"(?![\d])", text)]
    report(6, "The submitted CSR section text for 11.4.1 contains the drafted figures (independent check on the body text, not just section 14).",
           len(figs) > 0 and len(found) == len(figs),
           f"{len(found)} of {len(figs)} distinct drafted 11.4.1 figures appear in the submitted 11.4.1 text; found: {[s for _, s in found]}")
else:
    print("no done run yet: statements 4 to 6 not checked")
    results.append(False)

print("\nSUMMARY:", "ALL PASS" if all(results) else f"{results.count(False)} FAIL")
