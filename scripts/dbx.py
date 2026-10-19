"""Shared Databricks helpers for the rnd_regsub_review backend scripts.

Uses the fe-vm-sean-zhang CLI profile. Two profiles share this host, so the token is
fetched with an explicit --profile instead of through the SDK's CLI credential strategy.
"""
import json
import subprocess

PROFILE = "fe-vm-sean-zhang"
HOST = "https://fevm-sean-zhang.cloud.databricks.com"
WAREHOUSE_ID = "16ad82bead3f55b5"
CATALOG = "sean_zhang_catalog"
SCHEMA = "rnd_regsub_review"
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
