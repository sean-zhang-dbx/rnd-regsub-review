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


def parse_grid(content):
    """Rows as (is_head, cells, grid_cols, row_idx) plus the table's row and column counts.

    grid_cols[i] is the grid column where cell i starts once colspan and rowspan are applied, so the position is the one
    a reader sees in the rendered table. row_idx is the 0-based <tr> index. Values are read exactly as in parse_rows."""
    rows, occupied, ncols = [], {}, 0
    trs = re.findall(r"<tr>(.*?)</tr>", content or "", flags=re.S)
    for ri, tr in enumerate(trs):
        cells, gcols, col = [], [], 0
        for attrs, inner in re.findall(r"<t[dh]([^>]*)>(.*?)</t[dh]>", tr, flags=re.S):
            while occupied.get((ri, col)):
                col += 1
            cs = int((re.search(r"colspan=\"?(\d+)", attrs) or [0, 1])[1])
            rs = int((re.search(r"rowspan=\"?(\d+)", attrs) or [0, 1])[1])
            cells.append(html.unescape(re.sub(r"<[^>]+>", "", inner)).strip())
            gcols.append(col)
            for dr in range(rs):
                for dc in range(cs):
                    occupied[(ri + dr, col + dc)] = True
            col += cs
            ncols = max(ncols, col)
        rows.append(("<th" in tr, cells, gcols, ri))
    return rows, len(trs), ncols


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
    for is_head, cells, page, eid, gcols, ri, nrows, ncols in rows:
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
                    out.append((table, rr["key"], col, tk[tok], page, eid, ri, nrows, gcols[pc], ncols))
    return out


def ae_cells(table, rows, page, eid, socs, pts, unmatched, nrows, ncols):
    out = []
    for is_head, cells, gcols, ri in rows:
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
        # the cell list of an AE row is label then one cell per arm; the grid column of the arm's cell is recorded
        nz = [i for i in range(1, len(cells)) if cells[i]]
        rest = " ".join(cells[i] for i in nz)
        pos = 0
        for ai, arm in enumerate(("pbo", "low", "high")):
            m = re.compile(r"\s*(\d+)(?:\s*\(\s*([<>]?[\d.]+)%\s*\))?(?:\s*\[(\d+)\])?").match(rest, pos)
            if not m:
                break
            pos = m.end()
            gc = gcols[nz[min(ai, len(nz) - 1)]] if nz else gcols[-1]
            out.append((table, key, f"{arm}_n", m.group(1), page, eid, ri, nrows, gc, ncols))
            if m.group(2) is not None:
                out.append((table, key, f"{arm}_pct", m.group(2), page, eid, ri, nrows, gc, ncols))
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
            allrows = []
            for page, eid, content in els:
                grid, nrows, ncols = parse_grid(content)
                allrows += [(h, c, page, eid, g, ri, nrows, ncols) for h, c, g, ri in grid]
            out += cells_for(table, meta["rows"], kinds[table], allrows, unmatched)
        else:
            for page, eid, content in els:
                grid, nrows, ncols = parse_grid(content)
                out += ae_cells(table, grid, page, eid, socs, pts, unmatched, nrows, ncols)
    # a cell can only be printed once
    seen, dedup = set(), []
    for c in out:
        k = c[:3]
        if k in seen:
            unmatched.append((c[0], c[4], f"{c[1]}.{c[2]}", "printed more than once (kept the first)"))
            continue
        seen.add(k)
        dedup.append(c)
    q(f"""CREATE OR REPLACE TABLE {FQ}.submitted_tlf_cells (tlf STRING, row_key STRING, column_name STRING, printed_value STRING, page INT, element_id INT, row_idx INT, row_count INT, col_idx INT, col_count INT, box_x0 DOUBLE, box_y0 DOUBLE, box_x1 DOUBLE, box_y1 DOUBLE)
        COMMENT 'ANSWER KEY. Printed numbers of the in-scope section 14 tables of the submitted CDISCPILOT01 CSR, as printed, mapped to our table (tlf), row_key and column, with the cell position in the printed table element (0-based row_idx and col_idx, row_count and col_count of the table, colspan and rowspan applied). The pod never reads this table. {dbx.SOURCE_NOTE}'""")
    vals = [f"({lit(a)},{lit(b)},{lit(c)},{lit(d)},{e},{f},{g},{h},{i},{j})" for a, b, c, d, e, f, g, h, i, j in dedup]
    for i in range(0, len(vals), 200):
        q(f"INSERT INTO {FQ}.submitted_tlf_cells (tlf, row_key, column_name, printed_value, page, element_id, row_idx, row_count, col_idx, col_count) VALUES " + ",".join(vals[i:i + 200]))
    q(f"ALTER TABLE {FQ}.submitted_tlf_cells SET TAGS ({dbx.TAGS})")
    print("submitted_tlf_cells", len(dedup), "(boxes are empty: run scripts/locate_printed_cells.py next)")
    for t in D.TABLES:
        print("  ", t, sum(1 for c in dedup if c[0] == t))
    print("unmatched printed rows:", len(unmatched))
    for u in unmatched[:60]:
        print("  ", u)


if __name__ == "__main__":
    q = dbx.runner()
    # --cells-only rebuilds just submitted_tlf_cells (for example to refresh the grid positions).
    if "--cells-only" not in sys.argv:
        build_sections(q)
    build_cells(q)
