"""Print PASS or FAIL for the 9 "must be true" checks of docs/DEMO_PLAN.md (section 4).

    uv run --python 3.12 --with databricks-sql-connector python scripts/check_must_be_true.py

Checks 6, 7 and 8 call the app's own routes, so start the app first (pnpm run dev) or set
APP_URL. Checks 1 to 5 and 9 run SQL on the warehouse; the query files in config/queries are
executed as written, so the check tests exactly what the app shows.
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402

FQ = dbx.FQ
APP = os.environ.get("APP_URL", "http://localhost:8000").rstrip("/")
QDIR = Path(__file__).parent.parent / "config" / "queries"
q = dbx.runner()
results: list[tuple[int, bool, str]] = []


def record(n: int, ok: bool, detail: str) -> None:
    results.append((n, ok, detail))
    print(f"{n}. {'PASS' if ok else 'FAIL'}  {detail}")


def run_file(name: str, **params: str):
    sql = (QDIR / f"{name}.sql").read_text()
    for k, v in params.items():
        sql = sql.replace(f":{k}", "'" + v + "'")
    return q(sql)


def post(path: str, body: dict, timeout: int = 120):
    req = urllib.request.Request(APP + path, data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


# 1 --------------------------------------------------------------------------------
v3 = {r["row_key"]: r for r in q(f"SELECT * FROM {FQ}.efficacy_primary VERSION AS OF 3")}
v4 = {r["row_key"]: r for r in q(f"SELECT * FROM {FQ}.efficacy_primary VERSION AS OF 4")}
ok = (v3["TRT"]["responders"], v3["TRT"]["n"], v4["TRT"]["responders"], v4["TRT"]["n"]) == (412, 618, 409, 618) \
    and (v3["PBO"]["responders"], v3["PBO"]["n"], v4["PBO"]["responders"], v4["PBO"]["n"]) == (287, 609, 287, 609)
record(1, ok, f"TRT v3 {v3['TRT']['responders']}/{v3['TRT']['n']} ({v3['TRT']['rate_pct']:.2f}%), v4 {v4['TRT']['responders']}/{v4['TRT']['n']} ({v4['TRT']['rate_pct']:.2f}%); PBO v3 {v3['PBO']['responders']}/{v3['PBO']['n']}, v4 {v4['PBO']['responders']}/{v4['PBO']['n']}")

# 2, 4 -----------------------------------------------------------------------------
imp = run_file("impact_list")
sents = {}
for r in imp:
    sents[r["sentence_id"]] = (r["doc_type"], r["section"], r["kind"])
by_sec: dict[tuple[str, str], int] = {}
for dt, sec, _ in sents.values():
    by_sec[(dt, sec)] = by_sec.get((dt, sec), 0) + 1
want = {("csr", "11.4.1"): 3, ("m27", "2.7.3"): 2, ("m25", "2.5"): 1, ("label", "14"): 1}
record(2, by_sec == want and len(sents) == 7, f"{len(sents)} affected sentences: {dict(sorted(by_sec.items()))}")

# 3 --------------------------------------------------------------------------------
unch = run_file("unchanged_sentences")
ids_unch = {r["sentence_id"] for r in unch}
record(3, len(ids_unch) == 6 and not (ids_unch & set(sents)) and {r["source_table"] for r in unch} == {"safety_overview"},
       f"{len(ids_unch)} safety-citing sentences unchanged, overlap with affected: {len(ids_unch & set(sents))}")

# 4 --------------------------------------------------------------------------------
tw = [s for s in sents if "two-thirds" in (q(f"SELECT template FROM {FQ}.document_sentences WHERE sentence_id = '{s}'")[0]["template"]).lower()]
lab = [s for s, (dt, _, _) in sents.items() if dt == "label"]
record(4, tw == ["csr-11.4.1-03"] and len(lab) == 1, f"'two-thirds' sentences: {tw}; label sentences: {lab}")

# 5 --------------------------------------------------------------------------------
rec = {r["fig_key"]: (r["value"], r["source_version"]) for r in run_file("recompute_figures")}
exp = {"trt_resp": "409", "trt_n": "618", "trt_rate": "66.2", "diff": "19.1", "ci_low": "13.6", "ci_high": "24.5"}
ok = all(rec.get(k, (None,))[0] == v for k, v in exp.items())
record(5, ok, "recompute_figures " + ", ".join(f"{k}={rec.get(k, ('?',))[0]}" for k in exp) + f" (source version {rec.get('diff', ('', '?'))[1]})")

# 6 --------------------------------------------------------------------------------
try:
    g = post("/api/genie/ask", {"question": "How many participants in the treatment arm met the primary endpoint after the restatement?"})
    txt = (g.get("answer_text", "") + " " + json.dumps(g.get("rows", []))).replace("**", "")
    record(6, "409" in txt and "618" in txt, f"Genie: {g.get('answer_text', '')[:140]!r} rows={g.get('rows')}")
except Exception as e:  # noqa: BLE001
    record(6, False, f"Genie route failed: {e}")

# 7 --------------------------------------------------------------------------------
try:
    ids = sorted(sents)
    runs = []
    for _ in range(3):
        out = post("/api/wording-check", {"sentence_ids": ids})
        runs.append({o["sentence_id"]: (o["verdict"], o["cached"]) for o in out})
    exp7 = {s: ("needs_writer" if s == "csr-11.4.1-03" else "ok") for s in ids}
    ok = all({s: v[0] for s, v in run.items()} == exp7 and not any(v[1] for v in run.values()) for run in runs)
    record(7, ok, "3 live runs, verdicts " + ("stable and as expected" if ok else f"differ: {runs}"))
except Exception as e:  # noqa: BLE001
    record(7, False, f"Wording-check route failed: {e}")

# 8 --------------------------------------------------------------------------------
try:
    old = sorted({r["old_value"] for r in imp})
    hits = post("/api/search-untracked", {"old_values": old})
    docs = sorted({h["doc_title"] for h in hits})
    ok = docs == ["Advisory briefing book (draft)", "Investigator's Brochure v7"]
    record(8, ok, f"documents in results: {docs} (pages {[(h['doc_title'][:12], h['page']) for h in hits]})")
except Exception as e:  # noqa: BLE001
    record(8, False, f"search route failed: {e}")

# 9 --------------------------------------------------------------------------------
hist = q(f"SELECT version, userMetadata FROM (DESCRIBE HISTORY {FQ}.efficacy_primary) ORDER BY version")
versions = [h["version"] for h in hist]
meta = json.loads(hist[-1]["userMetadata"] or "{}")
flipped = q(f"SELECT COUNT(*) AS n FROM {FQ}.adeff WHERE adjudicated_at = TIMESTAMP '2026-10-19 09:12:00'")[0]["n"]
summ = run_file("restatement_summary")[0]
ok = (versions == [0, 1, 2, 3, 4] and meta.get("restated_at") == "2026-10-19T09:12:00Z" and meta.get("restated_by") == "Biostatistics"
      and flipped == 3 and summ["prev_version"] == 3 and summ["curr_version"] == 4 and summ["restated_by"] == "Biostatistics"
      and summ["restated_at"].strftime("%Y-%m-%d %H:%M") == "2026-10-19 09:12")
record(9, ok, f"versions {versions}; v4 userMetadata {meta}; adeff rows adjudicated 19 Oct 09:12: {flipped}; restatement_summary {summ['prev_version']}->{summ['curr_version']} at {summ['restated_at']} by {summ['restated_by']}, changed_cells={summ['changed_cells']}")

print("\n" + ("ALL 9 PASS" if all(ok for _, ok, _ in results) and len(results) == 9 else "SOME CHECKS FAILED"))
sys.exit(0 if all(ok for _, ok, _ in results) else 1)
