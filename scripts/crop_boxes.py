"""Draw the printed_box of each tick of /api/compare on its page image and save crops, to check the boxes by eye.

    python scripts/crop_boxes.py <compare.json> <page.jpg> <out_dir>
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

cmp_path, img_path, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)
ticks = json.load(open(cmp_path))["ticks"]
img = Image.open(img_path).convert("RGB")
w, h = img.size
over = img.copy()
d = ImageDraw.Draw(over)
for i, t in enumerate(ticks):
    b = t["printed_box"]
    if not b:
        continue
    box = (b["x0"] * w, b["y0"] * h, b["x1"] * w, b["y1"] * h)
    d.rectangle(box, outline=(176, 69, 28), width=2)
    pad = 60
    crop = img.crop((max(0, box[0] - 330), max(0, box[1] - pad), min(w, box[2] + 330), min(h, box[3] + pad)))
    cd = ImageDraw.Draw(crop)
    ox, oy = max(0, box[0] - 330), max(0, box[1] - pad)
    cd.rectangle((box[0] - ox, box[1] - oy, box[2] - ox, box[3] - oy), outline=(176, 69, 28), width=2)
    name = f"{i:02d}_{t['row_key']}_{t['column_name']}_{t['printed_value']}.png".replace("/", "-")
    crop.save(out / name)
over.crop((int(w * 0.03), int(h * 0.18), int(w * 0.97), int(h * 0.72))).save(out / "all_21_boxes.png")
