"""Shared Databricks helpers for the rnd_csr_pod backend scripts (profile fe-vm-sean-zhang)."""
import json
import os
import subprocess

PROFILE = os.environ.get("CSRPOD_PROFILE", "fe-vm-sean-zhang")
HOST = os.environ.get("CSRPOD_HOST", "https://fevm-sean-zhang.cloud.databricks.com")
WAREHOUSE_ID = os.environ.get("CSRPOD_WAREHOUSE_ID", "16ad82bead3f55b5")
CATALOG = "sean_zhang_catalog"
SCHEMA = "rnd_csr_pod"
FQ = f"{CATALOG}.{SCHEMA}"
TAGS = "'sz_domain'='rnd','sz_project'='csr_pod','asset_class'='app'"
SOURCE_NOTE = "Source: CDISC SDTM/ADaM Pilot Project (CDISCPILOT01), used under the CDISC terms of use."
VOL_SRC = f"/Volumes/{CATALOG}/{SCHEMA}/source_docs"
VOL_PAGES = f"/Volumes/{CATALOG}/{SCHEMA}/parsed_pages"


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
    """q(sql) -> list of Row (or None when the statement has no result set)."""
    conn = conn or connect()
    cur = conn.cursor()

    def q(statement: str):
        cur.execute(statement)
        try:
            return cur.fetchall()
        except Exception:
            return None

    return q


def esc(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


def fs_cp(src: str, dest: str) -> None:
    parent = dest.rsplit("/", 1)[0]
    subprocess.run(["databricks", "fs", "mkdir", "dbfs:" + parent, "--profile", PROFILE], capture_output=True)
    subprocess.run(["databricks", "fs", "cp", src, "dbfs:" + dest, "--overwrite", "--profile", PROFILE],
                   check=True, capture_output=True)
