"""Shared Databricks helpers for the rnd_regsub_review backend scripts.

Uses the fe-vm-sean-zhang CLI profile. Two profiles share this host, so the token is
fetched with an explicit --profile instead of through the SDK's CLI credential strategy.
"""
import json
import os
import subprocess

# Override with environment variables to run the scripts against another workspace.
PROFILE = os.environ.get("REGSUB_PROFILE", "fe-vm-sean-zhang")
HOST = os.environ.get("REGSUB_HOST", "https://fevm-sean-zhang.cloud.databricks.com")
WAREHOUSE_ID = os.environ.get("REGSUB_WAREHOUSE_ID", "16ad82bead3f55b5")
CATALOG = os.environ.get("REGSUB_CATALOG", "sean_zhang_catalog")
SCHEMA = os.environ.get("REGSUB_SCHEMA", "rnd_regsub_review")
FQ = f"{CATALOG}.{SCHEMA}"


def token() -> str:
    out = subprocess.run(
        ["databricks", "auth", "token", "--profile", PROFILE, "-o", "json"],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)["access_token"]


def connect():
    from databricks import sql

    return sql.connect(
        server_hostname=HOST.replace("https://", ""),
        http_path=f"/sql/1.0/warehouses/{WAREHOUSE_ID}",
        access_token=token(),
    )


def runner(conn=None):
    """Return q(sql) -> list of rows (or None for statements without a result set)."""
    conn = conn or connect()
    cur = conn.cursor()

    def q(statement: str):
        cur.execute(statement)
        try:
            return cur.fetchall()
        except Exception:
            return None

    return q
