"""Compare every in-scope cell of our TLF tables with the printed value in the submitted section 14 tables.

    uv run --python 3.12 --with databricks-sql-connector python scripts/check_tlfs.py [--detail]

Reads submitted_tlf_cells (printed values as printed) and the tlf_* tables; compares at the printed precision
(round half up). Table 14-5.01 is checked twice: at its current Delta version, and as the version 2 rule
(TRTEMFL = 'Y') built into a scratch table that is dropped again, so the table itself is not touched.
Prints the match report: cells matched, cells that differ, printed cells with no cell of ours, our cells with no
printed counterpart. This implements must-be-true 2 and 3. Printed values are never edited.
"""
import sys
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402
import tlf_build  # noqa: E402
import tlf_defs as D  # noqa: E402

FQ = dbx.FQ


def dec(s):
    return Decimal(s)


def compare(printed: str, ours):
    """Return 'match', 'threshold' (printed as <x), 'differs' or 'missing'."""
    if ours is None:
        return "missing"
    p = printed.strip()
    if p.startswith("<") or p.startswith(">"):
        # threshold display such as <1% or <.0001: ours must fall under the threshold
        try:
            thr = float(p[1:].lstrip("=") or 0) if p[1:2] != "." else float("0" + p[1:])
        except ValueError:
            return "differs"
        o = float(ours)
        ok = (o < thr) if p.startswith("<") else (o > thr)
        return "threshold" if ok else "differs"
    d = len(p.split(".")[1]) if "." in p else 0
    o = Decimal(repr(float(ours))).quantize(Decimal(1).scaleb(-d), rounding=ROUND_HALF_UP)
    return "match" if o == dec(p) else "differs"


def load_ours(q, table):
    cols = [c for c, _ in D.TABLES[table]["cols"]]
    rows = q(f"SELECT row_key, {', '.join(cols)} FROM {table}")
    return {(r[0], c): r[1 + i] for r in rows for i, c in enumerate(cols)}


def check(q, table, ours, printed, detail):
    res = {"match": 0, "threshold": 0, "differs": [], "missing": []}
    for key, col, val, page in printed:
        o = ours.get((key, col))
        r = compare(val, o)
        if r in ("match", "threshold"):
            res[r] += 1
        else:
            res[r].append((key, col, val, o, page))
    printed_keys = {(k, c) for k, c, _, _ in printed}
    unprinted = [k for k, v in ours.items() if v is not None and k not in printed_keys]
    return res, unprinted


def main(detail):
    q = dbx.runner()
    # scratch copy of 14-5.01 under the correct rule (version 2); the real table is not touched
    q(f"DROP TABLE IF EXISTS {FQ}.tlf_14_5_01_teae_check_v2")
    q(f"CREATE TABLE {FQ}.tlf_14_5_01_teae_check_v2 AS " + tlf_build.ae_sql("v2", False))
    total = {"match": 0, "threshold": 0, "differs": 0, "missing": 0}
    print("TLF match report (printed precision, round half up)")
    print(f"{'table':32s} {'printed':>8s} {'match':>7s} {'<thr':>5s} {'differs':>8s} {'missing':>8s} {'ours without printed':>21s}")
    reports = {}
    runs = [(t, t, FQ + "." + t) for t in D.TABLES]
    runs.append(("tlf_14_5_01_teae (version 2 rule)", D.T1408, FQ + ".tlf_14_5_01_teae_check_v2"))
    for label, table, src in runs:
        printed = q(f"SELECT row_key, column_name, printed_value, page FROM {FQ}.submitted_tlf_cells WHERE tlf = '{table}'")
        printed = [(r[0], r[1], r[2], r[3]) for r in printed]
        cols = [c for c, _ in D.TABLES[table]["cols"]]
        rows = q(f"SELECT row_key, {', '.join(cols)} FROM {src}")
        ours = {(r[0], c): r[1 + i] for r in rows for i, c in enumerate(cols)}
        res, unprinted = check(q, table, ours, printed, detail)
        reports[label] = (res, unprinted)
        print(f"{label:32s} {len(printed):8d} {res['match']:7d} {res['threshold']:5d} {len(res['differs']):8d} {len(res['missing']):8d} {len(unprinted):21d}")
        if label.startswith("tlf_14_5_01_teae") and "version 2" not in label:
            continue  # current-version row of 14-5.01 is the demo's version 1, reported separately below
        for k in total:
            total[k] += res[k] if isinstance(res[k], int) else len(res[k])
    print("TOTAL (14-5.01 counted at version 2):", total)
    # must-be-true 3: version 1 differs from print in at least 3 cells
    v1 = reports["tlf_14_5_01_teae"][0]
    v2 = reports["tlf_14_5_01_teae (version 2 rule)"][0]
    print(f"14-5.01 current table (version 1 rule): {len(v1['differs'])} printed cells differ; version 2 rule: {len(v2['differs'])} differ, {len(v2['missing'])} missing")
    q(f"DROP TABLE IF EXISTS {FQ}.tlf_14_5_01_teae_check_v2")
    for label, (res, unprinted) in reports.items():
        if label == "tlf_14_5_01_teae":
            continue
        if res["differs"] or res["missing"]:
            print(f"\n{label}: cells that differ or are missing ({'all' if detail else 'first 25'})")
            for key, col, val, o, page in (res["differs"] + res["missing"])[: (10**6 if detail else 25)]:
                print(f"   p{page} {key}.{col}: printed {val}, ours {o}")
    return reports


if __name__ == "__main__":
    main("--detail" in sys.argv)
