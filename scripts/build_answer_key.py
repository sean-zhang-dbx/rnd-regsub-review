"""Build the answer key from the parsed submitted CSR: submitted_csr_sections and submitted_tlf_cells.

    uv run --python 3.12 --with databricks-sql-connector python scripts/build_answer_key.py

submitted_csr_sections: the numbered sections of doc_part csr_body (sections 1 to 13) with their text.
submitted_tlf_cells: the printed numbers of the in-scope section 14 tables (doc_part csr_tlf), mapped to our
table name, row_key and column. Rows are found by their printed labels (tlf_defs.py), never by a value, and the
values are read from the parsed table HTML as printed. Printed rows that match no row of ours are listed as
unmatched with the reason. The pod never reads these two tables.
"""
import html
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402
import tlf_defs as D  # noqa: E402

FQ = dbx.FQ
TOKEN = re.compile(r"[<>]=?\.?\d+(?:\.\d+)?|-?\d+(?:\.\d+)?|-?\.\d+")


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + dbx.esc(str(v)) + "'"


def plain(content):
    t = re.sub(r"</tr>", "\n", content or "")
    t = re.sub(r"</t[dh]>", " | ", t)
    t = html.unescape(re.sub(r"<[^>]+>", " ", t))
    return re.sub(r"[ \t]+", " ", t).strip()


def parse_rows(content):
    rows = []
    for tr in re.findall(r"<tr>(.*?)</tr>", content or "", flags=re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.S)]
        is_head = "<th" in tr
        rows.append((is_head, cells))
    return rows


def tokens(text):
    return TOKEN.findall(text.replace("%", "").replace("*", "").replace("[", " ").replace("]", " "))


def norm(s):
    return re.sub(r"\s+", "", re.sub(r"\[\d+\]", "", s or "")).lower()


# ------------------------------------------------------------------ submitted_csr_sections
def build_sections(q):
    els = q(f"""SELECT page, element_id, element_type, content FROM {FQ}.doc_elements WHERE doc_part = 'csr_body'
        AND element_type NOT IN ('page_header','page_footer','page_number') ORDER BY page, element_id""")
    sections, cur = [], None
    hdr = re.compile(r"^(\d+(?:\.\d+)*)\.?\s+(\S.*)$", re.S)
    for page, eid, typ, content in els:
        m = hdr.match((content or "").strip()) if typ == "section_header" else None
        if m and not re.match(r"^(Table|Figure)", content):
            cur = dict(section=m.group(1), title=re.sub(r"\s+", " ", m.group(2)).strip(), page_from=page, page_to=page, text=[])
            sections.append(cur)
        elif cur is not None:
            t = plain(content) if typ != "figure" else ""
            if t:
                cur["text"].append(t)
                cur["page_to"] = page
    q(f"""CREATE OR REPLACE TABLE {FQ}.submitted_csr_sections (section STRING, title STRING, page_from INT, page_to INT, text STRING)
        COMMENT 'ANSWER KEY. Numbered sections 1 to 13 of the submitted CDISCPILOT01 CSR (doc_part csr_body) from ai_parse_document. The pod never reads this table; it is used only to score a drafted CSR. {dbx.SOURCE_NOTE}'""")
    vals = [f"({lit(s['section'])},{lit(s['title'])},{s['page_from']},{s['page_to']},{lit(chr(10).join(s['text']))})" for s in sections]
    for i in range(0, len(vals), 10):
        q(f"INSERT INTO {FQ}.submitted_csr_sections VALUES " + ",".join(vals[i:i + 10]))
    q(f"ALTER TABLE {FQ}.submitted_csr_sections SET TAGS ({dbx.TAGS})")
    print("submitted_csr_sections", len(sections))


# ------------------------------------------------------------------ submitted_tlf_cells
def spec_match(table, rows_spec, kind, label_norm, group_norm, occ, block):
    """All rows of ours that read from this printed row (a printed 'Mean (SD)' row feeds a mean row and an SD row)."""
    found = []
    for r in rows_spec:
        sub, grp = r["sub"], r["group"]
        if kind == "flat":  # label in cell 0 only
            if norm(grp) == label_norm and r.get("block", block) == block:
                found.append(r)
        elif kind == "eff":
            base, _, k = (sub or "").partition("#")
            if norm(base) != label_norm:
                continue
            if k and int(k) != occ:
                continue
            if grp is None or norm(grp) == group_norm:
                found.append(r)
        elif kind == "grouped":
            if norm(grp) == group_norm and norm(sub) == label_norm:
                found.append(r)
    return found


def cells_for(table, rows_spec, kind, rows, unmatched):
    out = []
    group = None
    block = 1
    occ = {}
    for is_head, cells, page, eid in rows:
        if is_head or not cells:
            continue
        if kind == "flat":
            label = cells[0]
            if label.startswith("Reason for Early Termination"):
                block = 2
            ln = norm(label)
            r = spec_match(table, rows_spec, kind, ln, None, 0, block)
            if not r:
                if any(c for c in cells[1:]):
                    unmatched.append((table, page, label, "no row of ours with this printed label"))
                continue
        elif kind == "eff":
            label = cells[0]
            if not any(c for c in cells[1:]):
                group = norm(label)
                continue
            ln = norm(label)
            occ[ln] = occ.get(ln, 0) + 1
            r = spec_match(table, rows_spec, kind, ln, group, occ[ln], 1)
            if not r:
                unmatched.append((table, page, label, "no row of ours with this printed label"))
                continue
        else:  # grouped: group cell 0 (carried), sub cell 1
            if cells[0]:
                group = norm(cells[0])
            label = cells[1] if len(cells) > 1 else ""
            r = spec_match(table, rows_spec, kind, norm(label), group, 0, 1)
            if not r:
                unmatched.append((table, page, f"{cells[0] or ''} / {label}", "no row of ours with this printed label"))
                continue
        for rr in r:
            for col, pc, tok in rr["cells"]:
                if pc >= len(cells):
                    continue
                tk = tokens(cells[pc])
                if tok < len(tk):
                    out.append((table, rr["key"], col, tk[tok], page, eid))
    return out


def ae_cells(table, rows, page, eid, socs, pts, unmatched):
    out = []
    for is_head, cells in rows:
        if is_head or len(cells) < 2:
            continue
        label = cells[0].strip().upper()
        if not label:
            continue
        if label == "ANY BODY SYSTEM":
            key = "any_body_system"
        elif label in socs:
            key = D.slug(label)
        else:
            soc_c = [x for x in socs if x.startswith(label)] if len(label) >= 20 else []
            full = label if label in pts else None
            if full is None:
                cand = [p for p in pts if p.startswith(label)]
                if len(cand) == 1:
                    full = cand[0]
            if full is None and len(soc_c) == 1:
                key = D.slug(soc_c[0])
            elif full is None:
                unmatched.append((table, page, label, "printed label is not a SOC or PT of ADAE (or ambiguous truncation)"))
                continue
            else:
                key = "pt_" + D.slug(full)
        rest = " ".join(c for c in cells[1:] if c)
        pos = 0
        for arm in ("pbo", "low", "high"):
            m = re.compile(r"\s*(\d+)(?:\s*\(\s*([<>]?[\d.]+)%\s*\))?(?:\s*\[(\d+)\])?").match(rest, pos)
            if not m:
                break
            pos = m.end()
            out.append((table, key, f"{arm}_n", m.group(1), page, eid))
            if m.group(2) is not None:
                out.append((table, key, f"{arm}_pct", m.group(2), page, eid))
    return out


def build_cells(q):
    socs = {r[0].upper() for r in q(f"SELECT DISTINCT AEBODSYS FROM {FQ}.adam_adae")}
    pts = {r[0].upper() for r in q(f"SELECT DISTINCT AEDECOD FROM {FQ}.adam_adae")}
    kinds = {D.T1401: "flat", D.T1402: "flat", D.T1403: "grouped", D.T1404: "eff", D.T1405: "eff", D.T1406: "grouped"}
    out, unmatched = [], []
    for table, meta in D.TABLES.items():
        pages = meta["pages"]
        els = q(f"""SELECT page, element_id, content FROM {FQ}.doc_elements WHERE doc_part = 'csr_tlf' AND element_type = 'table'
            AND page IN ({','.join(map(str, pages))}) ORDER BY page, element_id""")
        if table in kinds:
            # a table can span pages (14-2.01): the group carries over, so parse the pages in sequence
            allrows = [(h, c, page, eid) for page, eid, content in els for h, c in parse_rows(content)]
            out += cells_for(table, meta["rows"], kinds[table], allrows, unmatched)
        else:
            for page, eid, content in els:
                out += ae_cells(table, parse_rows(content), page, eid, socs, pts, unmatched)
    # a cell can only be printed once
    seen, dedup = set(), []
    for c in out:
        k = c[:3]
        if k in seen:
            unmatched.append((c[0], c[4], f"{c[1]}.{c[2]}", "printed more than once (kept the first)"))
            continue
        seen.add(k)
        dedup.append(c)
    q(f"""CREATE OR REPLACE TABLE {FQ}.submitted_tlf_cells (tlf STRING, row_key STRING, column_name STRING, printed_value STRING, page INT, element_id INT)
        COMMENT 'ANSWER KEY. Printed numbers of the in-scope section 14 tables of the submitted CDISCPILOT01 CSR, as printed, mapped to our table (tlf), row_key and column. The pod never reads this table. {dbx.SOURCE_NOTE}'""")
    vals = [f"({lit(a)},{lit(b)},{lit(c)},{lit(d)},{e},{f})" for a, b, c, d, e, f in dedup]
    for i in range(0, len(vals), 200):
        q(f"INSERT INTO {FQ}.submitted_tlf_cells VALUES " + ",".join(vals[i:i + 200]))
    q(f"ALTER TABLE {FQ}.submitted_tlf_cells SET TAGS ({dbx.TAGS})")
    print("submitted_tlf_cells", len(dedup))
    for t in D.TABLES:
        print("  ", t, sum(1 for c in dedup if c[0] == t))
    print("unmatched printed rows:", len(unmatched))
    for u in unmatched[:60]:
        print("  ", u)


if __name__ == "__main__":
    q = dbx.runner()
    build_sections(q)
    build_cells(q)
