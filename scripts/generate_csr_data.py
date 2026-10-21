"""Build the data layer for the full-CSR demo (M1) in sean_zhang_catalog.rnd_regsub_review.

Run (Python 3.12 + Databricks Connect serverless, profile fe-vm-sean-zhang):

    uv run --python 3.12 --with "databricks-connect>=16.4,<17.4" --with numpy --with pandas \
        python scripts/generate_csr_data.py

What it does, in order:
  1. Reads adsl and adeff (never modifies them) and builds the analysis datasets adsl_ext, adds,
     addv, adex, adae and adeff_sec from a fixed seed. The adverse event, disposition and
     per-protocol sets are constructed so that they reproduce safety_overview and the existing
     adsl/adeff facts exactly.
  2. Builds 7 certified TLF tables with CREATE TABLE AS SELECT from the analysis tables (so Unity
     Catalog lineage exists), then sets the certification tag, the project tags, a table comment
     and a comment on every numeric column.
  3. Writes study_metadata, narrative_patients (CTAS from adae) and section_registry.
  4. Creates the 4 engine tables (csr_runs, csr_sections, csr_figure_citations, csr_signoffs) only
     if they do not exist, because the app writes them.
  5. Asserts the consistency rules and fails loudly if any of them breaks.

Safe to re-run: it drops and recreates only the tables it owns, and never touches the 4 engine
tables once they exist. Existing tables (adsl, adeff, efficacy_primary, safety_overview and the
rest) are read at most, never written.
"""
import json
import os
import sys
import time

os.environ["TZ"] = "UTC"
time.tzset()
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402

from databricks.connect import DatabricksSession  # noqa: E402
from pyspark.sql.types import (  # noqa: E402
    DoubleType, IntegerType, StringType, StructField, StructType,
)

FQ = dbx.FQ
SEED = 301472
T, P = "LMN-4471 400 mg", "Placebo"
TAGS = "'sz_domain' = 'rnd', 'sz_project' = 'regsub_review', 'asset_class' = 'app'"
CERT = "'system.certification_status' = 'certified'"
SYN = "Synthetic data, not real patients."

spark = DatabricksSession.builder.remote(host=dbx.HOST, token=dbx.token(), serverless=True).getOrCreate()
sql = spark.sql


def banner(msg: str) -> None:
    print(f"\n== {msg}")


def one(stmt: str):
    return sql(stmt).first()[0]


def q_esc(s: str) -> str:
    return s.replace("'", "''")


OWNED = ["adsl_ext", "adds", "addv", "adex", "adae", "adeff_sec",
         "tlf_14_1_1_disposition", "tlf_14_1_2_demographics", "tlf_14_2_2_pp", "tlf_14_2_3_secondary",
         "tlf_14_2_4_subgroups", "tlf_14_3_2_ae_soc_pt", "tlf_14_3_3_exposure",
         "study_metadata", "narrative_patients", "section_registry"]
ENGINE = ["csr_runs", "csr_sections", "csr_figure_citations", "csr_signoffs"]
TLF_TABLES = [t for t in OWNED if t.startswith("tlf_")]

banner("snapshot of pre-existing tables")
before = {r["tableName"] for r in sql(f"SHOW TABLES IN {FQ}").collect()}
pre_existing = sorted(before - set(OWNED) - set(ENGINE))
print(len(pre_existing), "pre-existing tables:", pre_existing)
for must in ["adsl", "adeff", "efficacy_primary", "safety_overview", "doc_elements"]:
    assert must in before, f"{must} must exist before the CSR data build"
ver_before = one(f"SELECT MAX(version) FROM (DESCRIBE HISTORY {FQ}.efficacy_primary)")
assert ver_before == 4, f"efficacy_primary must be at version 4 before we start, found {ver_before}"

banner("drop the tables this script owns")
for t in OWNED:
    sql(f"DROP TABLE IF EXISTS {FQ}.{t}")

# --------------------------------------------------------------------------------------
# 1. Analysis datasets
# --------------------------------------------------------------------------------------
banner("read adsl / adeff (read only)")
adsl = spark.table(f"{FQ}.adsl").toPandas().sort_values("usubjid").reset_index(drop=True)
adeff = spark.table(f"{FQ}.adeff").toPandas()
df = adsl.merge(adeff[["usubjid", "aval"]], on="usubjid")
assert len(df) == 1227 and (df.arm == T).sum() == 618 and (df.arm == P).sum() == 609
assert (df.sex == "F").sum() == 735 and (df.sex == "M").sum() == 492
rng = np.random.default_rng(SEED)

REGION = {"United States": "North America", "Canada": "North America",
          "Germany": "Europe", "United Kingdom": "Europe", "France": "Europe", "Spain": "Europe",
          "Italy": "Europe", "Poland": "Europe", "Australia": "Asia-Pacific", "Japan": "Asia-Pacific"}
assert set(df.country) == set(REGION)

# ---- subject sets that drive the safety numbers --------------------------------------
# (arm, any TEAE, SAE, drug withdrawn, fatal, SAE that also led to withdrawal)
SAFETY_PLAN = {T: (441, 53, 38, 2, 3), P: (419, 41, 22, 3, 2)}
OTHER_DISC = {  # discontinuations for reasons other than AE and death
    T: {"LACK OF EFFICACY": 18, "WITHDRAWAL BY SUBJECT": 24, "LOST TO FOLLOW-UP": 11, "OTHER": 7},
    P: {"LACK OF EFFICACY": 41, "WITHDRAWAL BY SUBJECT": 25, "LOST TO FOLLOW-UP": 12, "OTHER": 8},
}
role = {}  # usubjid -> 'fatal' | 'sae_w' | 'sae' | 'w' | 'plain'
disc_reason = {}  # usubjid -> dsdecod for discontinued subjects
for arm_name, (nA, nS, nW, nF, nSW) in SAFETY_PLAN.items():
    sub = df[df.arm == arm_name]
    allids = sorted(sub.usubjid)
    nonresp = sorted(sub[sub.aval == 0].usubjid)  # discontinuers are non-responders (protocol rule)
    F = set(map(str, rng.choice(nonresp, nF, replace=False)))
    W = set(map(str, rng.choice([u for u in nonresp if u not in F], nW, replace=False)))
    SW = set(map(str, rng.choice(sorted(W), nSW, replace=False)))
    rest = [u for u in allids if u not in F and u not in W]
    S_other = set(map(str, rng.choice(rest, nS - nF - nSW, replace=False)))
    A = F | W | S_other
    extra_pool = [u for u in allids if u not in A]
    A |= set(map(str, rng.choice(extra_pool, nA - len(A), replace=False)))
    for u in A:
        role[u] = "fatal" if u in F else "sae_w" if u in SW else "w" if u in W else "sae" if u in S_other else "plain"
    for u in F:
        disc_reason[u] = "DEATH"
    for u in W:
        disc_reason[u] = "ADVERSE EVENT"
    taken = F | W
    pool = [u for u in nonresp if u not in taken]
    for reason, k in OTHER_DISC[arm_name].items():
        pick = set(map(str, rng.choice([u for u in pool if u not in disc_reason], k, replace=False)))
        for u in pick:
            disc_reason[u] = reason
assert len(role) == 441 + 419

banner("adsl_ext")
race_p = {
    "North America": (["White", "Black or African American", "Asian", "Other"], [0.72, 0.14, 0.06, 0.08]),
    "Europe": (["White", "Black or African American", "Asian", "Other"], [0.90, 0.02, 0.03, 0.05]),
    "Asia-Pacific": (["White", "Black or African American", "Asian", "Other"], [0.30, 0.01, 0.64, 0.05]),
}
bmi_pars = {"F": (27.6, 5.6), "M": (28.4, 4.6)}
dv_rows = []
excl = set()
dv_major_cat = ["Prohibited concomitant medication", "Study drug non-compliance", "Eligibility criterion not met"]
dv_minor_cat = ["Visit outside protocol window", "Missed laboratory sample", "Informed consent version error",
                "Questionnaire not completed"]
for u, a in zip(df.usubjid, df.arm):
    r = rng.random()
    p_excl = 0.066 if a == T else 0.060
    if r < p_excl:
        excl.add(u)
        dv_rows.append((u, a, str(rng.choice(dv_major_cat)), "Major", "Y"))
        if rng.random() < 0.25:
            dv_rows.append((u, a, str(rng.choice(dv_minor_cat)), "Minor", "N"))
    elif r < p_excl + 0.03:
        dv_rows.append((u, a, "Missed safety assessment", "Major", "N"))
    elif r < p_excl + 0.03 + 0.12:
        dv_rows.append((u, a, str(rng.choice(dv_minor_cat)), "Minor", "N"))
ext_rows = []
for u, c, s in zip(df.usubjid, df.country, df.sex):
    reg = REGION[c]
    names, probs = race_p[reg]
    if c == "Japan":
        race = str(rng.choice(["Asian", "Other"], p=[0.98, 0.02]))
    else:
        race = str(rng.choice(names, p=probs))
    m, sd = bmi_pars[s]
    bmi = float(np.round(np.clip(rng.normal(m, sd), 17.0, 50.0), 1))
    sev = str(rng.choice(["Moderate", "Severe"], p=[0.62, 0.38]))
    ext_rows.append((u, reg, sev, bmi, race, "N" if u in excl else "Y", "Y"))

banner("adds / adex")
arm_of = dict(zip(df.usubjid, df.arm))
ds_rows, ex_rows = [], []
dur_of = {}
for u in df.usubjid:
    a = arm_of[u]
    if u in disc_reason:
        reason = disc_reason[u]
        lo, hi = {"ADVERSE EVENT": (20, 340), "DEATH": (30, 330), "LACK OF EFFICACY": (150, 340),
                  "WITHDRAWAL BY SUBJECT": (14, 340), "LOST TO FOLLOW-UP": (60, 340), "OTHER": (14, 340)}[reason]
        day = int(rng.integers(lo, hi + 1))
        ds_rows.append((u, a, reason, day))
        dur = day
    else:
        ds_rows.append((u, a, "COMPLETED", 364))
        dur = int(np.clip(np.round(rng.normal(363, 4)), 350, 375))
    dur_of[u] = dur
    comp = float(np.round(np.clip(rng.normal(96.0, 4.5), 70.0, 100.0), 1))
    cum = float(np.round(dur * 400.0 * comp / 100.0, 1))  # nominal: matching placebo tablets counted as 400 mg equivalent
    ex_rows.append((u, a, dur, cum, comp))
dsstdy_of = {r[0]: r[3] for r in ds_rows}

banner("adae")
PTS = {  # soc -> list of (pt, ns_w_trt, ns_w_pbo, ser_w_trt, ser_w_pbo)
    "Infections and infestations": [
        ("Nasopharyngitis", 12, 11, 0, 0), ("Upper respiratory tract infection", 9, 9, 0, 0),
        ("Herpes zoster", 3, 0.8, 1.5, 0.3), ("Pneumonia", 0.6, 0.6, 4, 4)],
    "Gastrointestinal disorders": [
        ("Nausea", 7, 4, 0, 0), ("Diarrhoea", 6, 5, 0, 0), ("Abdominal pain", 3, 3, 0, 0),
        ("Cholecystitis", 0.1, 0.1, 1.5, 1.0)],
    "Nervous system disorders": [("Headache", 8, 7, 0, 0), ("Dizziness", 4, 3, 0, 0), ("Syncope", 0.2, 0.2, 1, 1)],
    "Investigations": [
        ("Alanine aminotransferase increased", 7, 2, 0, 0), ("Aspartate aminotransferase increased", 5, 1.5, 0, 0),
        ("Blood creatine phosphokinase increased", 3, 1.5, 0, 0), ("Neutrophil count decreased", 2, 0.8, 0, 0)],
    "Musculoskeletal and connective tissue disorders": [("Arthralgia", 5, 5, 0, 0), ("Back pain", 4, 4, 0, 0), ("Myalgia", 2, 2, 0, 0)],
    "Skin and subcutaneous tissue disorders": [("Rash", 4, 2, 0, 0), ("Pruritus", 2, 1.5, 0, 0), ("Acne", 1.5, 0.5, 0, 0)],
    "Respiratory, thoracic and mediastinal disorders": [
        ("Cough", 4, 4, 0, 0), ("Oropharyngeal pain", 2, 2.5, 0, 0), ("Pulmonary embolism", 0.2, 0.3, 1, 1)],
    "Cardiac disorders": [
        ("Atrial fibrillation", 0.3, 0.3, 1.5, 1.5), ("Myocardial infarction", 0.1, 0.1, 1.5, 1.5),
        ("Cardiac failure", 0.1, 0.1, 1, 1), ("Palpitations", 1.5, 1.5, 0, 0)],
}
SOC_KEYS = {
    "Infections and infestations": "SOC_INFECTIONS", "Gastrointestinal disorders": "SOC_GASTROINTESTINAL",
    "Nervous system disorders": "SOC_NERVOUS_SYSTEM", "Investigations": "SOC_INVESTIGATIONS",
    "Musculoskeletal and connective tissue disorders": "SOC_MUSCULOSKELETAL",
    "Skin and subcutaneous tissue disorders": "SOC_SKIN",
    "Respiratory, thoracic and mediastinal disorders": "SOC_RESPIRATORY", "Cardiac disorders": "SOC_CARDIAC"}
FLAT = [(soc, pt, a, b, c, d) for soc, lst in PTS.items() for (pt, a, b, c, d) in lst]
FATAL_POOL = {T: [("Cardiac disorders", "Myocardial infarction"), ("Infections and infestations", "Pneumonia")],
              P: [("Cardiac disorders", "Myocardial infarction"), ("Cardiac disorders", "Cardiac failure"),
                  ("Infections and infestations", "Pneumonia")]}


def draw(arm_name: str, serious: bool):
    idx = (4 if arm_name == T else 5) if serious else (2 if arm_name == T else 3)
    w = np.array([f[idx] for f in FLAT], dtype=float)
    k = int(rng.choice(len(FLAT), p=w / w.sum()))
    return FLAT[k][0], FLAT[k][1]


def pick_out(w_event: bool = False) -> str:
    return str(rng.choice(["RECOVERED/RESOLVED", "RECOVERING/RESOLVING", "NOT RECOVERED/NOT RESOLVED",
                           "RECOVERED/RESOLVED WITH SEQUELAE"], p=[0.72, 0.12, 0.10, 0.06]))


fatal_pt_used = {T: 0, P: 0}
ae_rows = []
for u in sorted(role):
    a = arm_of[u]
    r = role[u]
    dur = dur_of[u]
    dss = dsstdy_of[u]
    n_extra = int(rng.choice([0, 1, 2, 3], p=[0.5, 0.28, 0.15, 0.07]))
    specs = []
    if r != "plain":
        specs.append(r)
    n_plain = n_extra + (1 if r == "plain" else 0)
    specs += ["plain"] * n_plain
    for spec in specs:
        if spec == "fatal":
            soc, pt = FATAL_POOL[a][fatal_pt_used[a] % len(FATAL_POOL[a])]
            fatal_pt_used[a] += 1
            st = int(rng.integers(max(1, dss - 25), dss))
            ae_rows.append((u, a, soc, pt, "Y", "NOT RELATED", "NOT APPLICABLE", "FATAL", st, dss, "SEVERE"))
            continue
        serious = spec in ("sae", "sae_w")
        soc, pt = draw(a, serious)
        if spec in ("sae_w", "w"):
            st = int(rng.integers(1, dss))
            acn = "DRUG WITHDRAWN"
            rel = "RELATED" if rng.random() < (0.55 if a == T else 0.40) else "NOT RELATED"
        else:
            st = int(rng.integers(1, dur + 1))
            acn = str(rng.choice(["DOSE NOT CHANGED", "DRUG INTERRUPTED", "DOSE REDUCED"],
                                 p=[0.80, 0.15, 0.05] if not serious else [0.45, 0.50, 0.05]))
            pr = (0.15 if a == T else 0.08) if serious else (0.20 if a == T else 0.11)
            rel = "RELATED" if rng.random() < pr else "NOT RELATED"
        out = pick_out()
        d = int(rng.integers(5, 41)) if serious else int(rng.integers(2, 31))
        en = None if out == "NOT RECOVERED/NOT RESOLVED" else int(min(st + d, max(dss, st)))
        sev = str(rng.choice(["MODERATE", "SEVERE"], p=[0.5, 0.5])) if serious else str(
            rng.choice(["MILD", "MODERATE", "SEVERE"], p=[0.55, 0.35, 0.10]))
        ae_rows.append((u, a, soc, pt, "Y" if serious else "N", rel, acn, out, st, en, sev))

banner("adeff_sec")
resp = dict(zip(df.usubjid, df.aval))
sec_rows = []
for u in df.usubjid:
    a = arm_of[u]
    dss = dsstdy_of[u]
    completed = u not in disc_reason
    if resp[u] == 1:
        m52, s52 = (-26.0, 11.0) if a == T else (-24.0, 11.0)
    else:
        m52, s52 = (-8.0, 10.0) if a == T else (-6.0, 10.0)
    c52 = float(np.round(rng.normal(m52, s52), 1))
    c24 = float(np.round(0.75 * c52 + rng.normal(0, 4.0), 1))
    if completed:
        sec_rows.append((u, a, "SYMCHG52", c52, 0))
    if completed or dss >= 168:
        sec_rows.append((u, a, "SYMCHG24", c24, 0))
    # time to first response (days); censored at last day on treatment
    ever = resp[u] == 1 or rng.random() < (0.35 if a == T else 0.28)
    if ever:
        med, sig = (85.0, 0.60) if a == T else (150.0, 0.65)
        tm = int(np.clip(np.round(np.exp(rng.normal(np.log(med), sig))), 14, max(14, dur_of[u])))
        sec_rows.append((u, a, "TTRESP", float(tm), 0))
    else:
        sec_rows.append((u, a, "TTRESP", float(dur_of[u]), 1))


def S(*cols):
    return StructType([StructField(n, t) for n, t in cols])


def write(rows, schema, name):
    spark.createDataFrame(rows, schema).write.mode("overwrite").saveAsTable(f"{FQ}.{name}")


write(ext_rows, S(("usubjid", StringType()), ("region", StringType()), ("baseline_severity", StringType()),
                  ("bmi", DoubleType()), ("race", StringType()), ("pp_fl", StringType()), ("saffl", StringType())), "adsl_ext")
write(ds_rows, S(("usubjid", StringType()), ("arm", StringType()), ("dsdecod", StringType()), ("dsstdy", IntegerType())), "adds")
write(dv_rows, S(("usubjid", StringType()), ("arm", StringType()), ("dvcat", StringType()),
                 ("severity", StringType()), ("excl_pp", StringType())), "addv")
write(ex_rows, S(("usubjid", StringType()), ("arm", StringType()), ("trtdurd", IntegerType()),
                 ("cumdose_mg", DoubleType()), ("compliance_pct", DoubleType())), "adex")
write(ae_rows, S(("usubjid", StringType()), ("arm", StringType()), ("aesoc", StringType()), ("aedecod", StringType()),
                 ("aeser", StringType()), ("aerel", StringType()), ("aeacn", StringType()), ("aeout", StringType()),
                 ("aestdy", IntegerType()), ("aeendy", IntegerType()), ("aesev", StringType())), "adae")
write(sec_rows, S(("usubjid", StringType()), ("arm", StringType()), ("paramcd", StringType()),
                  ("aval", DoubleType()), ("cnsr", IntegerType())), "adeff_sec")

ANALYSIS_COMMENTS = {
    "adsl_ext": "Extension of adsl for the full CSR demo: region, baseline severity, BMI, race, per-protocol flag (pp_fl, derived from addv) and safety flag. " + SYN,
    "adds": "Disposition analysis dataset for study LMN-301: one row per randomised participant with the completion status or reason for discontinuation and the study day. " + SYN,
    "addv": "Protocol deviations for study LMN-301. excl_pp = Y marks a major deviation that excludes the participant from the per-protocol set. " + SYN,
    "adex": "Exposure analysis dataset for study LMN-301: days on treatment, cumulative dose and compliance per participant. " + SYN,
    "adae": "Treatment-emergent adverse events for study LMN-301 (MedDRA system organ class and preferred term). Participant counts reproduce safety_overview. " + SYN,
    "adeff_sec": "Secondary endpoints for study LMN-301: change in symptom score at Week 24 and Week 52 (SYMCHG24, SYMCHG52) and time to first response in days (TTRESP, cnsr 1 = censored). " + SYN,
}
for t, c in ANALYSIS_COMMENTS.items():
    sql(f"COMMENT ON TABLE {FQ}.{t} IS '{q_esc(c)}'")
    sql(f"ALTER TABLE {FQ}.{t} SET TAGS ({TAGS})")
for t in ["adsl_ext", "adds", "addv", "adex", "adae", "adeff_sec"]:
    print(f"{t:12s}", one(f"SELECT COUNT(*) FROM {FQ}.{t}"))

# --------------------------------------------------------------------------------------
# 2. Certified TLF tables (CREATE TABLE AS SELECT)
# --------------------------------------------------------------------------------------
banner("certified TLF tables")


def cnt_row(key, label, order, cond, names, double=False):
    ct, cp, pt_, pp, tot = names
    ty = "DOUBLE" if double else "INT"
    s_t = f"SUM(CASE WHEN arm = '{T}' AND ({cond}) THEN 1 ELSE 0 END)"
    s_p = f"SUM(CASE WHEN arm = '{P}' AND ({cond}) THEN 1 ELSE 0 END)"
    return f"""SELECT '{key}' AS row_key, '{q_esc(label)}' AS row_label, {order} AS row_order,
  CAST({s_t} AS {ty}) AS {ct},
  ROUND(100D * {s_t} / SUM(CASE WHEN arm = '{T}' THEN 1 ELSE 0 END), 1) AS {cp},
  CAST({s_p} AS {ty}) AS {pt_},
  ROUND(100D * {s_p} / SUM(CASE WHEN arm = '{P}' THEN 1 ELSE 0 END), 1) AS {pp},
  CAST(SUM(CASE WHEN ({cond}) THEN 1 ELSE 0 END) AS {ty}) AS {tot}
FROM base"""


def stat_row(key, label, order, fn, expr, names, nd=1):
    ct, cp, pt_, pp, tot = names
    return f"""SELECT '{key}' AS row_key, '{q_esc(label)}' AS row_label, {order} AS row_order,
  CAST(ROUND({fn}(CASE WHEN arm = '{T}' THEN {expr} END), {nd}) AS DOUBLE) AS {ct},
  CAST(NULL AS DOUBLE) AS {cp},
  CAST(ROUND({fn}(CASE WHEN arm = '{P}' THEN {expr} END), {nd}) AS DOUBLE) AS {pt_},
  CAST(NULL AS DOUBLE) AS {pp},
  CAST(ROUND({fn}({expr}), {nd}) AS DOUBLE) AS {tot}
FROM base"""


def ctas(name, body):
    sql(f"CREATE TABLE {FQ}.{name} AS {body}")


# ---- 14.1.1 disposition ----
N_DISP = ("trt_n", "trt_pct", "pbo_n", "pbo_pct", "total_n")
disp_rows = [
    ("RANDOMISED", "Randomised", "1 = 1"), ("TREATED", "Treated (received at least one dose)", "saffl = 'Y'"),
    ("COMPLETED", "Completed Week 52", "dsdecod = 'COMPLETED'"), ("DISCONTINUED", "Discontinued study treatment", "dsdecod <> 'COMPLETED'"),
    ("DISC_AE", "Discontinued: adverse event", "dsdecod = 'ADVERSE EVENT'"),
    ("DISC_LOE", "Discontinued: lack of efficacy", "dsdecod = 'LACK OF EFFICACY'"),
    ("DISC_WITHDRAWAL", "Discontinued: withdrawal by participant", "dsdecod = 'WITHDRAWAL BY SUBJECT'"),
    ("DISC_LTFU", "Discontinued: lost to follow-up", "dsdecod = 'LOST TO FOLLOW-UP'"),
    ("DISC_DEATH", "Discontinued: death", "dsdecod = 'DEATH'"),
    ("DISC_OTHER", "Discontinued: other reason", "dsdecod = 'OTHER'"),
    ("FAS", "Full analysis set", "1 = 1"), ("PPS", "Per-protocol set", "pp_fl = 'Y'"), ("SAF", "Safety set", "saffl = 'Y'"),
]
base = f"""WITH base AS (SELECT s.usubjid, s.arm, d.dsdecod, x.pp_fl, x.saffl
  FROM {FQ}.adsl s JOIN {FQ}.adds d ON s.usubjid = d.usubjid JOIN {FQ}.adsl_ext x ON s.usubjid = x.usubjid
  WHERE s.randfl = 'Y')"""
ctas("tlf_14_1_1_disposition", base + "\n" + "\nUNION ALL\n".join(
    cnt_row(k, l, i + 1, c, N_DISP) for i, (k, l, c) in enumerate(disp_rows)))

# ---- 14.1.2 demographics ----
N_DEMO = ("trt", "trt_pct", "pbo", "pbo_pct", "total")
base = f"""WITH base AS (SELECT s.usubjid, s.arm, s.age, s.sex, x.region, x.baseline_severity, x.bmi
  FROM {FQ}.adsl s JOIN {FQ}.adsl_ext x ON s.usubjid = x.usubjid WHERE s.randfl = 'Y')"""
demo_parts = [
    stat_row("AGE_MEAN", "Age, mean (years)", 1, "AVG", "age", N_DEMO),
    stat_row("AGE_SD", "Age, standard deviation (years)", 2, "STDDEV_SAMP", "age", N_DEMO),
    cnt_row("AGE_GE65", "Age 65 years or older", 3, "age >= 65", N_DEMO, True),
    cnt_row("FEMALE", "Female", 4, "sex = 'F'", N_DEMO, True), cnt_row("MALE", "Male", 5, "sex = 'M'", N_DEMO, True),
    cnt_row("REGION_EU", "Region: Europe", 6, "region = 'Europe'", N_DEMO, True),
    cnt_row("REGION_NA", "Region: North America", 7, "region = 'North America'", N_DEMO, True),
    cnt_row("REGION_APAC", "Region: Asia-Pacific", 8, "region = 'Asia-Pacific'", N_DEMO, True),
    cnt_row("SEV_MODERATE", "Baseline severity: moderate", 9, "baseline_severity = 'Moderate'", N_DEMO, True),
    cnt_row("SEV_SEVERE", "Baseline severity: severe", 10, "baseline_severity = 'Severe'", N_DEMO, True),
    stat_row("BMI_MEAN", "Body mass index, mean (kg/m2)", 11, "AVG", "bmi", N_DEMO),
]
ctas("tlf_14_1_2_demographics", base + "\n" + "\nUNION ALL\n".join(demo_parts))

# ---- 14.2.2 per-protocol responder analysis (same shape as efficacy_primary, 1 decimal) ----
ctas("tlf_14_2_2_pp", f"""
WITH per_arm AS (
  SELECT s.arm, COUNT(*) AS n, CAST(SUM(e.aval) AS INT) AS responders
  FROM {FQ}.adsl s JOIN {FQ}.adeff e ON s.usubjid = e.usubjid JOIN {FQ}.adsl_ext x ON s.usubjid = x.usubjid
  WHERE e.paramcd = 'PRIMRESP' AND e.avisit = 'Week 52' AND s.randfl = 'Y' AND x.pp_fl = 'Y'
  GROUP BY s.arm
), w AS (
  SELECT MAX(CASE WHEN arm = '{T}' THEN n END) AS tn, MAX(CASE WHEN arm = '{T}' THEN responders END) AS tr,
         MAX(CASE WHEN arm = '{P}' THEN n END) AS pn, MAX(CASE WHEN arm = '{P}' THEN responders END) AS pr FROM per_arm
), p AS (
  SELECT tn, tr, pn, pr, tr / tn AS p1, pr / pn AS p2,
         SQRT((tr / tn) * (1 - tr / tn) / tn + (pr / pn) * (1 - pr / pn) / pn) AS se FROM w
)
SELECT 'TRT' AS row_key, 'LMN-4471 400 mg' AS row_label, 1 AS row_order, CAST(tn AS INT) AS n, CAST(tr AS INT) AS responders,
       ROUND(100 * p1, 1) AS rate_pct, CAST(NULL AS DOUBLE) AS diff_pct, CAST(NULL AS DOUBLE) AS ci_low, CAST(NULL AS DOUBLE) AS ci_high FROM p
UNION ALL
SELECT 'PBO', 'Placebo', 2, CAST(pn AS INT), CAST(pr AS INT), ROUND(100 * p2, 1),
       CAST(NULL AS DOUBLE), CAST(NULL AS DOUBLE), CAST(NULL AS DOUBLE) FROM p
UNION ALL
SELECT 'DIFF', 'Difference (LMN-4471 minus placebo)', 3, CAST(NULL AS INT), CAST(NULL AS INT), CAST(NULL AS DOUBLE),
       ROUND(100 * (p1 - p2), 1), ROUND(100 * (p1 - p2 - 1.96 * se), 1), ROUND(100 * (p1 - p2 + 1.96 * se), 1) FROM p
""")


# ---- 14.2.3 secondary endpoints ----
def pnorm2(z):  # two-sided normal p-value, Abramowitz and Stegun 7.1.26 (abs error below 1.5e-7)
    x = f"(ABS({z}) / SQRT(2.0))"
    t = f"(1.0 / (1.0 + 0.3275911 * {x}))"
    poly = f"({t} * (0.254829592 + {t} * (-0.284496736 + {t} * (1.421413741 + {t} * (-1.453152027 + {t} * 1.061405429)))))"
    return f"({poly} * EXP(-{x} * {x}))"


ctas("tlf_14_2_3_secondary", f"""
WITH sy AS (
  SELECT paramcd,
         AVG(CASE WHEN arm = '{T}' THEN aval END) AS m1, AVG(CASE WHEN arm = '{P}' THEN aval END) AS m2,
         VAR_SAMP(CASE WHEN arm = '{T}' THEN aval END) AS v1, VAR_SAMP(CASE WHEN arm = '{P}' THEN aval END) AS v2,
         COUNT(CASE WHEN arm = '{T}' THEN 1 END) AS n1, COUNT(CASE WHEN arm = '{P}' THEN 1 END) AS n2
  FROM {FQ}.adeff_sec WHERE paramcd IN ('SYMCHG24', 'SYMCHG52') GROUP BY paramcd
), sz AS (
  SELECT paramcd, m1, m2, m1 - m2 AS d, SQRT(v1 / n1 + v2 / n2) AS se, (m1 - m2) / SQRT(v1 / n1 + v2 / n2) AS z FROM sy
),
ev AS (
  SELECT arm, CAST(aval AS INT) AS tm, SUM(CASE WHEN cnsr = 0 THEN 1 ELSE 0 END) AS d, COUNT(*) AS m
  FROM {FQ}.adeff_sec WHERE paramcd = 'TTRESP' GROUP BY arm, CAST(aval AS INT)
), risk AS (
  SELECT arm, tm, d, m, SUM(m) OVER (PARTITION BY arm ORDER BY tm ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS nr FROM ev
), km AS (
  SELECT arm, tm, EXP(SUM(LN(GREATEST(1 - d / nr, 1e-12))) OVER (PARTITION BY arm ORDER BY tm ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS surv FROM risk
), med AS (
  SELECT MIN(CASE WHEN arm = '{T}' AND surv <= 0.5 THEN tm END) AS mt, MIN(CASE WHEN arm = '{P}' AND surv <= 0.5 THEN tm END) AS mp FROM km
), pooled AS (
  SELECT tm, SUM(CASE WHEN arm = '{T}' THEN d ELSE 0 END) AS d1, SUM(CASE WHEN arm = '{P}' THEN d ELSE 0 END) AS d2,
         SUM(CASE WHEN arm = '{T}' THEN m ELSE 0 END) AS m1, SUM(CASE WHEN arm = '{P}' THEN m ELSE 0 END) AS m2 FROM ev GROUP BY tm
), lr0 AS (
  SELECT tm, d1, d2, SUM(m1) OVER (ORDER BY tm ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS n1,
         SUM(m2) OVER (ORDER BY tm ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING) AS n2 FROM pooled
), lr1 AS (
  SELECT d1 - (d1 + d2) * n1 / (n1 + n2) AS o_e,
         CASE WHEN n1 + n2 > 1 THEN (d1 + d2) * (n1 / (n1 + n2)) * (n2 / (n1 + n2)) * ((n1 + n2 - d1 - d2) / (n1 + n2 - 1)) ELSE 0 END AS v
  FROM lr0 WHERE d1 + d2 > 0
), lr AS (SELECT SQRT(POW(SUM(o_e), 2) / SUM(v)) AS z FROM lr1)
SELECT 'SYMCHG24' AS row_key, 'Change from baseline in symptom score at Week 24' AS row_label, 1 AS row_order,
       ROUND(m1, 1) AS trt, ROUND(m2, 1) AS pbo, ROUND(d, 1) AS diff, ROUND(d - 1.96 * se, 1) AS ci_low,
       ROUND(d + 1.96 * se, 1) AS ci_high, ROUND({pnorm2('z')}, 3) AS p_value FROM sz WHERE paramcd = 'SYMCHG24'
UNION ALL
SELECT 'SYMCHG52', 'Change from baseline in symptom score at Week 52', 2,
       ROUND(m1, 1), ROUND(m2, 1), ROUND(d, 1), ROUND(d - 1.96 * se, 1), ROUND(d + 1.96 * se, 1), ROUND({pnorm2('z')}, 3)
FROM sz WHERE paramcd = 'SYMCHG52'
UNION ALL
SELECT 'TTRESP', 'Time to first response, median (days)', 3,
       CAST(med.mt AS DOUBLE), CAST(med.mp AS DOUBLE), CAST(med.mt - med.mp AS DOUBLE), CAST(NULL AS DOUBLE),
       CAST(NULL AS DOUBLE), ROUND({pnorm2('lr.z')}, 3)
FROM med CROSS JOIN lr
""")

# ---- 14.2.4 subgroups (current adeff, i.e. after the restatement) ----
SUBS = [("AGE_LT65", "Age under 65 years", "s.age < 65"), ("AGE_GE65", "Age 65 years or older", "s.age >= 65"),
        ("SEX_F", "Sex: female", "s.sex = 'F'"), ("SEX_M", "Sex: male", "s.sex = 'M'"),
        ("REGION_EU", "Region: Europe", "x.region = 'Europe'"), ("REGION_NA", "Region: North America", "x.region = 'North America'"),
        ("REGION_APAC", "Region: Asia-Pacific", "x.region = 'Asia-Pacific'"),
        ("SEV_MODERATE", "Baseline severity: moderate", "x.baseline_severity = 'Moderate'"),
        ("SEV_SEVERE", "Baseline severity: severe", "x.baseline_severity = 'Severe'")]
sub_sel = []
for i, (k, l, c) in enumerate(SUBS):
    sub_sel.append(f"""SELECT '{k}' AS row_key, '{l}' AS row_label, {i + 1} AS row_order,
  SUM(CASE WHEN s.arm = '{T}' AND ({c}) THEN 1 ELSE 0 END) AS tn, SUM(CASE WHEN s.arm = '{T}' AND ({c}) THEN e.aval ELSE 0 END) AS tr,
  SUM(CASE WHEN s.arm = '{P}' AND ({c}) THEN 1 ELSE 0 END) AS pn, SUM(CASE WHEN s.arm = '{P}' AND ({c}) THEN e.aval ELSE 0 END) AS pr
FROM {FQ}.adsl s JOIN {FQ}.adeff e ON s.usubjid = e.usubjid JOIN {FQ}.adsl_ext x ON s.usubjid = x.usubjid
WHERE e.paramcd = 'PRIMRESP' AND e.avisit = 'Week 52' AND s.randfl = 'Y'""")
ctas("tlf_14_2_4_subgroups", f"""
WITH g AS ({" UNION ALL ".join(sub_sel)}), p AS (
  SELECT row_key, row_label, row_order, tn, pn, tr / tn AS p1, pr / pn AS p2,
         SQRT((tr / tn) * (1 - tr / tn) / tn + (pr / pn) * (1 - pr / pn) / pn) AS se FROM g)
SELECT row_key, row_label, row_order, CAST(tn AS INT) AS trt_n, ROUND(100 * p1, 1) AS trt_rate,
       CAST(pn AS INT) AS pbo_n, ROUND(100 * p2, 1) AS pbo_rate, ROUND(100 * (p1 - p2), 1) AS diff,
       ROUND(100 * (p1 - p2 - 1.96 * se), 1) AS ci_low, ROUND(100 * (p1 - p2 + 1.96 * se), 1) AS ci_high FROM p
""")

# ---- 14.3.2 AEs by SOC and PT ----
soc_map = ", ".join(f"('{q_esc(k)}', '{v}')" for k, v in SOC_KEYS.items())
ctas("tlf_14_3_2_ae_soc_pt", f"""
WITH n AS (SELECT arm, COUNT(*) AS n FROM {FQ}.adsl WHERE randfl = 'Y' GROUP BY arm),
socmap(aesoc, soc_key) AS (VALUES {soc_map}),
c AS (
  SELECT CAST(NULL AS STRING) AS aesoc, CAST(NULL AS STRING) AS aedecod, arm, COUNT(DISTINCT usubjid) AS c FROM {FQ}.adae GROUP BY arm
  UNION ALL SELECT aesoc, CAST(NULL AS STRING), arm, COUNT(DISTINCT usubjid) FROM {FQ}.adae GROUP BY aesoc, arm
  UNION ALL SELECT aesoc, aedecod, arm, COUNT(DISTINCT usubjid) FROM {FQ}.adae GROUP BY aesoc, aedecod, arm),
piv AS (
  SELECT aesoc, aedecod, SUM(CASE WHEN arm = '{T}' THEN c ELSE 0 END) AS tn, SUM(CASE WHEN arm = '{P}' THEN c ELSE 0 END) AS pn
  FROM c GROUP BY aesoc, aedecod),
soc_tot AS (SELECT aesoc, tn + pn AS st FROM piv WHERE aedecod IS NULL AND aesoc IS NOT NULL),
r AS (
  SELECT piv.aesoc, piv.aedecod, piv.tn, piv.pn, COALESCE(soc_tot.st, 1000000) AS st,
         CASE WHEN piv.aesoc IS NULL THEN 'ANY_TEAE'
              WHEN piv.aedecod IS NULL THEN socmap.soc_key
              ELSE CONCAT('PT_', UPPER(REGEXP_REPLACE(piv.aedecod, '[^A-Za-z0-9]+', '_'))) END AS row_key,
         CASE WHEN piv.aesoc IS NULL THEN 'Participants with at least one TEAE'
              WHEN piv.aedecod IS NULL THEN piv.aesoc ELSE piv.aedecod END AS row_label
  FROM piv LEFT JOIN soc_tot ON piv.aesoc = soc_tot.aesoc LEFT JOIN socmap ON piv.aesoc = socmap.aesoc)
SELECT row_key, row_label,
       CAST(ROW_NUMBER() OVER (ORDER BY st DESC, aesoc, CASE WHEN aedecod IS NULL THEN 0 ELSE 1 END, tn + pn DESC, aedecod) AS INT) AS row_order,
       CAST(tn AS INT) AS trt_n, ROUND(100D * tn / (SELECT n FROM n WHERE arm = '{T}'), 1) AS trt_pct,
       CAST(pn AS INT) AS pbo_n, ROUND(100D * pn / (SELECT n FROM n WHERE arm = '{P}'), 1) AS pbo_pct
FROM r
""")

# ---- 14.3.3 exposure ----
N_EXP = ("trt", "trt_pct", "pbo", "pbo_pct")
# exposure tables have no total column: build rows by hand
def exp_cnt(key, label, order, cond):
    s_t = f"SUM(CASE WHEN arm = '{T}' AND ({cond}) THEN 1 ELSE 0 END)"
    s_p = f"SUM(CASE WHEN arm = '{P}' AND ({cond}) THEN 1 ELSE 0 END)"
    return f"""SELECT '{key}' AS row_key, '{q_esc(label)}' AS row_label, {order} AS row_order,
  CAST({s_t} AS DOUBLE) AS trt, ROUND(100D * {s_t} / SUM(CASE WHEN arm = '{T}' THEN 1 ELSE 0 END), 1) AS trt_pct,
  CAST({s_p} AS DOUBLE) AS pbo, ROUND(100D * {s_p} / SUM(CASE WHEN arm = '{P}' THEN 1 ELSE 0 END), 1) AS pbo_pct FROM base"""


def exp_stat(key, label, order, fn, expr, nd=1):
    return f"""SELECT '{key}' AS row_key, '{q_esc(label)}' AS row_label, {order} AS row_order,
  CAST(ROUND({fn}(CASE WHEN arm = '{T}' THEN {expr} END), {nd}) AS DOUBLE) AS trt, CAST(NULL AS DOUBLE) AS trt_pct,
  CAST(ROUND({fn}(CASE WHEN arm = '{P}' THEN {expr} END), {nd}) AS DOUBLE) AS pbo, CAST(NULL AS DOUBLE) AS pbo_pct FROM base"""


ctas("tlf_14_3_3_exposure", f"WITH base AS (SELECT * FROM {FQ}.adex)\n" + "\nUNION ALL\n".join([
    exp_stat("DUR_MEAN", "Duration of exposure, mean (days)", 1, "AVG", "trtdurd"),
    exp_stat("DUR_SD", "Duration of exposure, standard deviation (days)", 2, "STDDEV_SAMP", "trtdurd"),
    exp_cnt("DUR_GE48W", "Exposure of 48 weeks or longer", 3, "trtdurd >= 336"),
    exp_stat("CUMDOSE_MEAN", "Cumulative dose, mean (mg)", 4, "AVG", "cumdose_mg"),
    exp_stat("COMPL_MEAN", "Treatment compliance, mean (%)", 5, "AVG", "compliance_pct")]))

# ---- certification, tags, comments ----
TLF_META = {
    "tlf_14_1_1_disposition": ("Table 14.1.1", "Participant disposition", "Randomised participants in the full analysis set; percentages use the randomised participants of the arm as denominator."),
    "tlf_14_1_2_demographics": ("Table 14.1.2", "Demographic and baseline characteristics", "Full analysis set; counts and percentages of participants, or the mean or standard deviation named in the row label."),
    "tlf_14_2_2_pp": ("Table 14.2.2", "Primary endpoint, per-protocol sensitivity analysis", "Responder analysis at Week 52 in the per-protocol set, computed from adeff (current state after the Week 52 restatement) for participants with pp_fl = Y."),
    "tlf_14_2_3_secondary": ("Table 14.2.3", "Key secondary endpoints", "Symptom score change at Week 24 and Week 52 (observed-case mean, Wald 95% CI) and time to first response (Kaplan-Meier median, log-rank p-value)."),
    "tlf_14_2_4_subgroups": ("Table 14.2.4", "Responder rate at Week 52 by subgroup", "Full analysis set, computed from the current adeff (after the Week 52 restatement); Wald 95% CI of the difference."),
    "tlf_14_3_2_ae_soc_pt": ("Table 14.3.2", "Treatment-emergent adverse events by system organ class and preferred term", "Safety set; participants counted once per row; ANY_TEAE is the number of participants with at least one TEAE."),
    "tlf_14_3_3_exposure": ("Table 14.3.3", "Extent of exposure to study drug", "Safety set; exposure in days on treatment, nominal cumulative dose and compliance."),
}
COLS = {
    "disposition": {
        "trt_n": "Number of participants in the LMN-4471 400 mg arm for the category named in the row label",
        "trt_pct": "Percentage of randomised participants in the LMN-4471 400 mg arm, 1 decimal",
        "pbo_n": "Number of participants in the placebo arm for the category named in the row label",
        "pbo_pct": "Percentage of randomised participants in the placebo arm, 1 decimal",
        "total_n": "Number of participants in both arms combined for the category named in the row label"},
    "demographics": {
        "trt": "LMN-4471 400 mg arm: number of participants, or the mean or standard deviation named in the row label",
        "trt_pct": "Percentage of participants in the LMN-4471 400 mg arm (empty for means and standard deviations), 1 decimal",
        "pbo": "Placebo arm: number of participants, or the mean or standard deviation named in the row label",
        "pbo_pct": "Percentage of participants in the placebo arm (empty for means and standard deviations), 1 decimal",
        "total": "Both arms combined: number of participants, or the mean or standard deviation named in the row label"},
    "pp": {
        "n": "Number of participants in the per-protocol set for the arm",
        "responders": "Number of per-protocol participants with a response at Week 52 (aval = 1)",
        "rate_pct": "Response rate at Week 52 in the per-protocol set, percent, 1 decimal",
        "diff_pct": "Treatment difference in response rate (LMN-4471 minus placebo), percentage points, 1 decimal",
        "ci_low": "Lower bound of the Wald 95% confidence interval of the difference, percentage points",
        "ci_high": "Upper bound of the Wald 95% confidence interval of the difference, percentage points"},
    "secondary": {
        "trt": "LMN-4471 400 mg arm: mean change from baseline in symptom score (lower is better), or median days to first response",
        "pbo": "Placebo arm: mean change from baseline in symptom score (lower is better), or median days to first response",
        "diff": "Difference between arms (LMN-4471 minus placebo); a negative value favours LMN-4471",
        "ci_low": "Lower bound of the Wald 95% confidence interval of the difference (empty for time to first response)",
        "ci_high": "Upper bound of the Wald 95% confidence interval of the difference (empty for time to first response)",
        "p_value": "Two-sided p-value, 3 decimals; 0.000 means p below 0.001"},
    "subgroups": {
        "trt_n": "Number of participants in the subgroup in the LMN-4471 400 mg arm",
        "trt_rate": "Response rate at Week 52 in the subgroup, LMN-4471 400 mg arm, percent, 1 decimal",
        "pbo_n": "Number of participants in the subgroup in the placebo arm",
        "pbo_rate": "Response rate at Week 52 in the subgroup, placebo arm, percent, 1 decimal",
        "diff": "Treatment difference in response rate in the subgroup (LMN-4471 minus placebo), percentage points",
        "ci_low": "Lower bound of the Wald 95% confidence interval of the subgroup difference, percentage points",
        "ci_high": "Upper bound of the Wald 95% confidence interval of the subgroup difference, percentage points"},
    "ae": {
        "trt_n": "Number of participants in the LMN-4471 400 mg arm with at least one event in the row",
        "trt_pct": "Percentage of safety-set participants in the LMN-4471 400 mg arm with at least one event in the row, 1 decimal",
        "pbo_n": "Number of participants in the placebo arm with at least one event in the row",
        "pbo_pct": "Percentage of safety-set participants in the placebo arm with at least one event in the row, 1 decimal"},
    "exposure": {
        "trt": "LMN-4471 400 mg arm: mean or standard deviation as named in the row label, or number of participants for the 48-week row",
        "trt_pct": "Percentage of participants in the LMN-4471 400 mg arm (48-week row only), 1 decimal",
        "pbo": "Placebo arm: mean or standard deviation as named in the row label, or number of participants for the 48-week row",
        "pbo_pct": "Percentage of participants in the placebo arm (48-week row only), 1 decimal"},
}
COLKEY = {"tlf_14_1_1_disposition": "disposition", "tlf_14_1_2_demographics": "demographics", "tlf_14_2_2_pp": "pp",
          "tlf_14_2_3_secondary": "secondary", "tlf_14_2_4_subgroups": "subgroups", "tlf_14_3_2_ae_soc_pt": "ae",
          "tlf_14_3_3_exposure": "exposure"}
for t, (tlf, title, note) in TLF_META.items():
    sql(f"ALTER TABLE {FQ}.{t} SET TAGS ({CERT})")
    sql(f"ALTER TABLE {FQ}.{t} SET TAGS ({TAGS})")
    sql(f"COMMENT ON TABLE {FQ}.{t} IS '{q_esc(f'CERTIFIED by Biostatistics. {tlf} {title}. {note} Study LMN-301, built from the analysis datasets. ' + SYN)}'")
    cols = COLS[COLKEY[t]]
    schema_cols = {r["col_name"] for r in sql(f"DESCRIBE {FQ}.{t}").collect()}
    for col, cm in cols.items():
        assert col in schema_cols, (t, col)
        sql(f"ALTER TABLE {FQ}.{t} ALTER COLUMN {col} COMMENT '{q_esc(cm)}'")
    numeric = {r["col_name"] for r in sql(f"DESCRIBE {FQ}.{t}").collect()
               if r["data_type"] in ("int", "double", "bigint") and r["col_name"] != "row_order"}
    assert numeric == set(cols), (t, numeric, set(cols))
    sql(f"ALTER TABLE {FQ}.{t} ALTER COLUMN row_key COMMENT 'Upper snake case row identifier, unique within the table'")
    sql(f"ALTER TABLE {FQ}.{t} ALTER COLUMN row_label COMMENT 'Human-readable row label'")
    sql(f"ALTER TABLE {FQ}.{t} ALTER COLUMN row_order COMMENT 'Display order of the row'")
    print(f"{t:28s}", one(f"SELECT COUNT(*) FROM {FQ}.{t}"))

# --------------------------------------------------------------------------------------
# 3. study_metadata and narrative_patients
# --------------------------------------------------------------------------------------
banner("study_metadata / narrative_patients")
n_sites = one(f"SELECT COUNT(DISTINCT SUBSTRING(usubjid, 8, 4)) FROM {FQ}.adsl")
n_countries = one(f"SELECT COUNT(DISTINCT country) FROM {FQ}.adsl")
assert (n_sites, n_countries) == (62, 10), (n_sites, n_countries)
META = [
    ("study_id", "LMN-301", "text"),
    ("title", "A 52-week, randomised, double-blind, placebo-controlled, parallel-group Phase III study of LMN-4471 400 mg once daily in adults with moderate to severe disease", "text"),
    ("short_title", "Study LMN-301: LMN-4471 400 mg once daily versus placebo for 52 weeks", "text"),
    ("phase", "III", "text"), ("compound", "LMN-4471", "text"), ("dose", "400 mg once daily", "text"),
    ("sponsor", "Fictional sponsor", "text"),
    ("indication", "Adults with moderate to severe chronic inflammatory disease who have had an inadequate response to at least one conventional therapy", "text"),
    ("protocol_version", "3.0", "text"), ("sap_version", "2.0", "text"),
    ("n_sites", str(n_sites), "number"), ("n_countries", str(n_countries), "number"),
    ("n_randomised", str(len(df)), "number"), ("treatment_weeks", "52", "number"), ("safety_follow_up_weeks", "4", "number"),
    ("first_patient_in", "2025-02-10", "date"), ("last_patient_last_visit", "2026-09-14", "date"),
    ("database_lock", "2026-10-12", "date"), ("report_date", "2026-10-21", "date"),
    ("coordinating_investigator", "Prof. Elena Marsh (fictional)", "text"),
    ("ethics_statement", "The study was conducted in accordance with the principles of the Declaration of Helsinki, ICH Good Clinical Practice and applicable regulatory requirements. The protocol, its amendments and the informed consent forms were reviewed and approved by an independent ethics committee or institutional review board at each site before any participant was enrolled. All participants gave written informed consent before any study procedure was performed.", "text"),
]
write(META, S(("meta_key", StringType()), ("meta_value", StringType()), ("value_type", StringType())), "study_metadata")
sql(f"COMMENT ON TABLE {FQ}.study_metadata IS 'Study-level facts for the LMN-301 clinical study report (title page, ethics, administrative structure). Number-valued keys become slots meta_<key>. Synthetic study and compound. {SYN}'")
sql(f"ALTER TABLE {FQ}.study_metadata SET TAGS ({TAGS})")

sql(f"""
CREATE TABLE {FQ}.narrative_patients AS
SELECT a.usubjid AS row_key, a.arm, CAST(s.age AS INT) AS age, s.sex, a.aedecod, a.aesoc,
       CAST(a.aestdy AS INT) AS aestdy, CAST(a.aeendy AS INT) AS aeendy, a.aeout, a.aeacn, a.aerel,
       CAST(x.trtdurd AS INT) AS trtdurd,
       CASE WHEN a.aeout = 'FATAL' THEN 'Death' ELSE 'SAE leading to discontinuation' END AS narrative_reason
FROM {FQ}.adae a JOIN {FQ}.adsl s ON a.usubjid = s.usubjid JOIN {FQ}.adex x ON a.usubjid = x.usubjid
WHERE a.aeout = 'FATAL' OR (a.aeser = 'Y' AND a.aeacn = 'DRUG WITHDRAWN')
""")
sql(f"COMMENT ON TABLE {FQ}.narrative_patients IS 'Participants who need a safety narrative in the LMN-301 CSR (section 12.3.2): all deaths and serious adverse events that led to withdrawal of study drug. One row per participant, row_key = usubjid. Not certified. {SYN}'")
sql(f"ALTER TABLE {FQ}.narrative_patients SET TAGS ({TAGS})")
for col, cm in {"aestdy": "Study day the adverse event started", "aeendy": "Study day the adverse event ended or the participant died",
                "age": "Age in years at randomisation", "trtdurd": "Days on study treatment"}.items():
    sql(f"ALTER TABLE {FQ}.narrative_patients ALTER COLUMN {col} COMMENT '{cm}'")

# --------------------------------------------------------------------------------------
# 4. section_registry
# --------------------------------------------------------------------------------------
banner("section_registry")
PROTO, SAP = "%Protocol%", "%SAP%"


def tlf(table, label, alias, version=None):
    return {"table": table, "tlf": label, "alias": alias, "version": version}


T_DISP = tlf("tlf_14_1_1_disposition", "Table 14.1.1", "disp")
T_DEMO = tlf("tlf_14_1_2_demographics", "Table 14.1.2", "demo")
T_EFF = tlf("efficacy_primary", "Table 14.2.1", "eff", 3)
T_PP = tlf("tlf_14_2_2_pp", "Table 14.2.2", "pp")
T_SEC = tlf("tlf_14_2_3_secondary", "Table 14.2.3", "sec")
T_SUB = tlf("tlf_14_2_4_subgroups", "Table 14.2.4", "sub")
T_SAF = tlf("safety_overview", "Table 14.3.1", "saf")
T_AE = tlf("tlf_14_3_2_ae_soc_pt", "Table 14.3.2", "ae")
T_EXP = tlf("tlf_14_3_3_exposure", "Table 14.3.3", "exp")
ALL_DRAFTED = ["7", "8", "9", "10", "11.1", "11.2", "11.4.1", "11.4.2", "11.4.3", "12.1", "12.2", "12.3"]
BODY = ["11.1", "11.2", "11.4.1", "11.4.2", "11.4.3", "12.1", "12.2", "12.3"]


def lines(*xs):
    return "\n".join(xs)


# (section, title, kind, agent, department, wave, instructions, passages[(doc, like, page)], tlfs, depends_on, required)
REG = [
    ("1", "Title page", "assembled", "assembler", "Regulatory Operations", None,
     lines("Assemble the title page from study_metadata: title, study identifier, compound, sponsor, report date.",
           "Add the coordinating investigator and the database lock date.", "Add the statement that the report describes a synthetic study."),
     [], [], [], ["study title", "study identifier", "sponsor"]),
    ("2", "Synopsis", "drafted", "author", "Medical Writing", 3,
     lines("Summarise the study title, objectives, design, study population and treatment from sections 7, 8 and 9.",
           "Summarise the participant disposition and analysis sets from sections 10 and 11.1, and the baseline characteristics from section 11.2.",
           "Report the primary efficacy result from section 11.4.1 and the key secondary and subgroup findings from sections 11.4.2 and 11.4.3, using the same placeholders as those sections.",
           "Summarise exposure and the safety findings from sections 12.1, 12.2 and 12.3, including deaths and discontinuations due to adverse events.",
           "End with the overall conclusion from section 13.",
           "Use short labelled paragraphs in the order of the ICH E3 synopsis and do not add any figure that is not used in the body."),
     [(PROTO, "52-week, randomised, double-blind, placebo-controlled, parallel-group Phase III study", 1),
      (PROTO, "Duration: Screening of up to 4 weeks", 1)],
     [T_DISP, T_DEMO, T_EFF, T_PP, T_SEC, T_SUB, T_SAF, T_AE, T_EXP], ALL_DRAFTED + ["13"],
     ["study design", "primary endpoint result", "safety conclusion", "overall conclusion"]),
    ("3", "Table of contents", "assembled", "assembler", "Regulatory Operations", None,
     lines("Generate the contents list from the section registry in ICH E3 order."), [], [], [], ["section list"]),
    ("4", "List of abbreviations and definition of terms", "assembled", "assembler", "Regulatory Operations", None,
     lines("List every abbreviation used in the report with its definition, in alphabetical order."), [], [], [],
     ["abbreviations"]),
    ("5", "Ethics", "boilerplate", "assembler", "Regulatory Operations", None,
     lines("Use the ethics statement from study_metadata without changes.",
           "State that the study followed the Declaration of Helsinki and ICH Good Clinical Practice.",
           "State that written informed consent was obtained before any study procedure."),
     [], [], [], ["independent ethics committee", "informed consent", "Good Clinical Practice"]),
    ("6", "Investigators and study administrative structure", "boilerplate", "assembler", "Regulatory Operations", None,
     lines("Name the sponsor and the coordinating investigator from study_metadata.",
           "State the number of sites and countries from study_metadata.",
           "Describe the independent Data Monitoring Committee and the blinded Clinical Endpoint Committee in one sentence each."),
     [], [], [], ["coordinating investigator", "Data Monitoring Committee", "Clinical Endpoint Committee"]),
    ("7", "Introduction", "drafted", "author", "Medical Writing", 1,
     lines("Describe LMN-4471 as an oral, selective inhibitor of a signalling kinase and the disease it is intended to treat.",
           "Summarise the nonclinical and Phase II evidence that led to the selection of 400 mg once daily.",
           "State that Study LMN-301 is the pivotal Phase III study that supports the initial marketing authorisation application.",
           "Say that the report follows ICH E3 and describes the study as it was conducted under Protocol Version 3.0 and SAP Version 2.0."),
     [(PROTO, "LMN-4471 is an oral, selective inhibitor of a signalling kinase", 2),
      (PROTO, "Two Phase II dose-ranging studies informed the selection", 2),
      (PROTO, "pivotal efficacy evidence for the initial marketing", 2)],
     [], [], ["oral selective kinase inhibitor", "Phase II dose-ranging studies", "400 mg once daily", "pivotal Phase III study"]),
    ("8", "Study objectives", "drafted", "author", "Medical Writing", 1,
     lines("State the primary objective as superiority of LMN-4471 over placebo in the proportion of participants meeting the responder definition at Week 52.",
           "Describe the primary endpoint, including adjudication by the blinded Clinical Endpoint Committee.",
           "List the key secondary objectives: change from baseline in symptom score at Week 24 and Week 52, and time to first response.",
           "List the safety objective and the safety endpoints."),
     [(PROTO, "primary objective is to demonstrate the superiority of LMN-4471 over placebo", 1),
      (PROTO, "adjudicated by the blinded Clinical Endpoint Committee", 3)],
     [], [], ["primary objective", "responder definition at Week 52", "key secondary", "safety objective"]),
    ("9", "Investigational plan", "drafted", "author", "Medical Writing", 1,
     lines("Describe the overall design: randomised, double-blind, placebo-controlled, parallel-group, stratified by region and baseline severity.",
           "Summarise the key inclusion and exclusion criteria.",
           "Describe the study treatment, dosing instructions and the rules for dose interruption.",
           "Describe the schedule of visits and assessments up to the Week 52 visit and the safety follow-up.",
           "Describe the statistical methods in brief and refer to the SAP."),
     [(PROTO, "Participants are randomised 1:1 to oral study drug", 1),
      (PROTO, "Adults aged 18 to 85 years with a documented diagnosis", 4),
      (PROTO, "Study drug is supplied as 200 mg tablets", 5)],
     [], [], ["randomised double-blind placebo-controlled", "inclusion criteria", "exclusion criteria", "dose interruption", "schedule of assessments"]),
    ("10", "Study patients", "drafted", "author", "Medical Writing", 1,
     lines("Report the number of participants randomised, treated, completed and discontinued, by arm, with the percentages in Table 14.1.1.",
           "Give the reasons for discontinuation in the order of Table 14.1.1, including adverse events and death.",
           "Explain that participants who discontinue before Week 52 are classed as non-responders in the primary analysis.",
           "Refer to the participant disposition table as Table 14.1.1."),
     [(PROTO, "discontinue study treatment before Week 52", 3),
      (SAP, "are counted as non-responders", 2)],
     [T_DISP], [], ["Table 14.1.1", "randomised", "completed", "reasons for discontinuation"]),
    ("11.1", "Data sets analysed", "drafted", "author", "Biostatistics", 1,
     lines("Define the full analysis set, the per-protocol set and the safety set as in the SAP.",
           "Report the number of participants in each analysis set by arm from Table 14.1.1.",
           "Say that the per-protocol set excludes participants with a major protocol deviation that affects the primary endpoint."),
     [(SAP, "Full analysis set (FAS): all randomised participants", 1),
      (SAP, "repeated in the per-protocol set to assess robustness", 2)],
     [T_DISP], [], ["full analysis set", "per-protocol set", "safety set", "Table 14.1.1"]),
    ("11.2", "Demographic and other baseline characteristics", "drafted", "author", "Biostatistics", 1,
     lines("Describe the age, sex, region, baseline severity and body mass index of the participants by arm, using Table 14.1.2.",
           "State the proportion of participants aged 65 years or older.",
           "Comment on whether the characteristics are balanced between the arms.",
           "Mention that randomisation was stratified by region and baseline severity."),
     [(PROTO, "stratified by region", 1),
      (PROTO, "Adults aged 18 to 85 years with a documented diagnosis", 4)],
     [T_DEMO], [], ["Table 14.1.2", "age", "sex", "region", "baseline severity"]),
    ("11.4.1", "Primary efficacy endpoint", "drafted", "author", "Biostatistics", 1,
     lines("State the primary endpoint: the proportion of participants meeting the responder definition at Week 52, adjudicated by the blinded Clinical Endpoint Committee.",
           "Report the responders, the number analysed and the response rate in each arm from Table 14.2.1.",
           "Report the treatment difference with its 95% confidence interval, and state the method used (Wald, with the Cochran-Mantel-Haenszel test for superiority).",
           "Report the per-protocol sensitivity analysis from Table 14.2.2 and say whether it supports the primary analysis.",
           "Say that participants who discontinued before Week 52 were counted as non-responders."),
     [(SAP, "Superiority is tested with a Cochran-Mantel-Haenszel", 2),
      (PROTO, "The responder definition is specified in Appendix B", 3),
      (PROTO, "adjudicated by the blinded Clinical Endpoint Committee", 3)],
     [T_EFF, T_PP], [], ["Table 14.2.1", "Table 14.2.2", "95% confidence interval", "per-protocol", "non-responders"]),
    ("11.4.2", "Secondary efficacy endpoints", "drafted", "author", "Biostatistics", 1,
     lines("Describe the hierarchical testing order of the key secondary endpoints and that they are tested only if the primary endpoint is significant.",
           "Report the change from baseline in symptom score at Week 52 and at Week 24, by arm, with the difference and its 95% confidence interval, from Table 14.2.3.",
           "Report the median time to first response by arm from Table 14.2.3, and state that each key secondary comparison had a nominal p < 0.001.",
           "Say that the symptom score changes are observed-case means with a 95% confidence interval, as described in Table 14.2.3."),
     [(SAP, "tested in a fixed hierarchical order", 3),
      (PROTO, "Change from baseline in symptom score at Week 24 and Week 52", 3)],
     [T_SEC], [], ["Table 14.2.3", "symptom score", "time to first response", "hierarchical"]),
    ("11.4.3", "Efficacy in subgroups", "drafted", "author", "Biostatistics", 1,
     lines("List the prespecified subgroups: age group, sex, region and baseline severity.",
           "Report the response rate by arm and the treatment difference in each subgroup from Table 14.2.4.",
           "Say that the subgroup analyses are descriptive and that no multiplicity adjustment was applied.",
           "Comment on whether the direction of the treatment effect is consistent across subgroups and refer to Figure 14.2.1."),
     [(SAP, "Prespecified subgroups for the primary endpoint are age group", 4),
      (SAP, "No multiplicity adjustment is applied to exploratory and subgroup analyses", 3)],
     [T_SUB], [], ["Table 14.2.4", "subgroups", "no multiplicity adjustment", "consistent"]),
    ("12.1", "Extent of exposure", "drafted", "author", "Clinical Safety", 1,
     lines("Describe the planned treatment duration: a 52-week treatment period followed by a safety follow-up.",
           "Report the mean duration of exposure, the number of participants exposed for 48 weeks or longer and the mean compliance, by arm, from Table 14.3.3.",
           "Report the mean cumulative dose by arm.",
           "Mention the rule for dose interruptions."),
     [(PROTO, "Duration: Screening of up to 4 weeks", 1),
      (PROTO, "Dose interruption is permitted", 5)],
     [T_EXP], [], ["Table 14.3.3", "duration of exposure", "cumulative dose", "compliance"]),
    ("12.2", "Adverse events", "drafted", "author", "Clinical Safety", 1,
     lines("Give the overview of treatment-emergent adverse events by arm from Table 14.3.1: any event, serious events, events leading to discontinuation and deaths.",
           "Describe the most frequent events by system organ class and preferred term from Table 14.3.2.",
           "Point out the events that were more frequent with LMN-4471 than with placebo.",
           "Say that events were coded with MedDRA and summarised by system organ class and preferred term."),
     [(SAP, "Treatment-emergent adverse events are summarised by system organ class", 4),
      (PROTO, "Adverse events are coded with the current version of MedDRA", 6)],
     [T_SAF, T_AE], [], ["Table 14.3.1", "Table 14.3.2", "system organ class", "preferred term", "MedDRA"]),
    ("12.3", "Deaths, other serious adverse events and other significant adverse events", "drafted", "author", "Clinical Safety", 1,
     lines("Report the number of deaths by arm from Table 14.3.1 and refer to the narratives in section 12.3.2.",
           "Report the number of participants with serious adverse events by arm from Table 14.3.1.",
           "Report the number of participants who discontinued study drug because of an adverse event, by arm.",
           "State that serious adverse events were reported to the sponsor within 24 hours and that the independent Data Monitoring Committee reviewed unblinded safety data."),
     [(PROTO, "reported to the sponsor within 24 hours of site awareness", 6),
      (PROTO, "reviews unblinded safety data approximately every", 6)],
     [T_SAF], [], ["deaths", "serious adverse events", "discontinuation due to adverse events", "section 12.3.2"]),
    ("12.3.2", "Narratives of deaths and other serious adverse events", "narrative", "narrative", "Clinical Safety", 1,
     lines("Write one narrative per participant in narrative_patients: all deaths and all serious adverse events that led to withdrawal of study drug.",
           "Give age, sex, arm, the event term and system organ class, the study day of onset and the study day of death or resolution.",
           "State the investigator causality, the action taken with study drug and the outcome.",
           "Use the past tense, the third person and the same order of facts in every narrative."),
     [], [], [], ["age and sex", "event term", "study day of onset", "causality", "outcome"]),
    ("13", "Discussion and overall conclusions", "drafted", "author", "Medical Writing", 2,
     lines("Summarise the efficacy findings from sections 11.4.1, 11.4.2 and 11.4.3 and state whether the primary objective was met.",
           "Summarise the safety findings from sections 12.1, 12.2 and 12.3, including deaths and discontinuations due to adverse events.",
           "Discuss the benefit-risk balance of LMN-4471 400 mg once daily in the studied population.",
           "State the overall conclusion in one paragraph, using only placeholders already used in sections 11 and 12."),
     [(PROTO, "pivotal efficacy evidence for the initial marketing", 2),
      (PROTO, "The sample size provides at least 90% power", 6)],
     [T_DISP, T_DEMO, T_EFF, T_PP, T_SEC, T_SUB, T_SAF, T_AE, T_EXP], BODY,
     ["primary objective was met", "benefit-risk", "overall conclusion"]),
    ("14", "Tables, figures and graphs referred to but not included in the text", "assembled", "assembler", "Regulatory Operations", None,
     lines("Render every certified TLF table in the order of the SAP output list.",
           "Show the table title, the table version and the certification status for each table."),
     [], [], [], ["Table 14.1.1", "Table 14.2.1", "Table 14.3.2"]),
    ("15", "Reference list", "assembled", "assembler", "Regulatory Operations", None,
     lines("List the protocol, the SAP and the ICH E3 guideline as references."), [], [], [], ["Protocol", "Statistical Analysis Plan"]),
    ("16", "Appendices", "assembled", "assembler", "Regulatory Operations", None,
     lines("List the appendices: protocol and amendments, sample case report form, list of investigators, statistical analysis plan."),
     [], [], [], ["protocol", "statistical analysis plan"]),
]
reg_rows = []
for i, (sec, title, kind, agent, dept, wave, ins, passages, tlfs, deps, req) in enumerate(REG, start=1):
    reg_rows.append((sec, title, i, kind, agent, dept, wave, ins,
                     json.dumps([{"doc": d, "like": f"%{lk}%", "page": pg} for d, lk, pg in passages]),
                     json.dumps(tlfs), json.dumps(deps), json.dumps(req)))

# verify every passage matches exactly 1 element on the stated page
for r in reg_rows:
    for ps in json.loads(r[8]):
        n = one(f"""SELECT COUNT(*) FROM {FQ}.doc_elements WHERE (file_path LIKE '{ps['doc']}' OR doc_title LIKE '{ps['doc']}')
                    AND content LIKE '{q_esc(ps['like'])}'""")
        assert n == 1, f"section {r[0]}: passage {ps} matches {n} elements"
        pg = one(f"""SELECT page FROM {FQ}.doc_elements WHERE (file_path LIKE '{ps['doc']}' OR doc_title LIKE '{ps['doc']}')
                     AND content LIKE '{q_esc(ps['like'])}'""")
        assert pg == ps["page"], f"section {r[0]}: {ps} is on page {pg}"
write(reg_rows, S(("section", StringType()), ("title", StringType()), ("ord", IntegerType()), ("kind", StringType()),
                  ("agent", StringType()), ("department", StringType()), ("wave", IntegerType()),
                  ("instructions", StringType()), ("source_passages", StringType()), ("tlf_tables", StringType()),
                  ("depends_on", StringType()), ("required_content", StringType())), "section_registry")
sql(f"COMMENT ON TABLE {FQ}.section_registry IS 'Section plan for the LMN-301 clinical study report in ICH E3 order: kind, owning agent and department, drafting wave, instructions, source passages (LIKE patterns that each match exactly one doc_elements row), TLF tables and dependencies. Synthetic study. {SYN}'")
sql(f"ALTER TABLE {FQ}.section_registry SET TAGS ({TAGS})")
for col, cm in {"source_passages": "JSON array of {doc, like, page}; doc is a LIKE pattern on the document, like matches exactly one doc_elements row",
                "tlf_tables": "JSON array of {table, tlf, alias, version}; version null means the current table version",
                "depends_on": "JSON array of section numbers that must be drafted first",
                "required_content": "JSON array of short phrases the section must cover (coverage check)",
                "wave": "Drafting wave: 1 independent sections and narratives, 2 discussion, 3 synopsis; NULL for assembled and boilerplate sections"}.items():
    sql(f"ALTER TABLE {FQ}.section_registry ALTER COLUMN {col} COMMENT '{q_esc(cm)}'")

# --------------------------------------------------------------------------------------
# 5. Engine tables (created only if missing; the app writes them)
# --------------------------------------------------------------------------------------
banner("engine tables (create if not exists)")
ENGINE_DDL = {
    "csr_runs": """run_id STRING, base_run_id STRING, status STRING COMMENT 'running, done or error', started_at TIMESTAMP,
  finished_at TIMESTAMP, efficacy_version INT, sections_requested STRING COMMENT 'JSON array', plan_json STRING,
  document_checks_json STRING, genie_checks_json STRING, model STRING, judge_model STRING, trace_id STRING, wall_ms BIGINT""",
    "csr_sections": """run_id STRING, section STRING, title STRING, ord INT, kind STRING, agent STRING, department STRING,
  status STRING COMMENT 'assembled, drafted, checked, needs_person or failed', templates_json STRING, sentences_json STRING,
  sources_json STRING, checks_json STRING, judge_json STRING, needs_person_json STRING, tool_log_json STRING,
  trace_id STRING, drafted_at TIMESTAMP""",
    "csr_figure_citations": """run_id STRING, section STRING, sentence_idx INT, slot STRING, source_table STRING, tlf STRING,
  row_key STRING, column_name STRING, table_version BIGINT, value_text STRING""",
    "csr_signoffs": """signoff_id STRING, run_id STRING, department STRING, scope STRING, signer STRING, role STRING,
  decision STRING COMMENT 'approved or changes_requested', note STRING, table_versions_json STRING, signed_at TIMESTAMP""",
}
ENGINE_COMMENT = {
    "csr_runs": "One row per CSR Pod run, written by the rnd-regsub-review app.",
    "csr_sections": "One row per section per CSR Pod run: templates, sentences, sources, checks, judge result and tool log.",
    "csr_figure_citations": "One row per bound figure in a CSR Pod run: slot, certified table cell, table version and value.",
    "csr_signoffs": "Departmental sign-offs on a CSR Pod run, written by the rnd-regsub-review app.",
}
for t, ddl in ENGINE_DDL.items():
    sql(f"CREATE TABLE IF NOT EXISTS {FQ}.{t} ({ddl})")
    sql(f"COMMENT ON TABLE {FQ}.{t} IS '{ENGINE_COMMENT[t]} {SYN}'")
    sql(f"ALTER TABLE {FQ}.{t} SET TAGS ({TAGS})")

# --------------------------------------------------------------------------------------
# 6. Consistency assertions (fail loudly)
# --------------------------------------------------------------------------------------
banner("assertions")


def check(name, got, want):
    assert got == want, f"ASSERT FAILED {name}: got {got}, want {want}"
    print(f"ok  {name}: {got}")


saf = {r["arm"]: r.asDict() for r in sql(f"SELECT * FROM {FQ}.safety_overview").collect()}
for a in (T, P):
    s = saf[a]
    cnt = lambda cond: one(f"SELECT COUNT(DISTINCT usubjid) FROM {FQ}.adae WHERE arm = '{a}' AND {cond}")  # noqa: E731
    check(f"adae any TEAE {a}", cnt("1 = 1"), s["any_teae"])
    check(f"adae SAE {a}", cnt("aeser = 'Y'"), s["serious_ae"])
    check(f"adae drug withdrawn {a}", cnt("aeacn = 'DRUG WITHDRAWN'"), s["ae_discontinuation"])
    check(f"adae fatal {a}", cnt("aeout = 'FATAL'"), s["deaths"])
    check(f"adds AE discontinuation {a}", one(f"SELECT COUNT(*) FROM {FQ}.adds WHERE arm = '{a}' AND dsdecod = 'ADVERSE EVENT'"), s["ae_discontinuation"])
    check(f"adds deaths {a}", one(f"SELECT COUNT(*) FROM {FQ}.adds WHERE arm = '{a}' AND dsdecod = 'DEATH'"), s["deaths"])
check("adds rows", one(f"SELECT COUNT(*) FROM {FQ}.adds"), 1227)
check("adae subjects with AE are in adsl", one(f"SELECT COUNT(*) FROM {FQ}.adae a LEFT ANTI JOIN {FQ}.adsl s ON a.usubjid = s.usubjid"), 0)
check("fatal subjects all have dsdecod DEATH", one(f"SELECT COUNT(*) FROM {FQ}.adae a JOIN {FQ}.adds d ON a.usubjid = d.usubjid WHERE a.aeout = 'FATAL' AND d.dsdecod = 'DEATH'"), 5)
check("withdrawn subjects all have dsdecod ADVERSE EVENT", one(f"SELECT COUNT(DISTINCT a.usubjid) FROM {FQ}.adae a JOIN {FQ}.adds d ON a.usubjid = d.usubjid WHERE a.aeacn = 'DRUG WITHDRAWN' AND d.dsdecod = 'ADVERSE EVENT'"), 60)
check("no AE starts after the last day on treatment", one(f"SELECT COUNT(*) FROM {FQ}.adae a JOIN {FQ}.adex x ON a.usubjid = x.usubjid WHERE a.aestdy > x.trtdurd"), 0)

ae = {r["row_key"]: r for r in sql(f"SELECT * FROM {FQ}.tlf_14_3_2_ae_soc_pt").collect()}
check("14.3.2 ANY_TEAE trt", ae["ANY_TEAE"]["trt_n"], 441)
check("14.3.2 ANY_TEAE pbo", ae["ANY_TEAE"]["pbo_n"], 419)
check("14.3.2 ANY_TEAE row_order", ae["ANY_TEAE"]["row_order"], 1)
assert all(r["trt_n"] <= 441 and r["pbo_n"] <= 419 for r in ae.values())
check("14.3.2 row keys unique", len(ae), one(f"SELECT COUNT(DISTINCT row_key) FROM {FQ}.tlf_14_3_2_ae_soc_pt"))

d = {r["row_key"]: r for r in sql(f"SELECT * FROM {FQ}.tlf_14_1_1_disposition").collect()}
check("14.1.1 RANDOMISED", (d["RANDOMISED"]["trt_n"], d["RANDOMISED"]["pbo_n"]), (618, 609))
check("14.1.1 DISC_AE", (d["DISC_AE"]["trt_n"], d["DISC_AE"]["pbo_n"]), (38, 22))
check("14.1.1 DISC_DEATH", (d["DISC_DEATH"]["trt_n"], d["DISC_DEATH"]["pbo_n"]), (2, 3))
for arm_col in ("trt_n", "pbo_n", "total_n"):
    parts = sum(d[k][arm_col] for k in ["DISC_AE", "DISC_LOE", "DISC_WITHDRAWAL", "DISC_LTFU", "DISC_DEATH", "DISC_OTHER"])
    check(f"14.1.1 discontinuation reasons add up ({arm_col})", parts, d["DISCONTINUED"][arm_col])
    check(f"14.1.1 completed + discontinued ({arm_col})", d["COMPLETED"][arm_col] + d["DISCONTINUED"][arm_col], d["RANDOMISED"][arm_col])

dm = {r["row_key"]: r for r in sql(f"SELECT * FROM {FQ}.tlf_14_1_2_demographics").collect()}
check("14.1.2 FEMALE+MALE trt/pbo", (dm["FEMALE"]["trt"] + dm["MALE"]["trt"], dm["FEMALE"]["pbo"] + dm["MALE"]["pbo"]), (618.0, 609.0))
check("14.1.2 FEMALE total", dm["FEMALE"]["total"], 735.0)
check("14.1.2 MALE total", dm["MALE"]["total"], 492.0)
for pair in (("REGION_EU", "REGION_NA", "REGION_APAC"), ("SEV_MODERATE", "SEV_SEVERE")):
    check(f"14.1.2 {pair} add up", (sum(dm[k]["trt"] for k in pair), sum(dm[k]["pbo"] for k in pair)), (618.0, 609.0))
assert 53.0 <= dm["AGE_MEAN"]["total"] <= 55.5, dm["AGE_MEAN"]["total"]

# per-protocol set consistency and recomputation of 14.2.2 from adeff
pp_n = one(f"SELECT COUNT(*) FROM {FQ}.adsl_ext WHERE pp_fl = 'Y'")
check("PPS count equals 14.1.1 PPS total", pp_n, d["PPS"]["total_n"])
check("pp_fl = N iff excluding major deviation", one(f"""SELECT COUNT(*) FROM {FQ}.adsl_ext x LEFT JOIN
  (SELECT DISTINCT usubjid FROM {FQ}.addv WHERE excl_pp = 'Y' AND severity = 'Major') v ON x.usubjid = v.usubjid
  WHERE (x.pp_fl = 'N') <> (v.usubjid IS NOT NULL)"""), 0)
pp_expect = {}
ppdf = df[~df.usubjid.isin(excl)]
for a, key in ((T, "TRT"), (P, "PBO")):
    sub = ppdf[ppdf.arm == a]
    pp_expect[key] = (len(sub), int(sub.aval.sum()))
pp = {r["row_key"]: r for r in sql(f"SELECT * FROM {FQ}.tlf_14_2_2_pp").collect()}
for key in ("TRT", "PBO"):
    n_, r_ = pp_expect[key]
    check(f"14.2.2 {key} n/responders from adeff", (pp[key]["n"], pp[key]["responders"]), (n_, r_))
    check(f"14.2.2 {key} rate rounded to 1 decimal", pp[key]["rate_pct"], round(100 * r_ / n_ + 1e-9, 1))
p1, p2 = pp_expect["TRT"][1] / pp_expect["TRT"][0], pp_expect["PBO"][1] / pp_expect["PBO"][0]
se = (p1 * (1 - p1) / pp_expect["TRT"][0] + p2 * (1 - p2) / pp_expect["PBO"][0]) ** 0.5
for col, val in (("diff_pct", 100 * (p1 - p2)), ("ci_low", 100 * (p1 - p2 - 1.96 * se)), ("ci_high", 100 * (p1 - p2 + 1.96 * se))):
    assert abs(pp["DIFF"][col] - val) <= 0.051, (col, pp["DIFF"][col], val)
print("ok  14.2.2 DIFF recomputed:", pp["DIFF"]["diff_pct"], pp["DIFF"]["ci_low"], pp["DIFF"]["ci_high"])

np_rows = sql(f"SELECT * FROM {FQ}.narrative_patients").collect()
check("narrative_patients rows", len(np_rows), 10)
check("narrative_patients deaths", sum(1 for r in np_rows if r["narrative_reason"] == "Death"), 5)
check("narrative_patients SAE leading to discontinuation", sum(1 for r in np_rows if r["narrative_reason"] != "Death"), 5)
check("narrative_patients unique", len({r["row_key"] for r in np_rows}), 10)

sec = {r["row_key"]: r for r in sql(f"SELECT * FROM {FQ}.tlf_14_2_3_secondary").collect()}
assert sec["SYMCHG52"]["trt"] < sec["SYMCHG52"]["pbo"] and sec["TTRESP"]["trt"] < sec["TTRESP"]["pbo"], "secondary effects must favour LMN-4471"
assert sec["TTRESP"]["trt"] is not None and sec["TTRESP"]["pbo"] is not None, "median time to response must exist in both arms"
check("registry sections", one(f"SELECT COUNT(*) FROM {FQ}.section_registry"), len(REG))
check("registry drafted sections", one(f"SELECT COUNT(*) FROM {FQ}.section_registry WHERE kind = 'drafted'"), 14)
for r in sql(f"SELECT tlf_tables FROM {FQ}.section_registry").collect():
    for t in json.loads(r[0]):
        assert t["table"] in before | set(OWNED), t
        assert t["table"] in ("efficacy_primary", "safety_overview") or t["table"] in TLF_TABLES, t
check("TLF tables certified", one(f"""SELECT COUNT(*) FROM {dbx.CATALOG}.information_schema.table_tags WHERE schema_name = '{dbx.SCHEMA}'
  AND tag_name = 'system.certification_status' AND tag_value = 'certified' AND table_name LIKE 'tlf_%'"""), 7)

after = {r["tableName"] for r in sql(f"SHOW TABLES IN {FQ}").collect()}
check("pre-existing tables unchanged", sorted(after - set(OWNED) - set(ENGINE)), pre_existing)
check("efficacy_primary still at version 4", one(f"SELECT MAX(version) FROM (DESCRIBE HISTORY {FQ}.efficacy_primary)"), 4)

# --------------------------------------------------------------------------------------
# 7. Report
# --------------------------------------------------------------------------------------
banner("row counts")
for t in OWNED + ENGINE:
    print(f"{t:28s}", one(f"SELECT COUNT(*) FROM {FQ}.{t}"))
banner("section_registry")
for r in sql(f"SELECT section, kind, wave, tlf_tables, source_passages FROM {FQ}.section_registry ORDER BY ord").collect():
    tl = ", ".join(f"{x['tlf']}{' v' + str(x['version']) if x['version'] else ''}" for x in json.loads(r['tlf_tables']))
    ps = "; ".join(f"{x['doc'].strip('%')} p{x['page']}: {x['like'].strip('%')}" for x in json.loads(r['source_passages']))
    print(f"{r['section']:7s} {r['kind']:11s} wave={r['wave']}  tlf=[{tl}]\n          passages: {ps}")
for t, where in [("tlf_14_1_1_disposition", None), ("tlf_14_3_2_ae_soc_pt", "row_key = 'ANY_TEAE'"),
                 ("tlf_14_2_2_pp", None), ("tlf_14_2_3_secondary", None)]:
    banner(t)
    sql(f"SELECT * FROM {FQ}.{t} {'WHERE ' + where if where else ''} ORDER BY row_order").show(50, truncate=False)
print("done")
