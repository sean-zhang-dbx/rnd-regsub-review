"""Grant the deployed app's service principal what the routes need (run after the first deploy).

    uv run --python 3.12 --with databricks-sql-connector python scripts/grant_app_sp.py <app-service-principal-client-id>

Covers the Unity Catalog data side (read the schema, write sign-offs and wording checks, read the
volume and the AI Search index). The service principal also needs EXECUTE on the Unity Gateway model
service sean_zhang_catalog.rnd_regsub_review.wording_check (grant it in Catalog Explorer, tab
Permissions); the Genie Agent and the MLflow experiment are granted by the app resources in
databricks.yml.
"""
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
    f"GRANT MODIFY ON TABLE {fq}.review_signoffs TO `{sp}`",
    f"GRANT MODIFY ON TABLE {fq}.wording_checks TO `{sp}`",
    f"GRANT READ VOLUME ON VOLUME {fq}.source_docs TO `{sp}`",
]:
    q(stmt)
    print("ok:", stmt)
