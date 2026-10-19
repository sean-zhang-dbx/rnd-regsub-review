"""Build the synthetic LMN-301 data for the rnd_regsub_review demo.

Run (Python 3.12 + Databricks Connect serverless, profile fe-vm-sean-zhang):

    uv run --python 3.12 --with "databricks-connect>=16.4,<17.4" --with numpy --with pandas \
        python scripts/generate_data.py

What it does, in order:
  1. adsl and adeff from a fixed seed (412/618 and 287/609 responders).
  2. efficacy_primary (Delta versions 0 to 3, the pre-restatement state is version 3) and
     safety_overview, both built with INSERT ... SELECT from adsl/adeff so lineage exists, and
     both certified with the governed tag system.certification_status=certified.
  3. The restatement: 3 treatment subjects flip from 1 to 0 in adeff (adjudicated_at
     2026-10-19 09:12 UTC), then efficacy_primary is overwritten as Delta version 4. The business
     time goes into the version 4 commit's userMetadata, because commit timestamps cannot be
     backdated.
  4. document_sentences and figure_citations, written against version 3.
  5. Empty review_signoffs and wording_checks.

The script drops and recreates the tables it owns, so it is safe to re-run.
"""
import json
import os
import sys
import time
from datetime import datetime, timedelta

os.environ["TZ"] = "UTC"  # naive datetimes below are UTC, matching the Spark session time zone
time.tzset()
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402

from databricks.connect import DatabricksSession  # noqa: E402
from pyspark.sql.types import (  # noqa: E402
    IntegerType, LongType, StringType, StructField, StructType, TimestampType,
)

FQ = dbx.FQ
SEED = 301471
N_TRT, N_PBO = 618, 609
RESP_TRT_PRE, RESP_PBO = 412, 287
N_FLIP = 3
RESTATED_AT = "2026-10-19 09:12:00"
RESTATED_META = {"restated_at": "2026-10-19T09:12:00Z", "restated_by": "Biostatistics"}

spark = DatabricksSession.builder.remote(host=dbx.HOST, token=dbx.token(), serverless=True).getOrCreate()
spark.conf.set("spark.sql.session.timeZone", "UTC")
sql = spark.sql


def banner(msg: str) -> None:
    print(f"\n== {msg}")


# --------------------------------------------------------------------------------------
# 0. Clean slate (tables only; the schema, volume and index are owned by other steps)
# --------------------------------------------------------------------------------------
banner("drop existing tables")
for t in ["review_signoffs", "wording_checks", "figure_citations", "document_sentences",
          "efficacy_primary", "safety_overview", "adeff", "adsl"]:
    sql(f"DROP TABLE IF EXISTS {FQ}.{t}")
try:
    sql(f"ALTER SCHEMA {FQ} DISABLE PREDICTIVE OPTIMIZATION")
    print("predictive optimization disabled on schema (keeps Delta versions stable)")
except Exception as e:  # noqa: BLE001
    print("could not disable predictive optimization:", str(e)[:160])

# --------------------------------------------------------------------------------------
# 1. adsl and adeff
# --------------------------------------------------------------------------------------
banner("adsl / adeff")
rng = np.random.default_rng(SEED)
countries = ["United States", "Germany", "United Kingdom", "France", "Spain", "Italy",
             "Poland", "Canada", "Australia", "Japan"]
country_weights = np.array([0.27, 0.13, 0.09, 0.09, 0.08, 0.08, 0.09, 0.07, 0.05, 0.05])
n_sites = 62
site_country = rng.choice(len(countries), size=n_sites, p=country_weights)
site_weight = rng.gamma(2.2, 1.0, size=n_sites)
site_weight /= site_weight.sum()

n_total = N_TRT + N_PBO
site_of = rng.choice(n_sites, size=n_total, p=site_weight)
site_counter: dict[int, int] = {}
usubjid = []
for s in site_of:
    site_counter[s] = site_counter.get(s, 0) + 1
    usubjid.append(f"LMN301-{1001 + s:04d}-{site_counter[s]:03d}")

arm = np.array(["LMN-4471 400 mg"] * N_TRT + ["Placebo"] * N_PBO)
arm = rng.permutation(arm)
age = np.clip(np.round(rng.normal(54.3, 11.8, n_total)), 18, 84).astype(int)
sex = np.where(rng.random(n_total) < 0.58, "F", "M")
country = [countries[site_country[s]] for s in site_of]

adsl_pdf = pd.DataFrame({
    "usubjid": usubjid, "study_id": "LMN-301", "arm": arm, "age": age, "sex": sex,
    "country": country, "randfl": "Y",
})

aval = np.zeros(n_total, dtype=int)
trt_idx = np.where(arm == "LMN-4471 400 mg")[0]
pbo_idx = np.where(arm == "Placebo")[0]
aval[rng.choice(trt_idx, RESP_TRT_PRE, replace=False)] = 1
aval[rng.choice(pbo_idx, RESP_PBO, replace=False)] = 1

start = datetime(2026, 8, 3)
adj = []
for k in range(n_total):
    day = start + timedelta(days=int(rng.integers(0, 68)))
    while day.weekday() >= 5:
        day += timedelta(days=1)
    adj.append(day + timedelta(hours=int(rng.integers(8, 18)), minutes=int(rng.integers(0, 60)),
                               seconds=int(rng.integers(0, 60))))
adeff_pdf = pd.DataFrame({
    "usubjid": usubjid, "paramcd": "PRIMRESP", "avisit": "Week 52", "aval": aval, "adjudicated_at": adj,
})

adsl_schema = StructType([
    StructField("usubjid", StringType()), StructField("study_id", StringType()),
    StructField("arm", StringType()), StructField("age", IntegerType()),
    StructField("sex", StringType()), StructField("country", StringType()),
    StructField("randfl", StringType()),
])
adeff_schema = StructType([
    StructField("usubjid", StringType()), StructField("paramcd", StringType()),
    StructField("avisit", StringType()), StructField("aval", IntegerType()),
    StructField("adjudicated_at", TimestampType()),
])
spark.createDataFrame(adsl_pdf, adsl_schema).write.mode("overwrite").saveAsTable(f"{FQ}.adsl")
spark.createDataFrame(adeff_pdf, adeff_schema).write.mode("overwrite").saveAsTable(f"{FQ}.adeff")
sql(f"COMMENT ON TABLE {FQ}.adsl IS 'Subject-level analysis dataset for synthetic Phase III study LMN-301 (fictional compound LMN-4471). Synthetic data, not real patients.'")
sql(f"COMMENT ON TABLE {FQ}.adeff IS 'Primary responder analysis dataset (PRIMRESP, Week 52) for synthetic study LMN-301. adjudicated_at is the Clinical Endpoint Committee adjudication time.'")
print("adsl rows", sql(f"select count(*) from {FQ}.adsl").first()[0],
      "| adeff rows", sql(f"select count(*) from {FQ}.adeff").first()[0])

# --------------------------------------------------------------------------------------
# 2. efficacy_primary (versions 0 to 3) and safety_overview
# --------------------------------------------------------------------------------------
banner("efficacy_primary v0..v3, safety_overview")
sql(f"""
CREATE TABLE {FQ}.efficacy_primary (
  row_key  STRING COMMENT 'TRT, PBO or DIFF',
  study_id STRING,
  arm      STRING,
  n        INT    COMMENT 'Randomised subjects in the full analysis set',
  responders INT  COMMENT 'Subjects with aval = 1 at Week 52',
  rate_pct DOUBLE COMMENT 'responders / n x 100',
  diff_pct DOUBLE COMMENT 'Treatment minus placebo, percentage points (DIFF row only)',
  ci_low   DOUBLE COMMENT 'Wald 95% CI lower bound of the difference (DIFF row only)',
  ci_high  DOUBLE COMMENT 'Wald 95% CI upper bound of the difference (DIFF row only)'
) USING DELTA
TBLPROPERTIES ('delta.autoOptimize.autoCompact' = 'false', 'delta.autoOptimize.optimizeWrite' = 'false')
""")  # version 0

EFF_SELECT = f"""
WITH per_arm AS (
  SELECT s.study_id, s.arm, COUNT(*) AS n, CAST(SUM(e.aval) AS INT) AS responders
  FROM {FQ}.adsl s JOIN {FQ}.adeff e ON s.usubjid = e.usubjid
  WHERE e.paramcd = 'PRIMRESP' AND e.avisit = 'Week 52' AND s.randfl = 'Y'
  GROUP BY s.study_id, s.arm
), w AS (
  SELECT
    MAX(study_id) AS study_id,
    MAX(CASE WHEN arm = 'LMN-4471 400 mg' THEN n END) AS tn,
    MAX(CASE WHEN arm = 'LMN-4471 400 mg' THEN responders END) AS tr,
    MAX(CASE WHEN arm = 'Placebo' THEN n END) AS pn,
    MAX(CASE WHEN arm = 'Placebo' THEN responders END) AS pr
  FROM per_arm
), p AS (
  SELECT study_id, tn, tr, pn, pr, tr / tn AS p1, pr / pn AS p2,
         SQRT((tr / tn) * (1 - tr / tn) / tn + (pr / pn) * (1 - pr / pn) / pn) AS se
  FROM w
)
SELECT 'TRT' AS row_key, study_id, 'LMN-4471 400 mg' AS arm, CAST(tn AS INT) AS n, CAST(tr AS INT) AS responders,
       ROUND(100 * p1, 4) AS rate_pct, CAST(NULL AS DOUBLE) AS diff_pct, CAST(NULL AS DOUBLE) AS ci_low, CAST(NULL AS DOUBLE) AS ci_high FROM p
UNION ALL
SELECT 'PBO', study_id, 'Placebo', CAST(pn AS INT), CAST(pr AS INT),
       ROUND(100 * p2, 4), CAST(NULL AS DOUBLE), CAST(NULL AS DOUBLE), CAST(NULL AS DOUBLE) FROM p
UNION ALL
SELECT 'DIFF', study_id, 'Difference (LMN-4471 minus placebo)', CAST(NULL AS INT), CAST(NULL AS INT),
       CAST(NULL AS DOUBLE), ROUND(100 * (p1 - p2), 4),
       ROUND(100 * (p1 - p2 - 1.96 * se), 4), ROUND(100 * (p1 - p2 + 1.96 * se), 4) FROM p
"""
sql(f"INSERT INTO {FQ}.efficacy_primary {EFF_SELECT}")  # version 1
sql(f"COMMENT ON TABLE {FQ}.efficacy_primary IS 'CERTIFIED by Biostatistics. Primary responder analysis, Week 52, study LMN-301 (LMN-4471 400 mg once daily vs placebo, full analysis set). Built from adsl and adeff. Synthetic data.'")  # version 2
sql(f"ALTER TABLE {FQ}.efficacy_primary SET TBLPROPERTIES ('biostat.database_lock' = '2026-10-12', 'biostat.analysis_set' = 'FAS')")  # version 3

sql(f"""
CREATE TABLE {FQ}.safety_overview (
  row_key STRING, study_id STRING, arm STRING, n INT,
  any_teae INT COMMENT 'Participants with at least one treatment-emergent adverse event',
  serious_ae INT, ae_discontinuation INT COMMENT 'TEAE leading to discontinuation of study drug',
  deaths INT
) USING DELTA
""")
sql(f"""
INSERT INTO {FQ}.safety_overview
SELECT CASE WHEN arm = 'Placebo' THEN 'PBO' ELSE 'TRT' END AS row_key, 'LMN-301' AS study_id, arm,
       CAST(COUNT(*) AS INT) AS n,
       CASE WHEN arm = 'Placebo' THEN 419 ELSE 441 END AS any_teae,
       CASE WHEN arm = 'Placebo' THEN 41  ELSE 53  END AS serious_ae,
       CASE WHEN arm = 'Placebo' THEN 22  ELSE 38  END AS ae_discontinuation,
       CASE WHEN arm = 'Placebo' THEN 3   ELSE 2   END AS deaths
FROM {FQ}.adsl WHERE randfl = 'Y' GROUP BY arm
""")
sql(f"COMMENT ON TABLE {FQ}.safety_overview IS 'CERTIFIED by Biostatistics. Safety population overview for study LMN-301. Unchanged by the Week 52 responder restatement. Synthetic data.'")

for t in ["efficacy_primary", "safety_overview"]:
    sql(f"ALTER TABLE {FQ}.{t} SET TAGS ('system.certification_status' = 'certified')")
    sql(f"ALTER TABLE {FQ}.{t} SET TAGS ('sz_domain' = 'rnd', 'sz_project' = 'regsub_review', 'asset_class' = 'app')")
for t in ["adsl", "adeff"]:
    sql(f"ALTER TABLE {FQ}.{t} SET TAGS ('sz_domain' = 'rnd', 'sz_project' = 'regsub_review', 'asset_class' = 'app')")

# --------------------------------------------------------------------------------------
# 3. Citations and sentences are written against version 3 (before the restatement)
# --------------------------------------------------------------------------------------
banner("figures at version 3")
rows_v3 = {r["row_key"]: r.asDict() for r in sql(f"SELECT * FROM {FQ}.efficacy_primary VERSION AS OF 3").collect()}
assert rows_v3["TRT"]["responders"] == RESP_TRT_PRE and rows_v3["TRT"]["n"] == N_TRT, rows_v3["TRT"]
assert rows_v3["PBO"]["responders"] == RESP_PBO and rows_v3["PBO"]["n"] == N_PBO, rows_v3["PBO"]
saf = {r["row_key"]: r.asDict() for r in sql(f"SELECT * FROM {FQ}.safety_overview").collect()}
saf_version = sql(f"SELECT MAX(version) FROM (DESCRIBE HISTORY {FQ}.safety_overview)").first()[0]


def f1(x: float) -> str:
    return f"{x:.1f}"


# fig_key -> (source_table, row_key, column_name, version, text at version 3)
FIGS: dict[str, tuple] = {
    "trt_resp": ("efficacy_primary", "TRT", "responders", 3, str(rows_v3["TRT"]["responders"])),
    "trt_n": ("efficacy_primary", "TRT", "n", 3, str(rows_v3["TRT"]["n"])),
    "trt_rate": ("efficacy_primary", "TRT", "rate_pct", 3, f1(rows_v3["TRT"]["rate_pct"])),
    "pbo_resp": ("efficacy_primary", "PBO", "responders", 3, str(rows_v3["PBO"]["responders"])),
    "pbo_n": ("efficacy_primary", "PBO", "n", 3, str(rows_v3["PBO"]["n"])),
    "pbo_rate": ("efficacy_primary", "PBO", "rate_pct", 3, f1(rows_v3["PBO"]["rate_pct"])),
    "diff": ("efficacy_primary", "DIFF", "diff_pct", 3, f1(rows_v3["DIFF"]["diff_pct"])),
    "ci_low": ("efficacy_primary", "DIFF", "ci_low", 3, f1(rows_v3["DIFF"]["ci_low"])),
    "ci_high": ("efficacy_primary", "DIFF", "ci_high", 3, f1(rows_v3["DIFF"]["ci_high"])),
}
for arm_key, prefix in (("TRT", "trt"), ("PBO", "pbo")):
    s = saf[arm_key]
    FIGS[f"{prefix}_any_teae"] = ("safety_overview", arm_key, "any_teae", saf_version, str(s["any_teae"]))
    FIGS[f"{prefix}_any_teae_pct"] = ("safety_overview", arm_key, "any_teae", saf_version, f1(100 * s["any_teae"] / s["n"]))
    FIGS[f"{prefix}_sae_pct"] = ("safety_overview", arm_key, "serious_ae", saf_version, f1(100 * s["serious_ae"] / s["n"]))
    FIGS[f"{prefix}_disc_pct"] = ("safety_overview", arm_key, "ae_discontinuation", saf_version, f1(100 * s["ae_discontinuation"] / s["n"]))
    FIGS[f"{prefix}_deaths"] = ("safety_overview", arm_key, "deaths", saf_version, str(s["deaths"]))

# (doc_type, section, section_title, seq, template)  -- placeholders are {fig_key}
CSR_T, M27_T, M25_T, LBL_T = ("Primary efficacy endpoint", "Summary of clinical efficacy",
                              "Clinical overview: benefit and risk", "Clinical studies")
SENTENCES = [
    ("csr", "11.4.1", CSR_T, 1, "The primary efficacy endpoint was the proportion of participants who met the responder definition at Week 52, as adjudicated by the blinded Clinical Endpoint Committee."),
    ("csr", "11.4.1", CSR_T, 2, "In the primary analysis, {trt_resp} of {trt_n} participants ({trt_rate}%) in the LMN-4471 arm met the primary endpoint, compared with {pbo_resp} of {pbo_n} ({pbo_rate}%) on placebo, a difference of {diff} percentage points (95% CI {ci_low} to {ci_high})."),
    ("csr", "11.4.1", CSR_T, 3, "About two-thirds of participants in the LMN-4471 arm ({trt_rate}%) had met the responder definition by Week 52, and the response was sustained through the end of the treatment period."),
    ("csr", "11.4.1", CSR_T, 4, "The estimated treatment difference was {diff} percentage points (95% CI {ci_low} to {ci_high}), in favour of LMN-4471 (nominal p < 0.001)."),
    ("csr", "11.4.1", CSR_T, 5, "The primary analysis was repeated in the per-protocol set, and the results were consistent with those in the full analysis set (Table 14.2.2)."),
    ("csr", "11.4.1", CSR_T, 6, "Treatment effects were directionally consistent across the prespecified subgroups of age, sex and region (Figure 14.2.1)."),
    ("m27", "2.7.3", M27_T, 1, "Study LMN-301 was a randomised, double-blind, placebo-controlled, parallel-group Phase III study conducted at 62 sites in 10 countries."),
    ("m27", "2.7.3", M27_T, 2, "Study LMN-301 met its primary endpoint: {trt_rate}% of participants receiving LMN-4471 400 mg once daily were responders at Week 52, compared with {pbo_rate}% receiving placebo (difference {diff} percentage points; 95% CI {ci_low} to {ci_high})."),
    ("m27", "2.7.3", M27_T, 3, "A total of {trt_resp} participants in the LMN-4471 arm were classified as responders at Week 52."),
    ("m27", "2.7.3", M27_T, 4, "Baseline demographic and disease characteristics were balanced between the treatment arms (Table 2.7.3.1)."),
    ("m27", "2.7.3", M27_T, 5, "Secondary endpoints were tested hierarchically and are summarised in Section 2.7.3.3."),
    ("m25", "2.5", M25_T, 1, "The clinical development programme for LMN-4471 comprises one pivotal Phase III study, supported by two Phase II dose-ranging studies."),
    ("m25", "2.5", M25_T, 2, "The treatment effect of LMN-4471 over placebo on the primary endpoint was {diff} percentage points at Week 52, which exceeds the prespecified clinically meaningful margin of 10 percentage points."),
    ("m25", "2.5", M25_T, 3, "Treatment-emergent adverse events (TEAEs) were reported in {trt_any_teae_pct}% of participants receiving LMN-4471 and {pbo_any_teae_pct}% of participants receiving placebo."),
    ("m25", "2.5", M25_T, 4, "Serious TEAEs occurred in {trt_sae_pct}% of participants in the LMN-4471 arm and {pbo_sae_pct}% in the placebo arm."),
    ("m25", "2.5", M25_T, 5, "{trt_deaths} deaths were reported in the LMN-4471 arm and {pbo_deaths} in the placebo arm, none of which the investigator considered related to study treatment."),
    ("label", "14", LBL_T, 1, "The efficacy of LMN-4471 was evaluated in a 52-week, randomised, double-blind, placebo-controlled study (Study LMN-301) in adults with moderate to severe disease."),
    ("label", "14", LBL_T, 2, "In Study LMN-301, {trt_rate}% of patients treated with LMN-4471 achieved response at Week 52 compared with {pbo_rate}% of patients treated with placebo (difference {diff} percentage points; 95% CI {ci_low}, {ci_high})."),
    ("label", "14", LBL_T, 3, "Adverse events of any grade were reported in {trt_any_teae} patients ({trt_any_teae_pct}%) treated with LMN-4471 in Study LMN-301."),
    ("label", "14", LBL_T, 4, "Treatment-emergent adverse events led to discontinuation of study drug in {trt_disc_pct}% of patients treated with LMN-4471 and {pbo_disc_pct}% of patients treated with placebo."),
    ("label", "14", LBL_T, 5, "Serious adverse events were reported in {trt_sae_pct}% of patients treated with LMN-4471 compared with {pbo_sae_pct}% of patients treated with placebo."),
]
import re  # noqa: E402

sent_rows, cit_rows = [], []
certified_by = "Biostatistics"
for doc_type, section, title, seq, template in SENTENCES:
    sid = f"{doc_type}-{section}-{seq:02d}"
    keys = re.findall(r"\{(\w+)\}", template)
    text_prev = template.format(**{k: FIGS[k][4] for k in keys}) if keys else template
    sent_rows.append((sid, doc_type, section, title, seq, template, text_prev))
    for k in dict.fromkeys(keys):
        src, rk, col, ver, val = FIGS[k]
        eff = src == "efficacy_primary"
        cit_rows.append((
            f"cit-{sid}-{k}", sid, k, src, rk, col, ver, val,
            "recompute_figures" if eff else "safety_overview_cell",
            certified_by,
            datetime(2026, 10, 19, 9, 12, 0) if eff else datetime(2026, 10, 12, 14, 30, 0),
        ))

banner("restatement (adeff -> efficacy_primary version 4)")
# choose the 3 treatment responders to flip, deterministically
flip_ids = [r["usubjid"] for r in sql(f"""
  SELECT e.usubjid FROM {FQ}.adeff e JOIN {FQ}.adsl s ON s.usubjid = e.usubjid
  WHERE s.arm = 'LMN-4471 400 mg' AND e.aval = 1 ORDER BY md5(e.usubjid) LIMIT {N_FLIP}""").collect()]
print("subjects adjudicated to non-responder:", flip_ids)
ids = ", ".join(f"'{i}'" for i in flip_ids)
sql(f"UPDATE {FQ}.adeff SET aval = 0, adjudicated_at = TIMESTAMP '{RESTATED_AT}' WHERE usubjid IN ({ids})")
(spark.sql(EFF_SELECT).write.format("delta").mode("overwrite")
    .option("userMetadata", json.dumps(RESTATED_META, separators=(",", ":")))
    .insertInto(f"{FQ}.efficacy_primary", overwrite=True))  # version 4

hist = sql(f"SELECT version, operation, userMetadata, timestamp FROM (DESCRIBE HISTORY {FQ}.efficacy_primary) ORDER BY version").collect()
for h in hist:
    print(h["version"], h["operation"], h["userMetadata"], h["timestamp"])
assert [h["version"] for h in hist] == [0, 1, 2, 3, 4], "efficacy_primary must have exactly versions 0..4"

# --------------------------------------------------------------------------------------
# 4. Sentences, citations, sign-offs, wording checks
# --------------------------------------------------------------------------------------
banner("document_sentences / figure_citations / review_signoffs / wording_checks")
sent_schema = StructType([StructField(n, StringType() if n not in ("seq",) else IntegerType())
                          for n in ["sentence_id", "doc_type", "section", "section_title", "seq", "template", "text_v_prev"]])
spark.createDataFrame(sent_rows, sent_schema).write.mode("overwrite").saveAsTable(f"{FQ}.document_sentences")
cit_schema = StructType([
    StructField("citation_id", StringType()), StructField("sentence_id", StringType()),
    StructField("fig_key", StringType()), StructField("source_table", StringType()),
    StructField("row_key", StringType()), StructField("column_name", StringType()),
    StructField("table_version", LongType()), StructField("value_text", StringType()),
    StructField("query_key", StringType()), StructField("certified_by", StringType()),
    StructField("certified_at", TimestampType()),
])
spark.createDataFrame(cit_rows, cit_schema).write.mode("overwrite").saveAsTable(f"{FQ}.figure_citations")
sql(f"""CREATE TABLE {FQ}.review_signoffs (
  signoff_id STRING, sentence_id STRING, action STRING COMMENT 'approved, sent_to_labelling or sent_to_writer',
  reviewer STRING, table_version BIGINT, signed_at TIMESTAMP)""")
sql(f"""CREATE TABLE {FQ}.wording_checks (
  sentence_id STRING, table_version BIGINT, verdict STRING COMMENT 'ok or needs_writer', reason STRING,
  model STRING, trace_id STRING, checked_at TIMESTAMP)""")
sql(f"COMMENT ON TABLE {FQ}.document_sentences IS 'Sentences of the synthetic LMN-301 dossier (CSR, Module 2.7.3, Module 2.5, label). template holds {{fig_key}} placeholders; text_v_prev is the text rendered with table version 3 values.'")
sql(f"COMMENT ON TABLE {FQ}.figure_citations IS 'One row per figure in a sentence: the certified table cell, the table version it was written against and its value then.'")
sql(f"COMMENT ON TABLE {FQ}.review_signoffs IS 'Named reviewer sign-offs written by the rnd-regsub-review app.'")
sql(f"COMMENT ON TABLE {FQ}.wording_checks IS 'Cached results of the model wording check per sentence and table version. Read as the fallback when the live call is slow.'")
for t in ["document_sentences", "figure_citations", "review_signoffs", "wording_checks"]:
    sql(f"ALTER TABLE {FQ}.{t} SET TAGS ('sz_domain' = 'rnd', 'sz_project' = 'regsub_review', 'asset_class' = 'app')")

banner("row counts")
for t in ["adsl", "adeff", "efficacy_primary", "safety_overview", "document_sentences",
          "figure_citations", "wording_checks", "review_signoffs"]:
    print(f"{t:20s}", sql(f"SELECT COUNT(*) FROM {FQ}.{t}").first()[0])
print("\nefficacy_primary current:")
sql(f"SELECT * FROM {FQ}.efficacy_primary ORDER BY row_key").show(truncate=False)
print("done")
