"""Put the demo back to its opening state.

    uv run --python 3.12 --with databricks-sql-connector python scripts/reset_demo.py

1. Delete all rows of csr_signoffs.
2. If tlf_14_5_01_teae was re-delivered (its content differs from version 1), RESTORE TABLE to the Delta version of
   the first state (recorded in demo_state by scripts/tlf_build.py). Restore adds a new Delta version with the old content.
3. Mark every run after the pre-run as superseded, so the pre-run is the latest done run. The pre-run is the
   latest done run bound to the version 1 state of 14-5.01 (recorded in demo_state as 'preRun').
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402

FQ = dbx.FQ
q = dbx.runner()
q(f"DELETE FROM {FQ}.csr_signoffs")
v1 = int(q(f"SELECT state_value FROM {FQ}.demo_state WHERE state_key = 'teae_v1_delta_version'")[0][0])
cur = int(q(f"SELECT max(version) FROM (DESCRIBE HISTORY {FQ}.tlf_14_5_01_teae)")[0][0])
if cur != v1:
    same = q(f"SELECT count(*) FROM (SELECT * FROM {FQ}.tlf_14_5_01_teae EXCEPT SELECT * FROM {FQ}.tlf_14_5_01_teae VERSION AS OF {v1})")[0][0]
    rev = q(f"SELECT count(*) FROM (SELECT * FROM {FQ}.tlf_14_5_01_teae VERSION AS OF {v1} EXCEPT SELECT * FROM {FQ}.tlf_14_5_01_teae)")[0][0]
    if same or rev:
        q(f"RESTORE TABLE {FQ}.tlf_14_5_01_teae TO VERSION AS OF {v1}")
        print(f"restored tlf_14_5_01_teae to Delta version {v1} (was {cur})")
        # The restored content is release 1 again; the app labels Delta versions by release (server/lib/dbx.ts).
        new = int(q(f"SELECT max(version) FROM (DESCRIBE HISTORY {FQ}.tlf_14_5_01_teae)")[0][0])
        q(f"DELETE FROM {FQ}.demo_state WHERE state_key = 'teae_release@{new}'")
        q(f"INSERT INTO {FQ}.demo_state VALUES ('teae_release@{new}', '1')")
    else:
        print(f"tlf_14_5_01_teae already has the content of version {v1}")
pre = q(f"SELECT state_value FROM {FQ}.demo_state WHERE state_key = 'preRun'")
if pre:
    pre_id = pre[0][0]
    q(f"UPDATE {FQ}.csr_runs SET superseded = true WHERE run_id <> '{pre_id}' AND started_at > (SELECT started_at FROM {FQ}.csr_runs WHERE run_id = '{pre_id}')")
    q(f"UPDATE {FQ}.csr_runs SET superseded = false WHERE run_id = '{pre_id}'")
    print("pre-run:", pre_id)
else:
    print("no preRun recorded in demo_state; no runs superseded")
print("csr_signoffs rows:", q(f"SELECT count(*) FROM {FQ}.csr_signoffs")[0][0])
print("latest done run:", q(f"SELECT run_id FROM {FQ}.csr_runs WHERE status = 'done' AND coalesce(superseded,false) = false ORDER BY finished_at DESC LIMIT 1"))
print("14-5.01 version:", q(f"SELECT max(version) FROM (DESCRIBE HISTORY {FQ}.tlf_14_5_01_teae)")[0][0])
