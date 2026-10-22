"""Parse the whole CSR package PDF with ai_parse_document and build the document tables and the AI Search index.

    uv run --python 3.12 --with databricks-sql-connector --with pillow python scripts/parse_docs.py [--reparse]

1. ai_parse_document (version 2.0, page images to volume parsed_pages) on the whole, unsplit PDF
   cdiscpilot01.pdf in volume source_docs. The raw result is kept in doc_parsed_raw.
2. doc_elements (typed elements, bounding boxes in page-image pixels) with doc_part set by page range.
3. doc_pages (page image path and pixel size).
4. doc_chunks (element-level chunks of about 600 characters; the submitted CSR parts csr_body and
   csr_tlf are not chunked, so the answer key is not in the index) with Change Data Feed on.
5. AI Search (Delta Sync, hybrid) index doc_elements_index on endpoint sz-shared-vs, doc_part is a column.

Page ranges per doc_part were confirmed from the headings of the parsed document (see docs/RESOURCES.md).
"""
import concurrent.futures
import hashlib
import io
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402

FQ = dbx.FQ
PDF = f"{dbx.VOL_SRC}/cdiscpilot01.pdf"
ENDPOINT = "sz-shared-vs"
INDEX = f"{FQ}.doc_elements_index"

# (doc_part, first page, last page, doc_title). Confirmed from the parsed headings:
#  p1 "1. TITLE PAGE", p42 "14. SUMMARY TABLES AND FIGURES", p152 "15. REFERENCES", p153 "16. APPENDICES / Appendix 1",
#  p154 protocol title page "Protocol H2Q-MC-LZZT(c)", p158 "1. Introduction", p204 "6. References" (end of protocol text),
#  p205 "Protocol Attachment LZZT.1" ... p251 "Appendix 2. Sample Case Report Form" ... p415 "Appendix 8",
#  p416 "Appendix 9. Statistical Analysis Plan", p421 "1. BACKGROUND", p465 SAP appendix 3 text, p466 SAS output "Ad hoc Template 1",
#  p488 "Appendix 10".
PARTS = [
    ("csr_body", 1, 41, "CDISCPILOT01 CSR, sections 1 to 13 (submitted report)"),
    ("csr_tlf", 42, 151, "CDISCPILOT01 CSR, section 14 tables and figures (submitted report)"),
    ("references", 152, 152, "CDISCPILOT01 CSR, section 15 references"),
    ("appendix_index", 153, 153, "CDISCPILOT01 CSR, section 16 appendix index"),
    ("protocol", 154, 204, "Protocol H2Q-MC-LZZT(c)"),
    ("protocol_appendix", 205, 415, "Protocol H2Q-MC-LZZT(c), attachments, case report form and appendices 3 to 8"),
    ("sap", 416, 465, "Statistical Analysis Plan (Appendix 9)"),
    ("other", 466, 492, "CDISCPILOT01 CSR package, analysis output and appendices 10 to 14"),
]
SEARCH_EXCLUDED = {"csr_body", "csr_tlf"}
SKIP_TYPES = ("page_header", "page_footer", "page_number")


def part_case(col="page"):
    return "CASE " + " ".join(f"WHEN {col} BETWEEN {a} AND {b} THEN '{p}'" for p, a, b, _ in PARTS) + " ELSE 'other' END"


def title_case(col="doc_part"):
    return "CASE " + " ".join(f"WHEN {col} = '{p}' THEN '{dbx.esc(t)}'" for p, _, _, t in PARTS) + " ELSE 'other' END"


def sql_lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + dbx.esc(str(v)) + "'"


def parse(q, reparse: bool):
    exists = q(f"SHOW TABLES IN {FQ} LIKE 'doc_parsed_raw'")
    if exists and not reparse:
        print("doc_parsed_raw exists; skipping ai_parse_document (use --reparse)")
        return
    t = time.time()
    q(f"""CREATE OR REPLACE TABLE {FQ}.doc_parsed_raw
        COMMENT 'Raw ai_parse_document (version 2.0) output for cdiscpilot01.pdf. {dbx.SOURCE_NOTE}' AS
        SELECT path, ai_parse_document(content, map('version', '2.0', 'imageOutputPath', '{dbx.VOL_PAGES}/')) AS parsed
        FROM read_files('{dbx.VOL_SRC}/', format => 'binaryFile', pathGlobFilter => 'cdiscpilot01.pdf')""")
    print("parsed in", round(time.time() - t), "s")


def build_elements(q):
    q(f"""CREATE OR REPLACE TABLE {FQ}.doc_elements
        COMMENT 'Typed layout elements of cdiscpilot01.pdf from ai_parse_document (version 2.0); bounding boxes in page-image pixels; doc_part by page range. {dbx.SOURCE_NOTE}' AS
        SELECT '{PDF}' AS file_path,
          CAST('' AS STRING) AS doc_title,
          {part_case('p')} AS doc_part,
          p AS page, element_id, element_type, content, x0, y0, x1, y1, confidence
        FROM (
          SELECT CAST(variant_get(e, '$.bbox[0].page_id', 'INT') + 1 AS INT) AS p,
            CAST(variant_get(e, '$.id', 'INT') AS INT) AS element_id,
            variant_get(e, '$.type', 'STRING') AS element_type,
            variant_get(e, '$.content', 'STRING') AS content,
            CAST(variant_get(e, '$.bbox[0].coord[0]', 'DOUBLE') AS DOUBLE) AS x0,
            CAST(variant_get(e, '$.bbox[0].coord[1]', 'DOUBLE') AS DOUBLE) AS y0,
            CAST(variant_get(e, '$.bbox[0].coord[2]', 'DOUBLE') AS DOUBLE) AS x1,
            CAST(variant_get(e, '$.bbox[0].coord[3]', 'DOUBLE') AS DOUBLE) AS y1,
            CAST(variant_get(e, '$.confidence', 'DOUBLE') AS DOUBLE) AS confidence
          FROM {FQ}.doc_parsed_raw
          LATERAL VIEW explode(variant_get(parsed, '$.document.elements', 'ARRAY<VARIANT>')) t AS e)""")
    q(f"UPDATE {FQ}.doc_elements SET doc_title = {title_case()}")
    q(f"ALTER TABLE {FQ}.doc_elements SET TAGS ({dbx.TAGS},'source'='cdisc_pilot01')" if False else f"ALTER TABLE {FQ}.doc_elements SET TAGS ({dbx.TAGS})")
    n = q(f"SELECT count(*) FROM {FQ}.doc_elements")[0][0]
    print("doc_elements", n)


def image_size(token, uri):
    req = urllib.request.Request(f"{dbx.HOST}/api/2.0/fs/files{uri}", headers={"Authorization": f"Bearer {token}"})
    from PIL import Image

    with urllib.request.urlopen(req) as r:
        return Image.open(io.BytesIO(r.read())).size


def build_pages(q):
    rows = q(f"""SELECT CAST(variant_get(pg, '$.id', 'INT') + 1 AS INT) AS page, variant_get(pg, '$.image_uri', 'STRING') AS uri
        FROM {FQ}.doc_parsed_raw LATERAL VIEW explode(variant_get(parsed, '$.document.pages', 'ARRAY<VARIANT>')) t AS pg ORDER BY 1""")
    token = dbx.token()
    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        sizes = list(ex.map(lambda r: image_size(token, r[1]), rows))
    q(f"""CREATE OR REPLACE TABLE {FQ}.doc_pages (file_path STRING, page INT, image_path STRING, width DOUBLE, height DOUBLE)
        COMMENT 'Pages of cdiscpilot01.pdf with the page image written by ai_parse_document to volume parsed_pages. {dbx.SOURCE_NOTE}'""")
    values = [f"('{PDF}', {r[0]}, {sql_lit(r[1])}, {w}, {h})" for r, (w, h) in zip(rows, sizes)]
    for i in range(0, len(values), 100):
        q(f"INSERT INTO {FQ}.doc_pages VALUES " + ", ".join(values[i : i + 100]))
    q(f"ALTER TABLE {FQ}.doc_pages SET TAGS ({dbx.TAGS})")
    print("doc_pages", len(values), "image size", sizes[0])


def plain(content: str) -> str:
    t = re.sub(r"</tr>", "\n", content)
    t = re.sub(r"</t[dh]>", " | ", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n\s*", "\n", t).strip()


def split_long(text: str, limit: int = 900):
    if len(text) <= limit:
        return [text]
    pieces, buf = [], ""
    for seg in re.split(r"(?<=[.;:\n])\s+", text):
        if buf and len(buf) + len(seg) + 1 > limit:
            pieces.append(buf)
            buf = ""
        buf = f"{buf} {seg}".strip()
        while len(buf) > limit * 1.5:
            pieces.append(buf[:limit])
            buf = buf[limit:]
    if buf:
        pieces.append(buf)
    return pieces


def build_chunks(q):
    els = q(f"""SELECT doc_part, page, element_id, element_type, content FROM {FQ}.doc_elements
        WHERE element_type NOT IN ({','.join(repr(t) for t in SKIP_TYPES)}) AND content IS NOT NULL AND trim(content) <> ''
        ORDER BY page, element_id""")
    chunks = []
    by_page = {}
    for r in els:
        if r[0] in SEARCH_EXCLUDED:
            continue
        by_page.setdefault((r[0], r[1]), []).append((r[2], r[3], plain(r[4])))
    for (part, page), items in sorted(by_page.items(), key=lambda kv: kv[0][1]):
        buf, ids, n = "", [], 0

        def flush():
            nonlocal buf, ids, n
            if buf.strip():
                cid = hashlib.md5(f"{part}|{page}|{n}".encode()).hexdigest()[:16]
                chunks.append((cid, part, page, ",".join(map(str, ids)), buf.strip()))
                n += 1
            buf, ids = "", []

        for eid, etype, text in items:
            if not text:
                continue
            for piece in split_long(text):
                if buf and len(buf) + len(piece) > 600:
                    flush()
                buf = f"{buf}\n{piece}".strip()
                if not ids or ids[-1] != eid:
                    ids.append(eid)
        flush()
    q(f"""CREATE OR REPLACE TABLE {FQ}.doc_chunks (chunk_id STRING, doc_part STRING, page INT, element_ids STRING, chunk_text STRING)
        COMMENT 'Element-level chunks (about 600 characters) of the parsed CSR package for AI Search. The submitted report (doc_part csr_body, csr_tlf) is deliberately not chunked. {dbx.SOURCE_NOTE}'
        TBLPROPERTIES (delta.enableChangeDataFeed = true)""")
    vals = [f"({','.join(sql_lit(v) for v in c)})" for c in chunks]
    for i in range(0, len(vals), 60):
        q(f"INSERT INTO {FQ}.doc_chunks VALUES " + ", ".join(vals[i : i + 60]))
    q(f"ALTER TABLE {FQ}.doc_chunks SET TAGS ({dbx.TAGS})")
    print("doc_chunks", len(chunks))
    return len(chunks)


def cli(*args):
    return subprocess.run(["databricks", *args, "--profile", dbx.PROFILE], capture_output=True, text=True)


def build_index(n_chunks: int):
    if cli("vector-search-indexes", "get-index", INDEX).returncode == 0:
        print("index exists; sync")
        cli("vector-search-indexes", "sync-index", INDEX)
    else:
        spec = {
            "name": INDEX, "endpoint_name": ENDPOINT, "primary_key": "chunk_id", "index_type": "DELTA_SYNC",
            "delta_sync_index_spec": {
                "source_table": f"{FQ}.doc_chunks", "pipeline_type": "TRIGGERED",
                "embedding_source_columns": [{"name": "chunk_text", "embedding_model_endpoint_name": "databricks-gte-large-en"}],
                "columns_to_sync": ["chunk_id", "doc_part", "page", "element_ids", "chunk_text"],
            },
        }
        r = cli("vector-search-indexes", "create-index", "--json", json.dumps(spec))
        print(r.stdout[:300], r.stderr[:300])
    for _ in range(120):
        out = cli("vector-search-indexes", "get-index", INDEX, "-o", "json").stdout
        st = json.loads(out)["status"]
        print(st.get("ready"), st.get("message", "")[:80], st.get("indexed_row_count"))
        if st.get("ready") and st.get("indexed_row_count", 0) >= n_chunks:
            return
        time.sleep(20)
    raise SystemExit("index did not become ready")


if __name__ == "__main__":
    q = dbx.runner()
    parse(q, "--reparse" in sys.argv)
    build_elements(q)
    build_pages(q)
    n = build_chunks(q)
    build_index(n)
    for r in q(f"SELECT doc_part, min(page), max(page), count(*) FROM {FQ}.doc_elements GROUP BY 1 ORDER BY 2"):
        print(r[0], r[1], r[2], r[3])
