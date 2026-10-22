"""Create study_metadata, narrative_patients, section_registry and the engine tables of the CSR Pod.

    uv run --python 3.12 --with databricks-sql-connector python scripts/pod_data.py

section_registry is the empty ICH E3 template: instructions (outline points), plain-language search hints,
tables, dependencies and required content per section. It holds no passages and no figures. The pod finds the
protocol and SAP passages with AI Search.

Engine tables are created empty: csr_runs, csr_sections, csr_figure_citations, csr_signoffs, csr_scores.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402

FQ = dbx.FQ
NOTE = dbx.SOURCE_NOTE


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + dbx.esc(str(v)) + "'"


def tlf(table, number, alias, keys=None, min_pct=None):
    d = {"table": table, "tlf": f"Table {number}", "alias": alias, "version": None}
    if keys:
        d["keys"] = keys
    if min_pct is not None:
        d["min_pct"] = min_pct
    return d


POP = tlf("tlf_14_1_01_populations", "14-1.01", "pop")
DISP = tlf("tlf_14_1_02_disposition", "14-1.02", "disp")
DEMO = tlf("tlf_14_2_01_demographics", "14-2.01", "demo", keys=[
    "age_n", "age_mean", "age_sd", "age_lt65", "age_65_to_80", "age_gt80", "sex_male", "sex_female", "race_caucasian",
    "race_african_descent", "race_hispanic", "race_other", "mmse_mean", "mmse_sd", "duration_of_disease_mean",
    "education_mean", "weight_mean", "bmi_mean", "bmi_lt25", "bmi_25_to_lt30", "bmi_ge30"])
ADAS = tlf("tlf_14_3_01_adascog_w24", "14-3.01", "ada")
CIBIC = tlf("tlf_14_3_02_cibic_w24", "14-3.02", "cib")
EXPO = tlf("tlf_14_4_01_exposure", "14-4.01", "exp", keys=[
    "avg_daily_dose_n", "avg_daily_dose_mean", "avg_daily_dose_sd", "cumulative_dose_n", "cumulative_dose_mean", "cumulative_dose_sd",
    "cumulative_dose_median", "cumulative_dose_min", "cumulative_dose_max"])
TEAE = tlf("tlf_14_5_01_teae", "14-5.01", "teae", min_pct=10)
SAE = tlf("tlf_14_5_02_sae", "14-5.02", "sae")

# section, title, kind, agent, department, wave, instructions, search_hints, tables, depends_on, required_content
S = []


def sec(section, title, kind, agent, dept, wave=None, instructions="", hints=None, tables=None, deps=None, required=None):
    S.append(dict(section=section, title=title, kind=kind, agent=agent, department=dept, wave=wave, instructions=instructions,
                  hints=hints or [], tables=tables or [], deps=deps or [], required=required or []))


MW, BS, CS, RO = "Medical Writing", "Biostatistics", "Clinical Safety", "Regulatory Operations"
sec("1", "Title page", "assembled", "assembler", RO)
sec("2", "Synopsis", "drafted", "author", MW, 3,
    "Summarise the study for a reader who will read nothing else.\nState the objective and the design in one sentence each.\nSay how many subjects were randomised to each treatment group and how many were in the efficacy population.\n"
    "Summarise the primary efficacy results for ADAS-Cog (11) and CIBIC+ at Week 24 and state whether the dose response was significant.\nSummarise exposure and serious adverse events.\nGive one concluding sentence.\n"
    "Use only figures that the body sections already quote.",
    ["study design and objectives", "primary efficacy endpoints"], [POP, ADAS, CIBIC, EXPO, SAE],
    ["7", "8", "10", "11.1", "11.4.1", "11.4.2", "12.1", "12.3", "13"],
    ["objective", "design", "efficacy population", "ADAS-Cog (11)", "CIBIC+", "serious adverse events", "conclusion"])
sec("3", "Table of contents", "assembled", "assembler", RO)
sec("4", "List of abbreviations", "assembled", "assembler", RO)
sec("5", "Ethics", "boilerplate", "assembler", RO)
sec("6", "Investigators and study administrative structure", "boilerplate", "assembler", RO)
sec("7", "Introduction", "drafted", "author", MW, 1,
    "Introduce the study: the disease, the investigational product and why the study was done.\nSay that the report describes the efficacy and safety of transdermal xanomeline compared with placebo in patients with mild to moderate Alzheimer's disease.\nDo not report results.",
    ["background of Alzheimer's disease and rationale for xanomeline", "study introduction"], [], [],
    ["investigational product", "disease background", "purpose of the report"])
sec("8", "Study objectives", "drafted", "author", MW, 1,
    "State the primary objective and the secondary objectives as in the protocol.\nName the primary efficacy endpoints (ADAS-Cog (11) and CIBIC+ at Week 24).\nDo not report results.",
    ["study objectives", "primary and secondary objectives"], [], [], ["primary objective", "secondary objectives", "primary endpoints"])
sec("9", "Investigational plan", "drafted", "author", MW, 1,
    "Describe the overall design: randomised, double-blind, placebo-controlled, parallel-group, three treatment groups.\nDescribe the study population and the main eligibility criteria.\nDescribe the treatments and how the patch was applied.\n"
    "Describe the efficacy and safety variables.\nDescribe the planned statistical methods, including the analysis populations, the handling of missing data (last observation carried forward) and the test for dose response.\nDo not report results.",
    ["overall study design", "selection of the study population", "treatments and dosing", "efficacy and safety variables", "statistical methods and analysis populations", "last observation carried forward imputation"],
    [], [], ["design", "population", "treatments", "efficacy variables", "safety variables", "statistical methods"])
sec("10", "Study subjects", "drafted", "author", BS, 1,
    "Report the disposition of subjects: how many were randomised to each group, how many completed Week 24 and how many stopped early.\nReport the reasons for early termination, with adverse events first.\nPoint to Table 14-1.02.",
    ["subject disposition and reasons for discontinuation"], [DISP, POP], [],
    ["subjects randomised", "completed Week 24", "reasons for early termination"])
sec("11.1", "Data sets analysed", "drafted", "author", BS, 1,
    "Define the intent-to-treat, safety and efficacy populations and the completers at Week 24.\nReport how many subjects were in each population by treatment group.\nPoint to Table 14-1.01.",
    ["analysis populations: intent-to-treat, safety, efficacy, completers"], [POP], [],
    ["intent-to-treat population", "safety population", "efficacy population", "completers"])
sec("11.2", "Demographic and other baseline characteristics", "drafted", "author", BS, 1,
    "Summarise age, sex, race and baseline disease severity (MMSE) by treatment group.\nReport the age groups and the baseline weight and body mass index.\nSay whether the groups were balanced at baseline and refer to Table 14-2.01.",
    ["demographic and baseline characteristics analysis"], [DEMO], [], ["age", "sex", "race", "MMSE", "baseline balance"])
sec("11.3", "Measurements of treatment compliance", "not_in_demo", "author", BS, None,
    "Not part of this demo: compliance is not summarised in the pilot tables used here. Extent of exposure is in section 12.1.")
sec("11.4.1", "ADAS-Cog (11)", "drafted", "author", BS, 1,
    "Report the primary analysis of ADAS-Cog (11) at Week 24 on the efficacy population with last observation carried forward.\nReport the baseline and Week 24 means and the mean change from baseline in each group.\n"
    "Report the test for dose response and say whether it was significant.\nReport the pairwise differences versus placebo with their 95% confidence intervals and p values, noting that they are not to be interpreted if the dose response was not significant.\nPoint to Table 14-3.01.",
    ["ADAS-Cog change from baseline to Week 24 analysis", "analysis of covariance and test for dose response", "pairwise comparisons"], [ADAS], [],
    ["baseline and Week 24 means", "change from baseline", "dose response test", "pairwise comparisons versus placebo"])
sec("11.4.2", "CIBIC+", "drafted", "author", BS, 1,
    "Report the CIBIC+ score at Week 24 on the efficacy population with last observation carried forward.\nReport the mean score in each group, the test for dose response and the pairwise differences versus placebo.\nPoint to Table 14-3.02.",
    ["CIBIC+ analysis at Week 24", "analysis of variance with site and treatment"], [CIBIC], [],
    ["mean score at Week 24", "dose response test", "pairwise comparisons versus placebo"])
sec("11.4.3", "NPI-X", "not_in_demo", "author", BS, None, "Not part of this demo: no table for NPI-X is in scope.")
sec("11.5", "Efficacy conclusions", "drafted", "author", MW, 2,
    "Conclude on the two primary efficacy endpoints using the results of sections 11.4.1 and 11.4.2.\nState whether a significant dose response was seen for each.\nDo not add new analyses.",
    [], [ADAS, CIBIC], ["11.4.1", "11.4.2"], ["conclusion on ADAS-Cog (11)", "conclusion on CIBIC+"])
sec("12.1", "Extent of exposure", "drafted", "author", CS, 1,
    "Report the average daily dose and the cumulative dose at the end of study for each treatment group (safety population).\nPoint to Table 14-4.01.",
    ["study drug exposure and dose"], [EXPO], [], ["average daily dose", "cumulative dose"])
sec("12.2", "Adverse events", "drafted", "author", CS, 1,
    "Give a brief summary of treatment-emergent adverse events: the number and percentage of subjects with at least one event in each group.\nReport the system organ classes and the preferred terms that were most common, and say which were more frequent on xanomeline than on placebo.\n"
    "Refer to Table 14-5.01 and say that the counts are subjects, not events.\nDo not interpret causality.",
    ["definition of treatment-emergent adverse events", "adverse event reporting and MedDRA coding", "safety analysis methods"], [TEAE], [],
    ["subjects with any adverse event", "most common system organ classes", "most common preferred terms", "comparison with placebo"])
sec("12.3", "Analysis of death, other serious adverse events and other significant adverse events", "drafted", "author", CS, 1,
    "Report the deaths and the serious adverse events by treatment group.\nState how many subjects had a serious treatment-emergent adverse event in each group and name the preferred terms.\nPoint to Table 14-5.02 and to the narratives in section 12.3.4.",
    ["serious adverse events definition and reporting", "deaths"], [SAE], [], ["deaths", "serious adverse events", "reference to narratives"])
sec("12.3.4", "Narratives of deaths, other serious adverse events and certain other significant adverse events", "narrative", "narrative", CS, 1)
sec("12.4", "Clinical laboratory evaluation", "not_in_demo", "author", CS, None, "Not part of this demo: laboratory tables (14-6.x) are out of scope.")
sec("12.5", "Vital signs and weight", "not_in_demo", "author", CS, None, "Not part of this demo: vital signs tables (14-7.x) are out of scope.")
sec("12.6", "Concomitant medications", "not_in_demo", "author", CS, None, "Not part of this demo.")
sec("12.7", "Safety conclusions", "drafted", "author", CS, 2,
    "Conclude on safety using sections 12.1 and 12.3.\nSay what the exposure and the serious events showed, without new analyses and without causal claims.",
    [], [EXPO, SAE], ["12.1", "12.3"], ["conclusion on exposure", "conclusion on serious adverse events"])
sec("13", "Discussion of study results and conclusions", "drafted", "author", MW, 2,
    "Discuss the results of the two primary endpoints and the safety findings in context.\nState the overall conclusion in one or two sentences.\nUse only the figures that sections 11.4 and 12.3 already quote.",
    [], [ADAS, CIBIC, SAE], ["11.4.1", "11.4.2", "12.3"], ["discussion of efficacy", "discussion of safety", "overall conclusion"])
sec("14", "Tables, figures and graphs", "assembled", "assembler", RO)
sec("15", "Reference list", "assembled", "assembler", RO)
sec("16", "Appendices", "assembled", "assembler", RO)

META = [  # key, value, type
    ("study_id", "CDISCPILOT01", "text"),
    ("title", "Safety and Efficacy of the Xanomeline Transdermal Therapeutic System (TTS) in Patients with Mild to Moderate Alzheimer's Disease", "text"),
    ("short_title", "Xanomeline TTS in mild to moderate Alzheimer's disease", "text"),
    ("phase", "Phase 2", "text"),
    ("product", "Xanomeline Transdermal Therapeutic System (TTS)", "text"),
    ("indication", "Mild to moderate Alzheimer's disease", "text"),
    ("sponsor", "CDISC Pilot Project", "text"),
    ("protocol_number", "H2Q-MC-LZZT(c)", "text"),
    ("design", "Prospective, randomised, multi-centre, double-blind, placebo-controlled, parallel-group study", "text"),
    ("treatment_groups", "Placebo; xanomeline low dose; xanomeline high dose", "text"),
    ("n_sites", None, "number"),
    ("n_randomized", None, "number"),
    ("n_placebo", None, "number"),
    ("n_low_dose", None, "number"),
    ("n_high_dose", None, "number"),
    ("first_subject_visit", None, "date"),
    ("last_subject_completion", None, "date"),
    ("treatment_weeks", "26", "number"),
    ("gcp_statement", "The study was conducted in accordance with ICH Good Clinical Practice. A list of principal investigators is not provided in this pilot project.", "text"),
    ("data_source", "CDISC SDTM/ADaM Pilot Project, CDISCPILOT01. Used under the CDISC terms of use.", "text"),
]


def main():
    q = dbx.runner()
    # ---- study_metadata (numbers and dates from ADSL, the rest from the title page of the submitted report)
    q(f"""CREATE OR REPLACE TABLE {FQ}.study_metadata (meta_key STRING, meta_value STRING, value_type STRING)
        COMMENT 'Study facts for the title page and the introduction: text from the CSR title page, numbers and dates from ADSL. Number-valued keys become placeholders meta_<key>. {NOTE}'""")
    adsl = q(f"""SELECT count(distinct SITEID), count(*), count(*) FILTER (WHERE TRT01P = 'Placebo'), count(*) FILTER (WHERE TRT01P = 'Xanomeline Low Dose'),
        count(*) FILTER (WHERE TRT01P = 'Xanomeline High Dose'), date_format(min(VISIT1DT), 'd MMMM yyyy'), date_format(max(RFENDT), 'd MMMM yyyy') FROM {FQ}.adam_adsl""")[0]
    computed = dict(n_sites=adsl[0], n_randomized=adsl[1], n_placebo=adsl[2], n_low_dose=adsl[3], n_high_dose=adsl[4], first_subject_visit=adsl[5], last_subject_completion=adsl[6])
    rows = [(k, str(computed.get(k, v)), t) for k, v, t in META]
    q(f"INSERT INTO {FQ}.study_metadata VALUES " + ",".join(f"({lit(a)},{lit(b)},{lit(c)})" for a, b, c in rows))
    q(f"ALTER TABLE {FQ}.study_metadata SET TAGS ({dbx.TAGS})")
    # ---- narrative_patients: deaths (ADSL.DTHFL) and serious adverse events (ADAE.AESER)
    q(f"""CREATE OR REPLACE TABLE {FQ}.narrative_patients
        COMMENT 'Subjects with a death (ADSL.DTHFL) or a serious adverse event (ADAE.AESER) for the safety narratives. {NOTE}' AS
        SELECT e.USUBJID AS row_key, s.TRT01A AS arm, CAST(s.AGE AS INT) AS age, s.SEX AS sex, e.AEDECOD AS aedecod, e.AESOC AS aesoc,
          CAST(e.ASTDY AS INT) AS astdy, CAST(e.AENDY AS INT) AS aendy, e.AEOUT AS aeout, e.AEACN AS aeacn, e.AEREL AS aerel,
          CAST(s.TRTDUR AS INT) AS trtdur,
          CASE WHEN s.DTHFL = 'Y' AND e.AESDTH = 'Y' THEN 'Death' ELSE 'Serious adverse event' END AS narrative_reason
        FROM {FQ}.adam_adae e JOIN {FQ}.adam_adsl s ON s.USUBJID = e.USUBJID
        WHERE (e.AESER = 'Y' OR e.AESDTH = 'Y') AND e.TRTEMFL = 'Y'""")
    q(f"ALTER TABLE {FQ}.narrative_patients SET TAGS ({dbx.TAGS})")
    # ---- section_registry
    q(f"""CREATE OR REPLACE TABLE {FQ}.section_registry (section STRING, title STRING, ord INT, kind STRING, agent STRING, department STRING, wave INT,
        instructions STRING, search_hints STRING, tlf_tables STRING, depends_on STRING, required_content STRING)
        COMMENT 'The empty ICH E3 template of the CSR as data: instructions, plain-language search hints (no passages), certified tables, dependencies and required content per section. {NOTE}'""")
    vals = []
    for i, s in enumerate(S):
        vals.append("(" + ",".join([lit(s["section"]), lit(s["title"]), str(i + 1), lit(s["kind"]), lit(s["agent"]), lit(s["department"]),
                                    "NULL" if s["wave"] is None else str(s["wave"]), lit(s["instructions"]), lit(json.dumps(s["hints"])),
                                    lit(json.dumps(s["tables"])), lit(json.dumps(s["deps"])), lit(json.dumps(s["required"]))]) + ")")
    q(f"INSERT INTO {FQ}.section_registry VALUES " + ",".join(vals))
    q(f"ALTER TABLE {FQ}.section_registry SET TAGS ({dbx.TAGS})")
    # ---- engine tables
    ddl = {
        "csr_runs": """run_id STRING, base_run_id STRING, status STRING, started_at TIMESTAMP, finished_at TIMESTAMP, table_versions_json STRING,
            sections_requested STRING, plan_json STRING, document_checks_json STRING, score_json STRING, model STRING, judge_model STRING, trace_id STRING,
            wall_ms BIGINT, events_json STRING, superseded BOOLEAN""",
        "csr_sections": """run_id STRING, section STRING, title STRING, ord INT, kind STRING, agent STRING, department STRING, status STRING, templates_json STRING,
            sentences_json STRING, sources_json STRING, checks_json STRING, judge_json STRING, needs_person_json STRING, tool_log_json STRING, trace_id STRING, drafted_at TIMESTAMP""",
        "csr_figure_citations": """run_id STRING, section STRING, sentence_idx INT, slot STRING, source_table STRING, tlf STRING, row_key STRING, column_name STRING,
            table_version BIGINT, value_text STRING""",
        "csr_signoffs": """signoff_id STRING, run_id STRING, department STRING, scope STRING, signer STRING, role STRING, decision STRING, note STRING,
            table_versions_json STRING, signed_at TIMESTAMP""",
        "csr_scores": """run_id STRING, section STRING, figures_total INT, figures_matched INT, mismatches_json STRING, coverage_score INT, coverage_notes STRING,
            left_for_person_json STRING, judge_model STRING, trace_id STRING, scored_at TIMESTAMP""",
    }
    comments = {
        "csr_runs": "One row per CSR Pod run. table_versions_json holds the Delta version of every certified table the run was bound to. superseded marks runs hidden by scripts/reset_demo.py.",
        "csr_sections": "One row per section of a run: the drafted sentences with their bound figures, checks, judge result and tool calls.",
        "csr_figure_citations": "One row per figure in a drafted sentence: the certified cell (table, row, column, Delta version) it was filled from.",
        "csr_signoffs": "Departmental sign-offs of a run, with the table versions the signer checked.",
        "csr_scores": "Score of each drafted section against the submitted CSR: figures matched to printed cells, content coverage 1 to 5 by a judge on a second model family.",
    }
    for t, cols in ddl.items():
        q(f"CREATE OR REPLACE TABLE {FQ}.{t} ({cols}) COMMENT '{dbx.esc(comments[t])} {NOTE}'")
        q(f"ALTER TABLE {FQ}.{t} SET TAGS ({dbx.TAGS})")
    for t in ["study_metadata", "narrative_patients", "section_registry"]:
        print(t, q(f"SELECT count(*) FROM {FQ}.{t}")[0][0])
    print([tuple(r) for r in q(f"SELECT row_key, arm, narrative_reason, aedecod FROM {FQ}.narrative_patients ORDER BY 1")])


if __name__ == "__main__":
    main()
