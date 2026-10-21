"""Reset the demo to its starting state: delete all rows from review_signoffs and csr_signoffs.

    uv run --python 3.12 --with databricks-sql-connector python scripts/reset_demo.py

Does not touch wording_checks (the cached fallback), csr_runs or csr_sections (the pre-run
CSR document must survive a reset) or any other table.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402

q = dbx.runner()
q(f"DELETE FROM {dbx.FQ}.review_signoffs")
q(f"DELETE FROM {dbx.FQ}.csr_signoffs")
print("review_signoffs rows:", q(f"SELECT COUNT(*) AS n FROM {dbx.FQ}.review_signoffs")[0]["n"])
print("csr_signoffs rows:", q(f"SELECT COUNT(*) AS n FROM {dbx.FQ}.csr_signoffs")[0]["n"])
