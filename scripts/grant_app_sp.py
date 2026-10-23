"""Grant the deployed app's service principal what the routes need (run after the first deploy).

    uv run --python 3.12 --with databricks-sql-connector python scripts/grant_app_sp.py <app-service-principal-client-id>

Unity Catalog: read the schema, write the run, score and sign-off tables, read the volumes, EXECUTE on the Unity Gateway
model service sean_zhang_catalog.rnd_csr_pod.csr_author. The warehouse and the judge endpoint come from the app
resources in databricks.yml. The AI Search index is readable with SELECT on the schema; if the app cannot query it,
grant the service principal CAN_USE on the endpoint sz-shared-vs in the UI.
"""
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402

sp = sys.argv[1]
q = dbx.runner()
fq = dbx.FQ
for stmt in [
    f"GRANT USE CATALOG ON CATALOG {dbx.CATALOG} TO `{sp}`",
    f"GRANT USE SCHEMA ON SCHEMA {fq} TO `{sp}`",
    f"GRANT SELECT ON SCHEMA {fq} TO `{sp}`",
    *[f"GRANT MODIFY ON TABLE {fq}.{t} TO `{sp}`" for t in ("csr_runs", "csr_sections", "csr_figure_citations", "csr_signoffs", "csr_scores", "tlf_14_5_01_teae", "demo_state")],
    f"GRANT READ VOLUME ON VOLUME {fq}.source_docs TO `{sp}`",
    f"GRANT READ VOLUME ON VOLUME {fq}.parsed_pages TO `{sp}`",
]:
    q(stmt)
    print("ok:", stmt)
# EXECUTE on the model service (an AI Gateway securable): set through the permissions API
r = subprocess.run(
    ["databricks", "grants", "update", "model_service", f"{fq}.csr_author", "--json", f'{{"changes":[{{"principal":"{sp}","add":["EXECUTE"]}}]}}', "--profile", dbx.PROFILE],
    capture_output=True, text=True,
)
print("EXECUTE on model service:", (r.stdout or r.stderr).strip()[:300])
