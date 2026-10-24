# One-off: read the colour list out of the original chart, whose codes are
# vector outlines (not text). Step 1 of 3 — render the code column of every
# page for OCR and record each swatch row's exact fill colour from the PDF.
#   py -3 docs-src/colours-extract/render_rows.py <workdir>
# Then: ocr_windows.ps1 and ocr_tesseract.js over <workdir>, then merge.py.
import json
import os
import pathlib
import sys

import fitz

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE.parent / "source" / "DS_All_Standard_Colours-original.pdf"
work = pathlib.Path(sys.argv[1])
work.mkdir(parents=True, exist_ok=True)

ZOOM = 3.4
CLIP_X0, CLIP_X1 = 125, 600   # code text column, right of the swatches (x = 75..121)

rows = []
doc = fitz.open(SRC)
for n, page in enumerate(doc):
    swatches = set()
    for d in page.get_drawings():
        r = d["rect"]
        if d.get("fill") and 25 < r.width < 80 and 10 < r.height < 30 and 95 < r.y0 < 690:
            swatches.add((round(r.y0, 1), round(r.y1, 1), tuple(round(c * 255) for c in d["fill"])))
    swatches = sorted(swatches)
    clip = fitz.Rect(CLIP_X0, 96, CLIP_X1, 694)
    png = work / f"p{n + 1:02d}.png"
    page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), clip=clip).save(png)
    for i, (y0, y1, rgb) in enumerate(swatches):
        rows.append({"page": n + 1, "row": i + 1, "y0": y0, "y1": y1,
                     # row band in image pixels, for matching OCR lines
                     "py0": (y0 - 96) * ZOOM, "py1": (y1 - 96) * ZOOM,
                     "hex": "#%02x%02x%02x" % rgb})
(work / "rows.json").write_text(json.dumps(rows, indent=1))
print(len(rows), "rows,", doc.page_count, "page images ->", work)
