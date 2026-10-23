"""Locate every row of submitted_tlf_cells on its page image from the PDF text layer.

    python -I scripts/locate_printed_cells.py /path/to/cdiscpilot01.pdf [--dry-run] [--crops DIR]

The PDF is untrusted data: run this with `python -I` from outside the folder that holds the PDF.

For each printed cell the script finds the text of the cell in the HTML of its table element, locates that text on
the PDF page (PyMuPDF character boxes, rotated with page.rotation_matrix into the orientation of the page image),
and keeps the box of the number alone. Candidates must lie inside the table element's box. Rows of the HTML table are
aligned in order with the visual rows of the PDF (so "79" in the Baseline n row is never confused with the same text
in the Week 24 n row); inside the row, several equal candidates are resolved by the nearest column centre (taken from
the header cells, or the equal-column grid estimate from col_idx/col_count when the header is not found). Two equally
near candidates, or no candidate, leave the box null. Printed values are never changed: the script reads them before
and after and fails if one differs.

Columns written: box_x0, box_y0, box_x1, box_y1 (fractions of the page image width and height, 0 to 1).
"""
import re
import sys
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).parent))
import dbx  # noqa: E402
from build_answer_key import parse_grid, tokens  # noqa: E402

FQ = dbx.FQ


def page_lines(page):
    """Lines of a page as (text, [(char, rotated Rect)]) with rectangles in the rotated (displayed) orientation."""
    m = page.rotation_matrix
    out = []
    for b in page.get_text("rawdict")["blocks"]:
        for l in b.get("lines", []):
            chars = [(c["c"], fitz.Rect(c["bbox"]) * m) for s in l["spans"] for c in s["chars"]]
            if not chars:
                continue
            rect = fitz.Rect(l["bbox"]) * m
            out.append(("".join(c for c, _ in chars), chars, rect))
    return out


def cell_pattern(text):
    s = re.sub(r"\s+", "", text)
    if not s:
        return None
    return re.compile(r"(?<![\w.])" + r"\s*".join(re.escape(c) for c in s) + r"(?![\w])")


def find_in_line(line_text, pat):
    return [(m.start(), m.end()) for m in pat.finditer(line_text)]


def token_span(cell_text, value, column):
    """Offsets (in the cell text without whitespace) of the token that equals `value`.

    When the value occurs twice in the cell ("0 (0%)"), the column decides: *_n is the first, *_pct the last;
    any other column is ambiguous and gives None."""
    from build_answer_key import TOKEN

    t = re.sub(r"[%*\[\]]", " ", cell_text)
    hits = []
    for m in TOKEN.finditer(t):
        if m.group() == value:
            start = len(re.sub(r"\s", "", t[: m.start()]))
            hits.append((start, start + len(value)))
    if not hits:
        return None
    if len(hits) == 1:
        return hits[0]
    if column.endswith("_pct"):
        return hits[-1]
    if column.endswith("_n"):
        return hits[0]
    return None


def chars_nonspace(chars, start, end, from_pos, to_pos):
    """Char entries of line [start:end] without whitespace, positions from_pos:to_pos of that sub-sequence."""
    seq = [c for c in chars[start:end] if not c[0].isspace()]
    return seq[from_pos:to_pos]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    pdf = fitz.open(args[0])
    q = dbx.runner()

    before = {(r[0], r[1], r[2]): r[3] for r in q(f"SELECT tlf, row_key, column_name, printed_value FROM {FQ}.submitted_tlf_cells")}
    cells = q(f"SELECT tlf, row_key, column_name, printed_value, page, element_id, row_idx, row_count, col_idx, col_count FROM {FQ}.submitted_tlf_cells")
    pages = {int(r[0]): (float(r[1]), float(r[2])) for r in q(f"SELECT page, width, height FROM {FQ}.doc_pages")}
    els = {(int(r[0]), int(r[1])): r for r in q(f"SELECT page, element_id, x0, y0, x1, y1, content FROM {FQ}.doc_elements WHERE element_type = 'table'")}

    by_el = {}
    for c in cells:
        by_el.setdefault((int(c[4]), int(c[5])), []).append(c)

    result = {}  # (tlf,row_key,col) -> (x0,y0,x1,y1) or None
    stats = {"no_row": 0, "no_text": 0, "tie": 0, "ok": 0}
    for (pg, eid), group in by_el.items():
        el = els.get((pg, eid))
        if el is None or pg not in pages:
            for c in group:
                result[(c[0], c[1], c[2])] = None
            continue
        iw, ih = pages[pg]
        page = pdf[pg - 1]
        sx, sy = iw / page.rect.width, ih / page.rect.height
        ex0, ey0, ex1, ey1 = (float(el[i]) for i in (2, 3, 4, 5))
        pad = 12
        lines = []
        for text, chars, rect in page_lines(page):
            cx, cy = (rect.x0 + rect.x1) / 2 * sx, (rect.y0 + rect.y1) / 2 * sy
            if ex0 - pad <= cx <= ex1 + pad and ey0 - pad <= cy <= ey1 + pad and text.strip():
                lines.append((text, chars, rect))
        lines.sort(key=lambda l: (l[2].y0 + l[2].y1) / 2)
        # visual rows: lines whose vertical extents overlap by more than half of the smaller height
        vrows = []
        for ln in lines:
            r = ln[2]
            if vrows:
                last = vrows[-1]
                ov = min(r.y1, last["y1"]) - max(r.y0, last["y0"])
                if ov > 0.5 * min(r.y1 - r.y0, last["y1"] - last["y0"]):
                    last["lines"].append(ln)
                    last["y0"], last["y1"] = min(last["y0"], r.y0), max(last["y1"], r.y1)
                    continue
            vrows.append({"y0": r.y0, "y1": r.y1, "lines": [ln]})

        grid, _, ncols = parse_grid(el[6])
        min_col = min(int(c[8]) for c in group)
        header_x = {}  # grid column -> centre x in image px, from th cells found in the PDF header lines
        for is_head, cells_, gcols, ri in grid:
            if not is_head:
                continue
            for txt, gc in zip(cells_, gcols):
                pat = cell_pattern(txt)
                if pat is None or gc < min_col:
                    continue
                for ltxt, chars, rect in lines:
                    # header cells wrap over several PDF lines: use the first word of the header text
                    first = cell_pattern(txt.split()[0])
                    if first is not None and first.search(ltxt) and (rect.y1 * sy) < ey0 + 0.3 * (ey1 - ey0):
                        header_x.setdefault(gc, (rect.x0 + rect.x1) / 2 * sx)
                        break
        stored_cols = {int(c[8]) for c in group}

        # The header (for example "(N=79)") must not be taken for a data row: start after the last visual row that
        # holds the last word of a header cell.
        ptr = 0
        for is_head, cells_, gcols, ri in grid:
            if not is_head:
                continue
            for txt in cells_:
                words = txt.split()
                pat = cell_pattern(words[-1]) if words else None
                if pat is None:
                    continue
                for vi, vr in enumerate(vrows):
                    if any(pat.search(l[0]) for l in vr["lines"]):
                        ptr = max(ptr, vi + 1)
                        break

        # align HTML rows with visual rows in order
        row_band = {}
        for is_head, cells_, gcols, ri in grid:
            if is_head:
                continue
            keys = [(t, g) for t, g in zip(cells_, gcols) if g >= min_col and re.search(r"\d", t)]
            if not keys:
                continue
            for vi in range(ptr, len(vrows)):
                vt = [l[0] for l in vrows[vi]["lines"]]
                if all(any(cell_pattern(t).search(x) for x in vt) for t, _ in keys):
                    row_band[ri] = vi
                    ptr = vi + 1
                    break

        for c in group:
            key = (c[0], c[1], c[2])
            _, _, _, value, _, _, ri, rc, ci, cc = c
            ri, ci, cc, rc = int(ri), int(ci), int(cc), int(rc)
            result[key] = None
            if ri not in row_band:
                stats["no_row"] += 1
                continue
            row = next((g for g in grid if g[3] == ri), None)
            if row is None or ci not in row[2]:
                stats["no_text"] += 1
                continue
            ctext = row[1][row[2].index(ci)]
            ts = token_span(ctext, value, c[2])
            if ts is None and c[2].split("_")[0] in ("pbo", "low", "high"):
                # The stored column of an adverse event table can point at the "[n]" companion cell of the arm:
                # take the arm's own cell (the arm-th cell that is not empty and not a bracketed count).
                own = [(t, g) for t, g in zip(row[1], row[2]) if g >= min_col and t.strip() and not re.fullmatch(r"\[\d+\]", t.strip())]
                ai = ("pbo", "low", "high").index(c[2].split("_")[0])
                if ai < len(own):
                    ctext, ci = own[ai]
                    ts = token_span(ctext, value, c[2])
            pat = cell_pattern(ctext)
            if ts is None or pat is None:
                stats["no_text"] += 1
                continue
            a, b = ts
            cands = []
            for ltxt, chars, rect in vrows[row_band[ri]]["lines"]:
                for ms, me in find_in_line(ltxt, pat):
                    # offsets inside the line text -> non-space chars of the match
                    seg = [x for x in chars[ms:me] if not x[0].isspace()]
                    sub = seg[a:b]
                    if not sub:
                        continue
                    r = sub[0][1]
                    for _, cr in sub[1:]:
                        r = r | cr
                    cands.append(r)
            if not cands:
                stats["no_text"] += 1
                continue
            est = header_x.get(ci, ex0 + (ci + 0.5) / max(cc, 1) * (ex1 - ex0))
            dist = sorted(abs((r.x0 + r.x1) / 2 * sx - est) for r in cands)
            if len(cands) > 1 and abs(dist[1] - dist[0]) < 4:
                stats["tie"] += 1
                continue
            best = min(cands, key=lambda r: abs((r.x0 + r.x1) / 2 * sx - est))
            result[key] = (best.x0 * sx / iw, best.y0 * sy / ih, best.x1 * sx / iw, best.y1 * sy / ih)
            stats["ok"] += 1

    print("locate stats:", stats, "of", len(cells))
    if "--why" in sys.argv:
        for k, v in result.items():
            if v is None:
                print("  no box:", k, before[k])
    per = {}
    for k, v in result.items():
        t = per.setdefault(k[0], [0, 0])
        t[0] += 1
        t[1] += v is not None
    for t, (n, ok) in sorted(per.items()):
        print(f"  {t}: {ok} of {n} cells have a box")
    if dry:
        return

    have = {r[0] for r in q(f"DESCRIBE {FQ}.submitted_tlf_cells")}
    for col in ("box_x0", "box_y0", "box_x1", "box_y1"):
        if col not in have:
            q(f"ALTER TABLE {FQ}.submitted_tlf_cells ADD COLUMNS ({col} DOUBLE COMMENT 'Fraction (0 to 1) of the page image; from the PDF text layer. Null when not found.')")
    items = list(result.items())
    for i in range(0, len(items), 300):
        vals = ",".join(
            f"('{dbx.esc(k[0])}','{dbx.esc(k[1])}','{dbx.esc(k[2])}',"
            + (",".join(f"{x:.6f}" for x in v) if v else "NULL,NULL,NULL,NULL")
            + ")"
            for k, v in items[i : i + 300]
        )
        q(f"""MERGE INTO {FQ}.submitted_tlf_cells t USING (SELECT * FROM VALUES {vals} AS s(tlf, row_key, column_name, x0, y0, x1, y1))
            s ON t.tlf = s.tlf AND t.row_key = s.row_key AND t.column_name = s.column_name
            WHEN MATCHED THEN UPDATE SET t.box_x0 = s.x0, t.box_y0 = s.y0, t.box_x1 = s.x1, t.box_y1 = s.y1""")
    after = {(r[0], r[1], r[2]): r[3] for r in q(f"SELECT tlf, row_key, column_name, printed_value FROM {FQ}.submitted_tlf_cells")}
    changed = sum(1 for k, v in before.items() if after.get(k) != v) + len(set(after) - set(before))
    print("printed values changed:", changed)
    if changed:
        sys.exit(1)


if __name__ == "__main__":
    main()
