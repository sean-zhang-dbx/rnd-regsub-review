"""Parse the PDFs in volume source_docs into doc_chunks and create the AI Search index.

    uv run --python 3.12 --with "databricks-connect>=16.4,<17.4" --with pandas python scripts/build_search.py

1. ai_parse_document over every PDF in the volume.
2. Chunk per page (title, section header and text elements, max ~900 characters per chunk).
3. Write doc_chunks with Change Data Feed on.
4. Create the Delta Sync index doc_chunks_index on the EXISTING endpoint sz-shared-vs
   (managed embeddings, databricks-gte-large-en) and wait until it is online.
"""
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402

from databricks.connect import DatabricksSession  # noqa: E402

FQ = dbx.FQ
ENDPOINT = "sz-shared-vs"
INDEX = f"{FQ}.doc_chunks_index"
TITLES = {
    "LMN-301_Protocol_v3.pdf": "LMN-301 Protocol v3",
    "LMN-301_SAP_v2.pdf": "LMN-301 Statistical Analysis Plan v2",
    "LMN-4471_Investigators_Brochure_v7.pdf": "Investigator's Brochure v7",
    "LMN-4471_Advisory_Briefing_Book_draft.pdf": "Advisory briefing book (draft)",
    "LMN-4471_DSUR_2025.pdf": "DSUR 2025",
    "LMN-301_Plain_Language_Summary_draft.pdf": "Plain-language summary (draft)",
}
SKIP = {"page_header", "page_footer", "page_number"}

spark = DatabricksSession.builder.remote(host=dbx.HOST, token=dbx.token(), serverless=True).getOrCreate()

rows = spark.sql(f"""
  SELECT path, CAST(ai_parse_document(content) AS STRING) AS j
  FROM read_files('/Volumes/{dbx.CATALOG}/{dbx.SCHEMA}/source_docs/*.pdf', format => 'binaryFile')
""").collect()
print("parsed", len(rows), "documents")

chunks = []
for r in rows:
    fname = r["path"].rsplit("/", 1)[-1]
    d = json.loads(r["j"])
    els = d["document"]["elements"]
    by_page: dict[int, list[str]] = {}
    for e in els:
        if e.get("type") in SKIP or not e.get("content"):
            continue
        pg = e["bbox"][0]["page_id"] + 1
        by_page.setdefault(pg, []).append(e["content"].strip())
    for pg, texts in sorted(by_page.items()):
        buf, n = "", 0
        for t in texts + [None]:
            if t is None or (buf and len(buf) + len(t) > 900):
                if buf:
                    cid = hashlib.md5(f"{fname}|{pg}|{n}".encode()).hexdigest()[:16]
                    chunks.append((cid, f"{dbx.CATALOG}/{dbx.SCHEMA}/source_docs/{fname}".replace(
                        f"{dbx.CATALOG}/{dbx.SCHEMA}/", f"/Volumes/{dbx.CATALOG}/{dbx.SCHEMA}/"), TITLES[fname], pg, buf))
                    n += 1
                buf = ""
            if t is not None:
                buf = f"{buf}\n{t}".strip()

pdf = pd.DataFrame(chunks, columns=["chunk_id", "file_path", "doc_title", "page", "chunk_text"])
pdf["page"] = pdf["page"].astype("int32")
print("chunks", len(pdf))
print(pdf.groupby("doc_title").size())

spark.sql(f"DROP TABLE IF EXISTS {FQ}.doc_chunks")
spark.sql(f"""CREATE TABLE {FQ}.doc_chunks (
  chunk_id STRING, file_path STRING, doc_title STRING, page INT, chunk_text STRING)
  TBLPROPERTIES (delta.enableChangeDataFeed = true)""")
spark.createDataFrame(pdf).write.mode("append").insertInto(f"{FQ}.doc_chunks")
spark.sql(f"COMMENT ON TABLE {FQ}.doc_chunks IS 'Page-level chunks of the 6 synthetic PDFs in volume source_docs, produced with ai_parse_document. Source for the AI Search index doc_chunks_index. Change Data Feed is on.'")
spark.sql(f"ALTER TABLE {FQ}.doc_chunks SET TAGS ('sz_domain' = 'rnd', 'sz_project' = 'regsub_review', 'asset_class' = 'app')")
print("doc_chunks rows", spark.table(f"{FQ}.doc_chunks").count())

# --- index (existing endpoint only) ---
exists = subprocess.run(["databricks", "vector-search-indexes", "get-index", INDEX, "--profile", dbx.PROFILE],
                        capture_output=True, text=True).returncode == 0
if exists:
    print("index exists; triggering sync")
    subprocess.run(["databricks", "vector-search-indexes", "sync-index", INDEX, "--profile", dbx.PROFILE], check=True)
else:
    spec = {
        "name": INDEX, "endpoint_name": ENDPOINT, "primary_key": "chunk_id", "index_type": "DELTA_SYNC",
        "delta_sync_index_spec": {
            "source_table": f"{FQ}.doc_chunks", "pipeline_type": "TRIGGERED",
            "embedding_source_columns": [{"name": "chunk_text", "embedding_model_endpoint_name": "databricks-gte-large-en"}],
            "columns_to_sync": ["chunk_id", "file_path", "doc_title", "page", "chunk_text"],
        },
    }
    subprocess.run(["databricks", "vector-search-indexes", "create-index", "--profile", dbx.PROFILE, "--json", json.dumps(spec)], check=True)
for _ in range(90):
    out = subprocess.run(["databricks", "vector-search-indexes", "get-index", INDEX, "--profile", dbx.PROFILE, "-o", "json"],
                         capture_output=True, text=True).stdout
    st = json.loads(out)["status"]
    print(st.get("ready"), st.get("message", "")[:80], st.get("indexed_row_count"))
    if st.get("ready") and st.get("indexed_row_count", 0) >= len(pdf):
        break
    time.sleep(20)
