"""Row definitions of the 8 TLF tables, shared by tlf_build.py (derivations) and build_answer_key.py (printed values).

A row has a readable row_key and the labels as they are printed in the submitted section 14 table. The
answer-key mapper finds the printed row by its printed labels (never by a value) and reads the cells.
Nothing in this file contains a number from the submitted report.
"""
import re

ARMS = [("pbo", "Placebo"), ("low", "Xanomeline Low Dose"), ("high", "Xanomeline High Dose")]
TOTAL = "total"


def slug(s: str) -> str:
    s = s.lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


# --------------------------------------------------------------------------------------------------
# Row builders. Each row: dict(key, label, group, sub, decimals, cells=[(column, printed_col, token)])
# printed_col is the index of the HTML cell (after the label cells), token the index of the number in it.
# --------------------------------------------------------------------------------------------------
def _cells_value(prefixes, first_col, token=0):
    return [(p, first_col + i, token) for i, p in enumerate(prefixes)]


def row(key, label, group, sub, decimals, cells):
    return dict(key=key, label=label, group=group, sub=sub, decimals=decimals, cells=cells)


# ---- 14-1.01 Summary of populations (label in cell 0, values 1..4 as "n (pct%)"; contract keeps n only)
T1401 = "tlf_14_1_01_populations"
POP_LABELS = [
    ("itt", "Intent-to-treat (ITT)", "Intent-To-Treat (ITT)"),
    ("safety", "Safety", "Safety"),
    ("efficacy", "Efficacy", "Efficacy"),
    ("complete_week_24", "Completed Week 24", "Complete Week 24"),
    ("complete_study", "Completed study", "Complete Study"),
]
ROWS_1401 = [
    row(k, lab, pl, None, 0, [(f"{p}_n", 1 + i, 0) for i, p in enumerate(["pbo", "low", "high", "total"])])
    for k, lab, pl in POP_LABELS
]
COLS_1401 = [("pbo_n", "INT"), ("low_n", "INT"), ("high_n", "INT"), ("total_n", "INT")]

# ---- 14-1.02 Summary of end of study data (label cell 0, values 1..4 "n (pct%)")
T1402 = "tlf_14_1_02_disposition"
DISP = [
    ("completed_week_24", "Completed Week 24", "Completed Week 24", 1),
    ("early_termination", "Early termination (prior to Week 24)", "Early Termination (prior to Week 24)", 1),
    ("status_missing", "Completion status missing", "Missing", 1),
    ("reason_adverse_event", "Reason: adverse event", "Adverse Event", 2),
    ("reason_death", "Reason: death", "Death", 2),
    ("reason_lack_of_efficacy", "Reason: lack of efficacy", "Lack of Efficacy[2]", 2),
    ("reason_lost_to_followup", "Reason: lost to follow-up", "Lost to Follow-up", 2),
    ("reason_subject_withdrew", "Reason: subject decided to withdraw", "Subject decided to withdraw", 2),
    ("reason_physician_withdrew", "Reason: physician decided to withdraw subject", "Physician decided to withdraw subject", 2),
    ("reason_protocol_criteria", "Reason: protocol criteria not met", "Protocol criteria not met", 2),
    ("reason_protocol_violation", "Reason: protocol violation", "Protocol violation", 2),
    ("reason_sponsor_decision", "Reason: sponsor decision", "Sponsor decision", 2),
    ("reason_missing", "Reason missing", "Missing", 2),
]
ROWS_1402 = []
for k, lab, pl, block in DISP:
    cells = []
    for i, p in enumerate(["pbo", "low", "high", "total"]):
        cells += [(f"{p}_n", 1 + i, 0), (f"{p}_pct", 1 + i, 1)]
    ROWS_1402.append(row(k, lab, pl, None, 0, cells) | dict(block=block))
COLS_1402 = [(f"{p}_{s}", t) for p in ["pbo", "low", "high", "total"] for s, t in (("n", "INT"), ("pct", "DOUBLE"))]

# ---- 14-2.01 Demographics (group cell 0, sub cell 1, values 2..5, p-value cell 6)
T1403 = "tlf_14_2_01_demographics"
COLS_1403 = [("pbo", "DOUBLE"), ("pbo_pct", "DOUBLE"), ("low", "DOUBLE"), ("low_pct", "DOUBLE"), ("high", "DOUBLE"),
             ("high_pct", "DOUBLE"), ("total", "DOUBLE"), ("total_pct", "DOUBLE"), ("p_value", "DOUBLE")]
STATS = [("n", "n", 0), ("mean", "Mean", 1), ("sd", "SD", 2), ("median", "Median", 1), ("min", "Min", 1), ("max", "Max", 1)]
CONT_VARS = [  # key, group label, printed group label, adsl column
    ("age", "Age (years)", "Age (y)", "AGE"),
    ("mmse", "MMSE", "MMSE", "MMSETOT"),
    ("duration_of_disease", "Duration of disease (months)", "Duration of disease", "DURDIS"),
    ("education", "Years of education", "Years of education", "EDUCLVL"),
    ("weight", "Baseline weight (kg)", "Baseline weight (kg)", "WEIGHTBL"),
    ("height", "Baseline height (cm)", "Baseline height (cm)", "HEIGHTBL"),
    ("bmi", "Baseline BMI", "Baseline BMI", "BMIBL"),
]
# categorical blocks: key prefix, group label (printed), items (key, label, printed sub label)
CAT_BLOCKS = {
    "age": [("age_lt65", "Age under 65 years", "<65 yrs"), ("age_65_to_80", "Age 65 to 80 years", "65-80 yrs"), ("age_gt80", "Age over 80 years", ">80 yrs")],
    "sex": [("sex_male", "Male", "Male"), ("sex_female", "Female", "Female")],
    "race": [("race_caucasian", "Race: Caucasian", "Caucasian"), ("race_african_descent", "Race: African descent", "African Descent"),
             ("race_hispanic", "Race: Hispanic", "Hispanic"), ("race_other", "Race: other", "Other")],
    "duration_of_disease": [("duration_lt12", "Duration of disease under 12 months", "<12 months"), ("duration_ge12", "Duration of disease 12 months or more", ">=12 months")],
    "bmi": [("bmi_lt25", "BMI under 25", "<25"), ("bmi_25_to_lt30", "BMI 25 to under 30", "25-<30"), ("bmi_ge30", "BMI 30 or more", ">=30")],
}
CAT_GROUP = {"age": "Age (y)", "sex": "Sex", "race": "Race (Origin)", "duration_of_disease": "Duration of disease", "bmi": "Baseline BMI"}
ROWS_1403 = []
_order_vars = ["age", "sex", "race", "mmse", "duration_of_disease", "education", "weight", "height", "bmi"]
_cont = {c[0]: c for c in CONT_VARS}


def _cells_demo(count=False, p=False):
    cells = []
    for i, pfx in enumerate(["pbo", "low", "high", "total"]):
        if count:
            cells += [(pfx, 2 + i, 0), (f"{pfx}_pct", 2 + i, 1)]
        else:
            cells += [(pfx, 2 + i, 0)]
    if p:
        cells.append(("p_value", 6, 0))
    return cells


for v in _order_vars:
    if v == "sex":
        ROWS_1403.append(row("sex_n", "Sex: n", "Sex", "n", 0, _cells_demo(p=True)))
    elif v == "race":
        ROWS_1403.append(row("race_n", "Race: n", "Race (Origin)", "n", 0, _cells_demo(p=True)))
    else:
        k, lab, pg, _col = _cont[v]
        for sk, sl, dec in [(s[0], s[1], s[2]) for s in STATS]:
            ROWS_1403.append(row(f"{k}_{sk}", f"{lab}: {sl.lower() if sl != 'n' else 'n'}", pg, sl, dec if sk != "n" else 0,
                                 _cells_demo(p=(sk == "n"))))
    for ck, cl, ps in CAT_BLOCKS.get(v, []):
        first = ck == CAT_BLOCKS[v][0][0]
        ROWS_1403.append(row(ck, cl, CAT_GROUP[v], ps, 0, _cells_demo(count=True, p=first)))
# printed decimals: n 0, mean 1, sd 2, median 1, min 1, max 1 (as printed); pct 0 decimals; p 4 decimals
DECIMALS_1403 = {"p_value": 4}

# ---- 14-3.01 / 14-3.02 (label cell 0, values 1..3)
COLS_EFF = [("pbo", "DOUBLE"), ("low", "DOUBLE"), ("high", "DOUBLE"), ("p_value", "DOUBLE")]
T1404 = "tlf_14_3_01_adascog_w24"
T1405 = "tlf_14_3_02_cibic_w24"


def _eff_rows(blocks, with_cat_baseline):
    rows = []
    for bk, bl, pg in blocks:
        for sk, sl, ps, token_row in [
            ("n", "n", "n", None), ("mean", "mean", "Mean (SD)", 0), ("sd", "SD", "Mean (SD)", 1),
            ("median", "median", "Median (Range)", 0), ("min", "minimum", "Median (Range)", 1), ("max", "maximum", "Median (Range)", 2),
        ]:
            tok = 0 if token_row is None else token_row
            dec = {"n": 0, "mean": 1, "sd": 2, "median": 1, "min": 0, "max": 0}[sk]
            rows.append(row(f"{bk}_{sk}", f"{bl}: {sl}", pg, ps, dec, _cells_value(["pbo", "low", "high"], 1, tok)))
    return rows


def _eff_model_rows():
    r = []
    r.append(row("p_dose_response", "p value, dose response", None, "p-value(Dose Response)", 3, [("p_value", 3, 0)]))
    r.append(row("p_vs_placebo", "p value, xanomeline versus placebo", None, "p-value(Xan - Placebo)", 3, [("low", 2, 0), ("high", 3, 0)]))
    r.append(row("diff_vs_placebo", "Difference of LS means versus placebo", None, "Diff of LS Means (SE)#1", 1, [("low", 2, 0), ("high", 3, 0)]))
    r.append(row("se_diff_vs_placebo", "Standard error of the difference versus placebo", None, "Diff of LS Means (SE)#1", 2, [("low", 2, 1), ("high", 3, 1)]))
    r.append(row("ci_low_vs_placebo", "95% CI lower limit versus placebo", None, "95% CI#1", 1, [("low", 2, 0), ("high", 3, 0)]))
    r.append(row("ci_high_vs_placebo", "95% CI upper limit versus placebo", None, "95% CI#1", 1, [("low", 2, 1), ("high", 3, 1)]))
    r.append(row("p_high_vs_low", "p value, high dose versus low dose", None, "p-value(Xan High - Xan Low)", 3, [("p_value", 3, 0)]))
    r.append(row("diff_high_vs_low", "Difference of LS means, high dose versus low dose", None, "Diff of LS Means (SE)#2", 1, [("high", 3, 0)]))
    r.append(row("se_diff_high_vs_low", "Standard error of the difference, high dose versus low dose", None, "Diff of LS Means (SE)#2", 2, [("high", 3, 1)]))
    r.append(row("ci_low_high_vs_low", "95% CI lower limit, high dose versus low dose", None, "95% CI#2", 1, [("high", 3, 0)]))
    r.append(row("ci_high_high_vs_low", "95% CI upper limit, high dose versus low dose", None, "95% CI#2", 1, [("high", 3, 1)]))
    return r


ROWS_1404 = _eff_rows([("baseline", "Baseline", "Baseline"), ("week24", "Week 24", "Week 24"), ("change", "Change from baseline", "Change from Baseline")], True) + _eff_model_rows()
ROWS_1405 = _eff_rows([("week24", "Week 24", "Week 24")], False) + _eff_model_rows()

# ---- 14-4.01 Exposure (group cell 0, stat cell 1, values 2..7; safety population = printed columns 5..7)
T1406 = "tlf_14_4_01_exposure"
COLS_1406 = [("pbo", "DOUBLE"), ("low", "DOUBLE"), ("high", "DOUBLE"), ("total", "DOUBLE")]
ROWS_1406 = []
for gk, gl, pg in [("avg_daily_dose", "Average daily dose (mg)", "Average daily dose (mg)"), ("cumulative_dose", "Cumulative dose at end of study (mg)", "Cumulative dose at end of study [2]")]:
    for sk, sl, ps, dec in [("n", "n", "n", 0), ("mean", "mean", "mean", 1), ("sd", "SD", "std", 2), ("median", "median", "median", 1), ("min", "minimum", "min", 1), ("max", "maximum", "max", 1)]:
        ROWS_1406.append(row(f"{gk}_{sk}", f"{gl}: {sl}", pg, ps, dec, [("pbo", 5, 0), ("low", 6, 0), ("high", 7, 0)]))

# ---- 14-5.01 / 14-5.02 (label cell 0; arm entries parsed from the row text)
T1407 = "tlf_14_5_02_sae"
T1408 = "tlf_14_5_01_teae"
COLS_AE = [(f"{p}_{s}", t) for p in ["pbo", "low", "high", "total"] for s, t in (("n", "INT"), ("pct", "DOUBLE"))]

TABLES = {
    T1401: dict(tlf="14-1.01", title="Summary of populations", rows=ROWS_1401, cols=COLS_1401, pages=[43]),
    T1402: dict(tlf="14-1.02", title="Summary of end of study data", rows=ROWS_1402, cols=COLS_1402, pages=[44]),
    T1403: dict(tlf="14-2.01", title="Summary of demographic and baseline characteristics", rows=ROWS_1403, cols=COLS_1403, pages=[46, 47, 48]),
    T1404: dict(tlf="14-3.01", title="ADAS-Cog (11) change from baseline to Week 24, LOCF", rows=ROWS_1404, cols=COLS_EFF, pages=[49]),
    T1405: dict(tlf="14-3.02", title="CIBIC+ summary at Week 24, LOCF", rows=ROWS_1405, cols=COLS_EFF, pages=[50]),
    T1406: dict(tlf="14-4.01", title="Summary of planned exposure to study drug", rows=ROWS_1406, cols=COLS_1406, pages=[62]),
    T1407: dict(tlf="14-5.02", title="Incidence of treatment emergent serious adverse events", rows=None, cols=COLS_AE, pages=[79]),
    T1408: dict(tlf="14-5.01", title="Incidence of treatment emergent adverse events", rows=None, cols=COLS_AE, pages=list(range(63, 79))),
}
IN_SCOPE = list(TABLES)
