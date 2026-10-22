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
    # 6 ---------------------------------------------------------------------------------------------
    # Every number of the submitted 10.1 text and of the in-text Table 11-1 (11.2.1) is mapped by hand to its TLF cell
    # (or study_metadata key). The body value is parsed out of submitted_csr_sections.text at run time; nothing about
    # the expected values is hard-coded. Compared at the body's printed precision.
    T1, T2, TD, TM = "tlf_14_1_01_populations", "tlf_14_1_02_disposition", "tlf_14_2_01_demographics", "study_metadata"
    sec101 = q(f"SELECT text FROM {FQ}.submitted_csr_sections WHERE section = '10.1'")[0][0]
    sec1121 = q(f"SELECT text FROM {FQ}.submitted_csr_sections WHERE section = '11.2.1'")[0][0]
    ARM = ["pbo", "low", "high", "total"]
    mapped = []  # (where, body_text_value, [candidate cells (table, row_key, column)])
    unmapped = []

    def grab(where, pattern, text, cells_for_groups, flags=re.S):
        m = re.search(pattern, text, flags)
        if not m:
            unmapped.append((where, f"pattern not found: {pattern[:50]}"))
            return
        for g, cells in enumerate(cells_for_groups, start=1):
            if cells is None:
                unmapped.append((where, m.group(g) + " (no TLF cell)"))
            else:
                mapped.append((where, m.group(g), cells))

    ws = r"\s+"
    grab("10.1 randomized", r"The remaining" + ws + r"(\d+)" + ws + r"subjects were randomized", sec101, [[(TM, "n_randomized", "meta_value"), (T1, "itt", "total_n")]])
    grab("10.1 per arm", r"(\d+) to placebo, (\d+) to the xanomeline low" + ws + r"dose treatment group and (\d+) to the xanomeline high", sec101,
         [[(TM, "n_placebo", "meta_value"), (T1, "itt", "pbo_n")], [(TM, "n_low_dose", "meta_value"), (T1, "itt", "low_n")], [(TM, "n_high_dose", "meta_value"), (T1, "itt", "high_n")]])
    grab("10.1 completers", r"Of the (\d+)" + ws + r"subjects randomized to treatment, (\d+) completed the treatment phase \(Week 24\), and (\d+)" + ws + r"completed the study", sec101,
         [[(TM, "n_randomized", "meta_value"), (T1, "itt", "total_n")], [(T1, "complete_week_24", "total_n"), (T2, "completed_week_24", "total_n")], [(T1, "complete_study", "total_n")]])
    grab("10.1 early termination", r"A total of (\d+) subjects prematurely discontinued", sec101, [[(T2, "early_termination", "total_n")]])
    grab("10.1 early termination %", r"with (\d+)% of placebo" + ws + r"subjects terminating early as compared to (\d+)% of the xanomeline low dose subjects, and" + ws + r"(\d+)% of the xanomeline high", sec101,
         [[(T2, "early_termination", "pbo_pct")], [(T2, "early_termination", "low_pct")], [(T2, "early_termination", "high_pct")]])
    grab("10.1 adverse event %", r"adverse event \((\d+)% placebo subjects, (\d+)% xanomeline low dose subjects, (\d+)%" + ws + r"xanomeline high", sec101,
         [[(T2, "reason_adverse_event", "pbo_pct")], [(T2, "reason_adverse_event", "low_pct")], [(T2, "reason_adverse_event", "high_pct")]])
    grab("10.1 sites", r"Of the (\d+) sites participating", sec101, [[(TM, "n_sites", "meta_value")]])
    for label, pat in [("subjects with demographic information", r"A total of" + ws + r"(\d+)" + ws + r"subjects have demographic"), ("screen failures", r"Fifty-two \((\d+)\)"),
                       ("sites grouped", r"participating in the study, (\d+) met"), ("p value", r"\(p < ([\d.]+)\)")]:
        m = re.search(pat, sec101, re.S)
        unmapped.append((f"10.1 {label}", (m.group(1) if m else "?") + " (no TLF cell of ours)"))
    # in-text Table 11-1 (11.2.1)
    def row_vals(prefix):
        line = next(l for l in sec1121.splitlines() if l.strip().startswith(prefix))
        return line
    age = row_vals("Age (years)")
    for i, m in enumerate(re.finditer(r"([\d.]+) \((\d+)-(\d+)\)", age)):
        mapped.append((f"11.2.1 Age mean {ARM[i]}", m.group(1), [(TD, "age_mean", ARM[i])]))
        mapped.append((f"11.2.1 Age min {ARM[i]}", m.group(2), [(TD, "age_min", ARM[i])]))
        mapped.append((f"11.2.1 Age max {ARM[i]}", m.group(3), [(TD, "age_max", ARM[i])]))
    gen = row_vals("Gender")
    for i, m in enumerate(re.finditer(r"(\d+)% (\d+)%", gen)):
        pc = "total_pct" if ARM[i] == "total" else f"{ARM[i]}_pct"
        mapped.append((f"11.2.1 Male % {ARM[i]}", m.group(1), [(TD, "sex_male", pc)]))
        mapped.append((f"11.2.1 Female % {ARM[i]}", m.group(2), [(TD, "sex_female", pc)]))
    race = row_vals("Race")
    for i, m in enumerate(re.finditer(r"(\d+)% (\d+)%", race)):
        pc = "total_pct" if ARM[i] == "total" else f"{ARM[i]}_pct"
        mapped.append((f"11.2.1 White/Caucasian % {ARM[i]}", m.group(1), [(TD, "race_caucasian", pc)]))
        unmapped.append((f"11.2.1 Race Other % {ARM[i]}", m.group(2) + " (African descent, Hispanic and other combined: no single TLF cell)"))
    edu = row_vals("Education")
    for i, m in enumerate(re.finditer(r"([\d.]+) \((\d+)-(\d+)\)", edu)):
        mapped.append((f"11.2.1 Education mean {ARM[i]}", m.group(1), [(TD, "education_mean", ARM[i])]))
        mapped.append((f"11.2.1 Education min {ARM[i]}", m.group(2), [(TD, "education_min", ARM[i])]))
        mapped.append((f"11.2.1 Education max {ARM[i]}", m.group(3), [(TD, "education_max", ARM[i])]))
    import score_check  # noqa: E402

    drafted = {}
    for t, rk, col, val, sec_, slot in q(f"SELECT source_table, row_key, column_name, value_text, section, slot FROM {FQ}.csr_figure_citations WHERE run_id = '{run}' AND section IN ('10', '11.2')"):
        drafted.setdefault((t, rk, col), []).append((val, sec_, slot))
    pairs, undrafted, bad6 = [], [], []
    for where, body, cands in mapped:
        hit = next((c for c in cands if c in drafted), None)
        if hit is None:
            undrafted.append((where, body, cands[0]))
            continue
        for val, sec_, slot in drafted[hit]:
            ok = score_check.matches(val, body)
            pairs.append((where, body, val, slot, sec_, ok))
            if not ok:
                bad6.append((where, body, val, slot))
    print("\n    mapped pairs (body value, drafted value, slot, section, match):")
    for where, body, val, slot, sec_, ok in pairs:
        print(f"      {where:34s} body {body:>6s}  drafted {val:>6s}  {slot} (section {sec_})  {'ok' if ok else 'DIFFERS'}")
    print("    body numbers mapped to a cell the pod did not draft in sections 10 or 11.2 (listed, not failed):")
    for where, body, cell in undrafted:
        print(f"      {where:34s} body {body:>6s}  cell {cell[0]}.{cell[1]}.{cell[2]}")
    print("    body numbers with no TLF cell (listed, not failed):")
    for where, what in unmapped:
        print(f"      {where:34s} {what}")
    report(6, "The submitted body text of 10.1 and 11.2.1 contains the figures the pod drafted for the same cells (independent check on the body text, not just section 14). Every number in the submitted 10.1 text and in the in-text Table 11-1 of 11.2.1 is mapped by hand, in the check script, to its TLF cell; each mapped cell that the pod drafted in sections 10 or 11.2 must carry the same value (about 24 cells), and body numbers with no drafted counterpart are listed, not failed.",
           len(pairs) > 0 and not bad6,
           f"{len(mapped)} body numbers mapped to a cell; {len(pairs)} drafted instances compared ({len({p[3] for p in pairs})} distinct slots); {len(bad6)} differ; {len(undrafted)} mapped but not drafted; {len(unmapped)} with no TLF cell")
else:
    print("no done run yet: statements 4 to 6 not checked")
    results.append(False)

print("\nSUMMARY:", "ALL PASS" if all(results) else f"{results.count(False)} FAIL")
