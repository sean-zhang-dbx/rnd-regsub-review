"""Build the 8 certified TLF tables from the adam_* tables (Lakeflow Job "CSR Pod: TLF build").

    uv run --python 3.12 --with databricks-sql-connector --with pandas --with numpy --with scipy --with statsmodels \
        python scripts/tlf_build.py [--teae-rule v1|v2]

Descriptive statistics, counts and the adverse event tables are INSERT ... SELECT from the adam_* tables, so Unity
Catalog lineage exists. The model-based rows (ANCOVA for 14-3.01, ANOVA for 14-3.02, the p values of 14-2.01) are
computed with statsmodels and scipy following the SAP (Appendix 9, sections 8.x): ANCOVA with treatment and pooled
site as factors and the baseline score as covariate, treatment as a continuous variable (dose) for the dose
response test, pairwise comparisons with treatment as a categorical variable, unadjusted.

Table 14-5.01 is built at version 1 with the demo error (all ADAE records, TRTEMFL ignored) when --teae-rule v1
(the default), and at the correct rule (TRTEMFL = 'Y') when --teae-rule v2. config/redeliver_14_5_01.sql holds the
version 2 statement the app runs for the re-delivery. Each table is created with its comments, then filled with one
INSERT, so the Delta version of the first complete state is 1.

Runs outside Databricks through the SQL connector, and inside a Lakeflow Job through the Spark session.
"""
import math
import os
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import tlf_defs as D  # noqa: E402

CATALOG, SCHEMA = "sean_zhang_catalog", "rnd_csr_pod"
FQ = f"{CATALOG}.{SCHEMA}"
NOTE = "Source: CDISC SDTM/ADaM Pilot Project (CDISCPILOT01), used under the CDISC terms of use."
TAGS = "'sz_domain'='rnd','sz_project'='csr_pod','asset_class'='app'"
ARM_NAME = dict(D.ARMS)
ARMS3 = [a for a, _ in D.ARMS]


# ------------------------------------------------------------------ runner
def get_runner():
    if "DATABRICKS_RUNTIME_VERSION" in os.environ:
        from pyspark.sql import SparkSession

        spark = SparkSession.builder.getOrCreate()

        def q(sql):
            df = spark.sql(sql)
            try:
                return [tuple(r) for r in df.collect()]
            except Exception:
                return None

        return q
    import dbx

    run = dbx.runner()

    def q(sql):
        rows = run(sql)
        return None if rows is None else [tuple(r) for r in rows]

    return q


def rnd(expr, d):
    """Round half up after taking the value to 10 decimals (SAS formats from the stored 15 digits, not the binary tail)."""
    return f"round(CAST({expr} AS DECIMAL(38,10)), {d})"


def esc(s):
    return str(s).replace("\\", "\\\\").replace("'", "\\'")


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, str):
        return f"'{esc(v)}'"
    return repr(float(v)) if isinstance(v, float) else str(v)


def half_up(x, d):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    return float(Decimal(repr(float(x))).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP))


# ------------------------------------------------------------------ table creation
COL_COMMENT = {"pbo": "Placebo (N=86)", "low": "Xanomeline Low Dose (N=84)", "high": "Xanomeline High Dose (N=84)",
               "total": "All treatment groups", "p_value": "p value of the comparison named in the row"}


def col_comment(name):
    if name in COL_COMMENT:
        return COL_COMMENT[name]
    pfx, _, suf = name.rpartition("_")
    arm = {"pbo": "Placebo", "low": "Xanomeline Low Dose", "high": "Xanomeline High Dose", "total": "All treatment groups"}[pfx]
    return f"{arm}: " + ("number of subjects" if suf == "n" else "percentage of subjects")


def create_table(q, table, cols, title, tlf, extra_comment="", noslot=()):
    ddl = ["row_key STRING COMMENT 'Row key'", "row_label STRING COMMENT 'Row label'", "row_order INT COMMENT 'Order of the row in the table'"]
    for name, typ in cols:
        cm = col_comment(name) + (" (not printed in the submitted table) [no-slot]" if name in noslot else "")
        ddl.append(f"{name} {typ} COMMENT '{esc(cm)}'")
    comment = f"CERTIFIED by Biostatistics. Table {tlf} {title}.{extra_comment} {NOTE}"
    q(f"DROP TABLE IF EXISTS {FQ}.{table}")  # a fresh Delta history: the first complete state of every table is version 1
    q(f"CREATE TABLE {FQ}.{table} ({', '.join(ddl)}) COMMENT '{esc(comment)}'")


def finish_table(q, table):
    q(f"ALTER TABLE {FQ}.{table} SET TAGS ({TAGS},'system.certification_status'='certified')")


def sel(key, label, order, vals):
    return f"SELECT '{esc(key)}' AS row_key, '{esc(label)}' AS row_label, {order} AS row_order, " + ", ".join(vals)


def insert(q, table, selects):
    q(f"INSERT INTO {FQ}.{table} " + "\nUNION ALL\n".join(selects))


# ------------------------------------------------------------------ 14-1.01, 14-1.02
def agg_arm(arm_col, cond, expr="1"):
    """Per arm and total: number of rows meeting cond."""
    out = []
    for a in ARMS3:
        out.append(f"CAST(count({expr}) FILTER (WHERE {arm_col} = '{ARM_NAME[a]}' AND ({cond})) AS INT)")
    out.append(f"CAST(count({expr}) FILTER (WHERE ({cond})) AS INT)")
    return out


def build_1401(q):
    conds = dict(itt="ITTFL = 'Y'", safety="SAFFL = 'Y'", efficacy="EFFFL = 'Y'", complete_week_24="COMP24FL = 'Y'", complete_study="DCDECOD = 'COMPLETED'")
    create_table(q, D.T1401, D.COLS_1401, "Summary of populations", "14-1.01")
    sels = []
    for i, r in enumerate(D.ROWS_1401):
        vals = agg_arm("TRT01P", conds[r["key"]])
        sels.append(sel(r["key"], r["label"], i + 1, vals) + f" FROM {FQ}.adam_adsl")
    insert(q, D.T1401, sels)
    finish_table(q, D.T1401)


def npct(arm_col, cond, denom_cond="1=1", dec=0):
    """n and percentage per arm and total, percentages of all subjects of the arm."""
    out = []
    for a in ARMS3:
        arm = f"{arm_col} = '{ARM_NAME[a]}'"
        n = f"count(*) FILTER (WHERE {arm} AND ({cond}))"
        out += [f"CAST({n} AS INT)", f"{rnd("100.0 * " + n + " / count(*) FILTER (WHERE " + arm + " AND (" + denom_cond + "))", dec)}"]
    n = f"count(*) FILTER (WHERE ({cond}))"
    out += [f"CAST({n} AS INT)", f"{rnd("100.0 * " + n + " / count(*) FILTER (WHERE (" + denom_cond + "))", dec)}"]
    return out


def build_1402(q):
    et = "COMP24FL = 'N'"
    conds = dict(
        completed_week_24="COMP24FL = 'Y'", early_termination=et, status_missing="COMP24FL IS NULL OR COMP24FL NOT IN ('Y','N')",
        reason_adverse_event=f"{et} AND DCDECOD = 'ADVERSE EVENT'", reason_death=f"{et} AND DCDECOD = 'DEATH'",
        reason_lack_of_efficacy=f"{et} AND DCDECOD = 'LACK OF EFFICACY'", reason_lost_to_followup=f"{et} AND DCDECOD = 'LOST TO FOLLOW-UP'",
        reason_subject_withdrew=f"{et} AND DCDECOD = 'WITHDRAWAL BY SUBJECT'", reason_physician_withdrew=f"{et} AND DCDECOD = 'PHYSICIAN DECISION'",
        reason_protocol_criteria=f"{et} AND DCDECOD = 'PROTOCOL VIOLATION' AND DCREASCD = 'I/E Not Met'",
        reason_protocol_violation=f"{et} AND DCDECOD = 'PROTOCOL VIOLATION' AND DCREASCD = 'Protocol Violation'",
        reason_sponsor_decision=f"{et} AND DCDECOD = 'STUDY TERMINATED BY SPONSOR'",
        reason_missing=f"{et} AND (DCDECOD IS NULL OR trim(DCDECOD) = '')",
    )
    create_table(q, D.T1402, D.COLS_1402, "Summary of end of study data", "14-1.02")
    sels = [sel(r["key"], r["label"], i + 1, npct("TRT01P", conds[r["key"]])) + f" FROM {FQ}.adam_adsl" for i, r in enumerate(D.ROWS_1402)]
    insert(q, D.T1402, sels)
    finish_table(q, D.T1402)


# ------------------------------------------------------------------ 14-2.01 (descriptive in SQL, p values below)
def cont_stats(col, arm_cond):
    f = f"FILTER (WHERE {arm_cond} AND {col} IS NOT NULL)"
    return dict(
        n=f"CAST(count({col}) FILTER (WHERE {arm_cond}) AS DOUBLE)",
        mean=rnd(f"avg({col}) {f}", 1), sd=rnd(f"stddev_samp({col}) {f}", 2),
        median=rnd(f"percentile({col}, 0.5) {f}", 1), min=rnd(f"min({col}) {f}", 1), max=rnd(f"max({col}) {f}", 1),
    )


DEMO_CAT = {
    "age_lt65": "AGEGR1 = '<65'", "age_65_to_80": "AGEGR1 = '65-80'", "age_gt80": "AGEGR1 = '>80'",
    "sex_male": "SEX = 'M'", "sex_female": "SEX = 'F'",
    "race_caucasian": "ETHNIC <> 'HISPANIC OR LATINO' AND RACE = 'WHITE'",
    "race_african_descent": "ETHNIC <> 'HISPANIC OR LATINO' AND RACE = 'BLACK OR AFRICAN AMERICAN'",
    "race_hispanic": "ETHNIC = 'HISPANIC OR LATINO'",
    "race_other": "ETHNIC <> 'HISPANIC OR LATINO' AND RACE NOT IN ('WHITE','BLACK OR AFRICAN AMERICAN')",
    "duration_lt12": "DURDSGR1 = '<12'", "duration_ge12": "DURDSGR1 = '>=12'",
    "bmi_lt25": "BMIBLGR1 = '<25'", "bmi_25_to_lt30": "BMIBLGR1 = '25-<30'", "bmi_ge30": "BMIBLGR1 = '>=30'",
}
CAT_N_COL = {"sex": "SEX", "race": "RACE"}


def build_1403(q):
    create_table(q, D.T1403, D.COLS_1403, "Summary of demographic and baseline characteristics", "14-2.01", " Intent-to-treat population.")
    contcol = {c[0]: c[3] for c in D.CONT_VARS}
    sels = []
    for i, r in enumerate(D.ROWS_1403):
        k = r["key"]
        vals = []
        if k in DEMO_CAT:
            vals = npct("TRT01P", DEMO_CAT[k])
        elif k in ("sex_n", "race_n"):
            col = CAT_N_COL[k.split("_")[0]]
            for a in ARMS3:
                vals += [cont_stats(col, f"TRT01P = '{ARM_NAME[a]}'")["n"], "NULL"]
            vals += [cont_stats(col, "1=1")["n"], "NULL"]
        else:
            var, _, stat = k.rpartition("_")
            col = contcol[var]
            for a in ARMS3:
                vals += [cont_stats(col, f"TRT01P = '{ARM_NAME[a]}'")[stat], "NULL"]
            vals += [cont_stats(col, "1=1")[stat], "NULL"]
        vals.append("CAST(NULL AS DOUBLE)")  # p_value
        # column order of COLS_1403: pbo, pbo_pct, low, low_pct, high, high_pct, total, total_pct, p_value
        sels.append(sel(k, r["label"], i + 1, vals) + f" FROM {FQ}.adam_adsl")
    # INT n columns are DOUBLE in this table (mixed counts and means), the cast above keeps them as printed
    insert(q, D.T1403, sels)
    finish_table(q, D.T1403)


def demo_p_values(q):
    import numpy as np
    import pandas as pd
    from scipy import stats

    df = pd.DataFrame(q(f"SELECT TRT01P, SITEGR1, AGE, SEX, RACE, ETHNIC, MMSETOT, DURDIS, EDUCLVL, WEIGHTBL, HEIGHTBL, BMIBL, AGEGR1, DURDSGR1, BMIBLGR1 FROM {FQ}.adam_adsl"),
                      columns=["trt", "site", "AGE", "SEX", "RACE", "ETHNIC", "MMSETOT", "DURDIS", "EDUCLVL", "WEIGHTBL", "HEIGHTBL", "BMIBL", "AGEGR1", "DURDSGR1", "BMIBLGR1"])
    for c in ["AGE", "MMSETOT", "DURDIS", "EDUCLVL", "WEIGHTBL", "HEIGHTBL", "BMIBL"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    p = {}

    def anova(col):
        groups = [g[col].dropna().values for _, g in df.groupby("trt")]
        return float(stats.f_oneway(*groups).pvalue)

    def chi2(cats):
        tab = pd.crosstab(df["trt"], cats)
        return float(stats.chi2_contingency(tab, correction=False)[1])

    p["age_n"] = anova("AGE")
    p["age_lt65"] = chi2(df["AGEGR1"])
    p["sex_n"] = chi2(df["SEX"])
    race = np.where(df["ETHNIC"] == "HISPANIC OR LATINO", "hispanic", np.where(df["RACE"] == "WHITE", "caucasian", np.where(df["RACE"] == "BLACK OR AFRICAN AMERICAN", "african", "other")))
    p["race_n"] = chi2(pd.Series(race, index=df.index))
    # SAP: baseline MMSE comparison with treatment and site as main effects
    import statsmodels.api as sm
    import statsmodels.formula.api as smf

    m = smf.ols("MMSETOT ~ C(trt) + C(site)", data=df.dropna(subset=["MMSETOT"])).fit()
    p["mmse_n"] = anova("MMSETOT")  # table footnote: ANOVA treatment group comparison
    p["mmse_n_site_adjusted"] = float(sm.stats.anova_lm(m, typ=3).loc["C(trt)", "PR(>F)"])
    p["duration_of_disease_n"] = anova("DURDIS")
    p["duration_lt12"] = chi2(df["DURDSGR1"])
    p["education_n"] = anova("EDUCLVL")
    p["weight_n"] = anova("WEIGHTBL")
    p["height_n"] = anova("HEIGHTBL")
    p["bmi_n"] = anova("BMIBL")
    p["bmi_lt25"] = chi2(df["BMIBLGR1"])
    print("demographic p values:", {k: round(v, 4) for k, v in p.items()})
    p.pop("mmse_n_site_adjusted")
    for k, v in p.items():
        q(f"UPDATE {FQ}.{D.T1403} SET p_value = {half_up(v, 4)} WHERE row_key = '{k}'")
    return p


# ------------------------------------------------------------------ 14-3.01 / 14-3.02
def eff_dataset_sql(paramcd, table, with_base):
    base = (f"JOIN {FQ}.{table} b ON b.USUBJID = s.USUBJID AND b.PARAMCD = '{paramcd}' AND b.ABLFL = 'Y'" if with_base else "")
    cols = "b.AVAL AS base, w.AVAL AS wk24, w.CHG AS chg" if with_base else "CAST(NULL AS DOUBLE) AS base, w.AVAL AS wk24, CAST(NULL AS DOUBLE) AS chg"
    return (f"SELECT s.USUBJID, s.TRT01P AS trt, s.TRT01PN AS dose, s.SITEGR1 AS site, {cols} "
            f"FROM {FQ}.adam_adsl s JOIN {FQ}.{table} w ON w.USUBJID = s.USUBJID AND w.PARAMCD = '{paramcd}' AND w.AVISITN = 24 AND w.ANL01FL = 'Y' "
            f"{base} WHERE s.EFFFL = 'Y'")


def eff_desc_selects(src_sql, blocks):
    sels = []
    order = 0
    spec = {"n": lambda c, a: f"CAST(count({c}) FILTER (WHERE {a}) AS DOUBLE)", "mean": lambda c, a: rnd(f"avg({c}) FILTER (WHERE {a})", 1),
            "sd": lambda c, a: rnd(f"stddev_samp({c}) FILTER (WHERE {a})", 2), "median": lambda c, a: rnd(f"percentile({c}, 0.5) FILTER (WHERE {a})", 1),
            "min": lambda c, a: rnd(f"min({c}) FILTER (WHERE {a})", 0), "max": lambda c, a: rnd(f"max({c}) FILTER (WHERE {a})", 0)}
    rows = []
    for bk, col in blocks:
        for st in ["n", "mean", "sd", "median", "min", "max"]:
            order += 1
            key = f"{bk}_{st}"
            label = next(r["label"] for r in (D.ROWS_1404 + D.ROWS_1405) if r["key"] == key)
            vals = [spec[st](col, f"trt = '{ARM_NAME[a]}'") for a in ARMS3] + ["CAST(NULL AS DOUBLE)"]
            rows.append((key, label, order, vals))
    return rows


def model_stats(df, resp, covar_base):
    import statsmodels.formula.api as smf

    d = df.dropna(subset=[resp] + (["base"] if covar_base else [])).copy()
    d["trt"] = d["trt"].astype("category")
    rhs_extra = " + base" if covar_base else ""
    cat = smf.ols(f"{resp} ~ C(trt, Treatment('Placebo')) + C(site){rhs_extra}", data=d).fit()
    dose = smf.ols(f"{resp} ~ dose + C(site){rhs_extra}", data=d).fit()
    low_t, high_t = "C(trt, Treatment('Placebo'))[T.Xanomeline Low Dose]", "C(trt, Treatment('Placebo'))[T.Xanomeline High Dose]"
    ci = cat.conf_int(0.05)
    out = {"p_dose_response": float(dose.pvalues["dose"]), "p_vs_placebo": {}, "diff_vs_placebo": {}, "se_diff_vs_placebo": {}, "ci_low_vs_placebo": {}, "ci_high_vs_placebo": {}}
    for arm, term in (("low", low_t), ("high", high_t)):
        out["p_vs_placebo"][arm] = float(cat.pvalues[term])
        out["diff_vs_placebo"][arm] = float(cat.params[term])
        out["se_diff_vs_placebo"][arm] = float(cat.bse[term])
        out["ci_low_vs_placebo"][arm] = float(ci.loc[term, 0])
        out["ci_high_vs_placebo"][arm] = float(ci.loc[term, 1])
    # contrast high - low via the parameter vector
    import numpy as np

    names = list(cat.params.index)
    c = np.zeros(len(names))
    c[names.index(high_t)] = 1
    c[names.index(low_t)] = -1
    tt = cat.t_test(c)
    lo, hi = tt.conf_int(0.05)[0]
    out.update(p_high_vs_low=float(tt.pvalue), diff_high_vs_low=float(tt.effect[0]), se_diff_high_vs_low=float(tt.sd[0][0]),
               ci_low_high_vs_low=float(lo), ci_high_high_vs_low=float(hi))
    return out


def eff_model_selects(res, rows, start_order):
    sels = []
    order = start_order
    for r in rows:
        k = r["key"]
        if k not in res:
            continue
        order += 1
        v = res[k]
        decs = r["decimals"]
        if isinstance(v, dict):
            vals = [lit(half_up(v[a], decs)) if a in v else "CAST(NULL AS DOUBLE)" for a in ARMS3[:0] + ["pbo", "low", "high"]] + ["CAST(NULL AS DOUBLE)"]
        elif k.startswith("p_"):
            vals = ["CAST(NULL AS DOUBLE)"] * 3 + [lit(half_up(v, decs))]
        else:
            vals = ["CAST(NULL AS DOUBLE)", "CAST(NULL AS DOUBLE)", lit(half_up(v, decs)), "CAST(NULL AS DOUBLE)"]
        sels.append(sel(k, r["label"], order, vals))
    return sels


def build_eff(q, table, rows, tlf, title, paramcd, adtable, with_base, blocks):
    import pandas as pd

    create_table(q, table, D.COLS_EFF, title, tlf, " Efficacy population, LOCF.")
    src = eff_dataset_sql(paramcd, adtable, with_base)
    descr = eff_desc_selects(src, blocks)
    if with_base:
        # baseline, Week 24 and change are all computed in one pass over the analysis set
        pass
    sels = [sel(k, label, order, vals) + f" FROM ({src})" for k, label, order, vals in descr]
    insert(q, table, sels)
    df = pd.DataFrame(q(src), columns=["USUBJID", "trt", "dose", "site", "base", "wk24", "chg"])
    for c in ["dose", "base", "wk24", "chg"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["dose"] = df["dose"].fillna(0.0).where(df["dose"] > 1e-10, 0.0)
    res = model_stats(df, "chg" if with_base else "wk24", with_base)
    model_rows = [r for r in rows if r["key"] in res]
    q_order_start = len(descr)
    # model rows follow the descriptive rows in the printed order
    all_keys = [r["key"] for r in rows]
    for r in model_rows:
        r["_order"] = all_keys.index(r["key"]) + 1
    msels = []
    for r in model_rows:
        msels += eff_model_selects(res, [r], r["_order"] - 1)
    insert(q, table, msels)
    finish_table(q, table)
    return res


# ------------------------------------------------------------------ 14-4.01
def build_1406(q):
    create_table(q, D.T1406, D.COLS_1406, "Summary of planned exposure to study drug, as of end of study", "14-4.01", " Safety population.")
    col = dict(avg_daily_dose="AVGDD", cumulative_dose="CUMDOSE")
    sels = []
    for i, r in enumerate(D.ROWS_1406):
        var, _, st = r["key"].rpartition("_")
        vals = [cont_stats(col[var], f"SAFFL = 'Y' AND TRT01P = '{ARM_NAME[a]}'")[st] for a in ARMS3] + [cont_stats(col[var], "SAFFL = 'Y'")[st]]
        sels.append(sel(r["key"], r["label"], i + 1, vals) + f" FROM {FQ}.adam_adsl")
    insert(q, D.T1406, sels)
    finish_table(q, D.T1406)


# ------------------------------------------------------------------ 14-5.01 / 14-5.02
def ae_sql(rule, serious):
    """One INSERT ... SELECT statement for the adverse event table. rule v1 ignores TRTEMFL (the demo error)."""
    flt = []
    if rule == "v2" or serious:
        flt.append("e.TRTEMFL = 'Y'")
    if serious:
        flt.append("e.AESER = 'Y'")
    where = ("WHERE " + " AND ".join(flt)) if flt else ""
    # subject counts per level (any body system, SOC, PT); denominators are the safety population of each arm
    levels = []
    for lvl, group in (("any", ""), ("soc", "e.AEBODSYS"), ("pt", "e.AEBODSYS, e.AEDECOD")):
        sub = ", ".join(f"CAST(count(distinct e.USUBJID) FILTER (WHERE e.TRTA = '{ARM_NAME[a]}') AS INT) AS {a}_n" for a in ARMS3)
        sub += ", CAST(count(distinct e.USUBJID) AS INT) AS total_n"
        keyexpr = {"any": "'any_body_system'", "soc": "lower(regexp_replace(regexp_replace(e.AEBODSYS, '[^A-Za-z0-9]+', '_'), '^_|_$', ''))",
                   "pt": "concat('pt_', lower(regexp_replace(regexp_replace(e.AEDECOD, '[^A-Za-z0-9]+', '_'), '^_|_$', '')))"}[lvl]
        label = {"any": "'Any body system'", "soc": "initcap(lower(e.AEBODSYS))", "pt": "concat(initcap(lower(e.AEDECOD)), ' (', initcap(lower(e.AEBODSYS)), ')')"}[lvl]
        soc = {"any": "''", "soc": "e.AEBODSYS", "pt": "e.AEBODSYS"}[lvl]
        rank = {"any": "0", "soc": "1", "pt": "2"}[lvl]
        pt = {"any": "''", "soc": "''", "pt": "e.AEDECOD"}[lvl]
        levels.append(
            f"SELECT {keyexpr} AS row_key, {label} AS row_label, {soc} AS soc, {rank} AS lvl, {pt} AS pt, {sub} "
            f"FROM {FQ}.adam_adae e {where} {('GROUP BY ' + group) if group else ''}"
        )
    pct = []
    for a in ARMS3 + ["total"]:
        pct.append(f"u.{a}_n AS {a}_n")
        pct.append(f"round(CAST(100.0 * u.{a}_n / d.{a}_n AS DECIMAL(38,10)), 1) AS {a}_pct")
    denom = (f"(SELECT count(*) FILTER (WHERE TRT01P = 'Placebo') AS pbo_n, count(*) FILTER (WHERE TRT01P = 'Xanomeline Low Dose') AS low_n, "
             f"count(*) FILTER (WHERE TRT01P = 'Xanomeline High Dose') AS high_n, count(*) AS total_n FROM {FQ}.adam_adsl WHERE SAFFL = 'Y') d")
    body = (
        f"SELECT u.row_key, u.row_label, "
        f"CAST(row_number() OVER (ORDER BY u.soc, u.lvl, u.total_n DESC, u.pt) AS INT) AS row_order, "
        + ", ".join(pct)
        + f" FROM (\n" + "\nUNION ALL\n".join(levels) + f"\n) u CROSS JOIN {denom}"
    )
    return body


def teae_insert_statement(rule, overwrite=False):
    head = "INSERT OVERWRITE" if overwrite else "INSERT INTO"
    return f"{head} {FQ}.{D.T1408} " + ae_sql(rule, False)


def write_redeliver_sql():
    p = Path(__file__).parent.parent / "config" / "redeliver_14_5_01.sql"
    p.write_text(
        "-- Table 14-5.01 re-delivered by Biostatistics: version 2.\n"
        "-- Version 1 counted every adverse event record (TRTEMFL ignored, a demo scenario).\n"
        "-- Version 2 counts treatment-emergent events only (ADAE.TRTEMFL = 'Y'), as the SAP says.\n"
        "-- The data (adam_adae) is unchanged; only the derivation rule changes. One statement, one new Delta version.\n"
        + teae_insert_statement("v2", overwrite=True) + "\n"
    )
    return p


def build_ae(q, rule):
    create_table(q, D.T1407, D.COLS_AE, "Incidence of treatment emergent serious adverse events by treatment group", "14-5.02",
                 " Safety population; counts of subjects.", noslot=("total_n", "total_pct"))
    q(f"INSERT INTO {FQ}.{D.T1407} " + ae_sql("v2", True))
    finish_table(q, D.T1407)
    create_table(q, D.T1408, D.COLS_AE, "Incidence of treatment emergent adverse events by treatment group", "14-5.01",
                 " Safety population; counts of subjects.", noslot=("total_n", "total_pct"))
    q(f"INSERT INTO {FQ}.{D.T1408} " + ae_sql(rule, False))
    finish_table(q, D.T1408)


# ------------------------------------------------------------------ formats
def write_formats(q):
    q(f"""CREATE OR REPLACE TABLE {FQ}.tlf_formats (tlf_table STRING, row_key STRING, column_name STRING, decimals INT)
        COMMENT 'Printed precision of every TLF cell (number of decimals), used to show a cell as the submitted table prints it. {NOTE}'""")
    rows = []
    for table, meta in D.TABLES.items():
        cols = [c for c, _ in meta["cols"]]
        keys = []
        if meta["rows"]:
            for r in meta["rows"]:
                keys.append((r["key"], r["decimals"]))
        for k, dec in keys:
            for c in cols:
                d = dec
                if c.endswith("_pct"):
                    d = 0 if table in (D.T1402, D.T1403) else 1
                elif c == "p_value":
                    d = 4 if table == D.T1403 else 3
                elif c.endswith("_n"):
                    d = 0
                rows.append((table, k, c, d))
        if table in (D.T1407, D.T1408):
            for c in cols:
                rows.append((table, "*", c, 0 if c.endswith("_n") else 1))
    vals = [f"('{t}','{esc(k)}','{c}',{d})" for t, k, c, d in rows]
    for i in range(0, len(vals), 200):
        q(f"INSERT INTO {FQ}.tlf_formats VALUES " + ",".join(vals[i:i + 200]))
    q(f"ALTER TABLE {FQ}.tlf_formats SET TAGS ({TAGS})")


def main(rule):
    q = get_runner()
    build_1401(q)
    build_1402(q)
    build_1403(q)
    demo_p_values(q)
    build_eff(q, D.T1404, D.ROWS_1404, "14-3.01", "Primary endpoint analysis: ADAS-Cog (11) change from baseline to Week 24, LOCF", "ACTOT", "adam_adqsadas", True,
              [("baseline", "base"), ("week24", "wk24"), ("change", "chg")])
    build_eff(q, D.T1405, D.ROWS_1405, "14-3.02", "Primary endpoint analysis: CIBIC+ summary at Week 24, LOCF", "CIBICVAL", "adam_adqscibc", False, [("week24", "wk24")])
    build_1406(q)
    build_ae(q, rule)
    write_formats(q)
    write_redeliver_sql()
    # record the Delta version of the first complete state of 14-5.01 for scripts/reset_demo.py
    q(f"CREATE TABLE IF NOT EXISTS {FQ}.demo_state (state_key STRING, state_value STRING) COMMENT 'Opening state of the demo, used by scripts/reset_demo.py'")
    if rule == "v1":
        v = q(f"SELECT max(version) FROM (DESCRIBE HISTORY {FQ}.{D.T1408})")[0][0]
        q(f"DELETE FROM {FQ}.demo_state WHERE state_key = 'teae_v1_delta_version'")
        q(f"INSERT INTO {FQ}.demo_state VALUES ('teae_v1_delta_version', '{v}')")
        print("14-5.01 version 1 is Delta version", v)
    for t in D.TABLES:
        print(t, q(f"SELECT count(*) FROM {FQ}.{t}")[0][0], "rows")


if __name__ == "__main__":
    rule = "v1"
    if "--teae-rule" in sys.argv:
        rule = sys.argv[sys.argv.index("--teae-rule") + 1]
    main(rule)
