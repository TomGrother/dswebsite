# Renders each brochure page to PNG plus one contact sheet, for review.
#   py -3 brochure/preview.py <pdf> <outdir>
import os
import sys
import fitz
from PIL import Image

pdf, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
doc = fitz.open(pdf)
thumbs = []
for p in doc:
    pix = p.get_pixmap(matrix=fitz.Matrix(1.6, 1.6))
    path = os.path.join(outdir, f"page-{p.number + 1:02d}.png")
    pix.save(path)
    im = Image.open(path).convert("RGB")
    im.thumbnail((300, 300))
    thumbs.append(im)
cols = 4
rows = (len(thumbs) + cols - 1) // cols
sheet = Image.new("RGB", (cols * 310 + 10, rows * 310 + 10), "#777")
for i, im in enumerate(thumbs):
    sheet.paste(im, (10 + (i % cols) * 310, 10 + (i // cols) * 310))
sheet.save(os.path.join(outdir, "sheet.png"))
print(f"{doc.page_count} pages -> {outdir}")
