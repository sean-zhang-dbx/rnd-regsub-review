"""Parse the 6 source PDFs with ai_parse_document (version 2.0) and keep the layout: elements with
their bounding boxes, and the page images ai_parse_document writes to volume parsed_pages.

    uv run --python 3.12 --with databricks-sql-connector --with pillow python scripts/parse_elements.py

Writes doc_pages (one row per page: image path and pixel size) and doc_elements (one row per element:
type, text, bounding box in page-image pixels). The drafting run reads the SAP from these tables, and
the reviewer assistant uses them to show where a cited passage sits on its page.
"""
import io
import json
import sys
import urllib.request
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402

FQ = dbx.FQ
VOL = f"/Volumes/{dbx.CATALOG}/{dbx.SCHEMA}"
q = dbx.runner()
q(f"CREATE VOLUME IF NOT EXISTS {FQ}.parsed_pages COMMENT 'Page images written by ai_parse_document for the source documents'")

titles = {r["file_path"]: r["doc_title"] for r in q(f"SELECT DISTINCT file_path, doc_title FROM {FQ}.doc_chunks")}
rows = q(f"""
  SELECT path, CAST(ai_parse_document(content, map('version', '2.0', 'imageOutputPath', '{VOL}/parsed_pages/',
                                                   'descriptionElementTypes', '*')) AS STRING) AS j
  FROM read_files('{VOL}/source_docs/', format => 'binaryFile', pathGlobFilter => '*.pdf')""")

token = dbx.token()


def image_size(uri: str):
    req = urllib.request.Request(f"{dbx.HOST}/api/2.0/fs/files{uri}", headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req) as r:
        return Image.open(io.BytesIO(r.read())).size


pages, elements = [], []
for r in rows:
    path = r["path"].replace("dbfs:", "")
    d = json.loads(r["j"])
    if d.get("error_status"):
        raise SystemExit(f"{path}: {d['error_status']}")
    title = titles.get(path, Path(path).stem)
    for pg in d["document"]["pages"]:
        w, h = image_size(pg["image_uri"])
        pages.append((path, title, pg["id"] + 1, pg["image_uri"], w, h))
    for e in d["document"]["elements"]:
        b = e["bbox"][0]
        x0, y0, x1, y1 = b["coord"]
        elements.append((path, title, b["page_id"] + 1, e["id"], e["type"], float(e.get("confidence") or 0), e.get("content") or "", e.get("description") or "", x0, y0, x1, y1))
    print(f"{title}: {len(d['document']['pages'])} pages, {len(d['document']['elements'])} elements")


def lit(v):
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("\\", "\\\\").replace("'", "\\'") + "'"


q(f"""CREATE OR REPLACE TABLE {FQ}.doc_pages (file_path STRING, doc_title STRING, page INT, image_path STRING, width INT, height INT)
      COMMENT 'Pages of the source PDFs, with the page image written by ai_parse_document (version 2.0)'""")
q(f"INSERT INTO {FQ}.doc_pages VALUES " + ", ".join("(" + ", ".join(lit(v) for v in p) + ")" for p in pages))
q(f"""CREATE OR REPLACE TABLE {FQ}.doc_elements (file_path STRING, doc_title STRING, page INT, element_id INT, element_type STRING,
        confidence DOUBLE, content STRING, description STRING, x0 INT, y0 INT, x1 INT, y1 INT)
      COMMENT 'Layout elements of the source PDFs from ai_parse_document (version 2.0); bounding boxes are in page-image pixels'""")
for i in range(0, len(elements), 200):
    q(f"INSERT INTO {FQ}.doc_elements VALUES " + ", ".join("(" + ", ".join(lit(v) for v in e) + ")" for e in elements[i:i + 200]))
print("pages:", len(pages), "elements:", len(elements))
