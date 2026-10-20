"""Write source_citations: what each sentence of CSR 11.4.1 draws on, other than the figures.

    uv run --python 3.12 --with databricks-sql-connector python scripts/build_source_citations.py

figure_citations already records the certified table cell behind each figure. This table adds the
unstructured side (the parsed protocol and SAP passages, by doc_elements element), the outputs a
sentence cites that are not part of this demo, and wording that has no source and is the writer's.
Run after parse_elements.py, because element ids come from doc_elements.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402

FQ = dbx.FQ
DOCS = f"/Volumes/{dbx.CATALOG}/{dbx.SCHEMA}/source_docs"
PROTOCOL = f"{DOCS}/LMN-301_Protocol_v3.pdf"
SAP = f"{DOCS}/LMN-301_SAP_v2.pdf"

# (sentence, kind, ref, page, passage it must contain, what it supplies)
ROWS = [
    ("csr-11.4.1-01", "document", PROTOCOL, 3, "Clinical Endpoint Committee", "Primary endpoint and its adjudication"),
    ("csr-11.4.1-01", "document", SAP, 2, "responder definition at Week 52", "Endpoint wording"),
    ("csr-11.4.1-02", "document", SAP, 2, "Wald method", "Full analysis set and the Wald 95% CI"),
    ("csr-11.4.1-03", "writer", None, None, None, "\"About two-thirds\" and \"sustained through the end of the treatment period\""),
    ("csr-11.4.1-04", "document", SAP, 2, "Cochran-Mantel-Haenszel", "The test behind the p-value"),
    ("csr-11.4.1-05", "document", SAP, 1, "Per-protocol set", "Per-protocol set definition"),
    ("csr-11.4.1-05", "output", "Table 14.2.2", None, None, "Per-protocol results, listed in SAP section 5"),
    ("csr-11.4.1-06", "document", SAP, 4, "Prespecified subgroups", "Prespecified subgroups"),
    ("csr-11.4.1-06", "output", "Figure 14.2.1", None, None, "Subgroup forest plot, listed in SAP section 5"),
]

q = dbx.runner()


def lit(v):
    return "NULL" if v is None else str(v) if isinstance(v, int) else "'" + str(v).replace("'", "\\'") + "'"


values = []
for sid, kind, ref, page, contains, supplies in ROWS:
    element = None
    if kind == "document":
        hit = q(f"""SELECT element_id FROM {FQ}.doc_elements WHERE file_path = {lit(ref)} AND page = {page}
                    AND content LIKE {lit('%' + contains + '%')} ORDER BY element_id LIMIT 1""")
        if not hit:
            raise SystemExit(f"{sid}: no element on {ref} p.{page} contains {contains!r}")
        element = int(hit[0]["element_id"])
    values.append(f"({lit(sid)}, {lit(kind)}, {lit(ref)}, {lit(page)}, {lit(element)}, {lit(contains)}, {lit(supplies)})")

q(f"""CREATE OR REPLACE TABLE {FQ}.source_citations (sentence_id STRING, kind STRING, ref STRING, page INT, element_id INT, quote STRING, supplies STRING)
      COMMENT 'What each CSR sentence draws on besides its figures: parsed protocol and SAP passages (doc_elements), cited outputs outside this demo, and wording that is the writer''s'""")
q(f"INSERT INTO {FQ}.source_citations VALUES " + ", ".join(values))
for r in q(f"SELECT sentence_id, kind, page, element_id, supplies FROM {FQ}.source_citations ORDER BY sentence_id"):
    print(r["sentence_id"], r["kind"], r["page"], r["element_id"], r["supplies"])
