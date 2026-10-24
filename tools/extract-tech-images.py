# Extracts the drawing artwork from the legacy cill-type and door-handing PDFs
# into PNGs under content/tech-docs/, for build-tech-docs.js to compose into
# the branded "Cill Types" and "Door Handing Diagrams" documents.
#
# Run only when a source drawing in public/files/ changes:
#   py -3 tools/extract-tech-images.py
#
# The legacy cill sheets are portrait pages holding a landscape CAD drawing
# (rotated 90°); each is rendered at ~300 dpi, rotated upright, cropped to its
# figure region (descriptions and title blocks are re-typeset by the builder,
# so they are cut away here) and finally trimmed to content.
#
# Needs: pymupdf, pillow  (py -3 -m pip install pymupdf pillow)

import os
import fitz
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "public", "files")
OUT = os.path.join(ROOT, "content", "tech-docs")
os.makedirs(OUT, exist_ok=True)

ZOOM = 4  # 288 dpi — crisp line art at A4 print size


def render(pdf, rotate=False):
    page = fitz.open(pdf)[0]
    pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM))
    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if rotate:
        img = img.transpose(Image.Transpose.ROTATE_90)  # CCW: sideways CAD sheet -> upright
    return img


def crop_trim(img, box_frac, pad=14):
    w, h = img.size
    x0, y0, x1, y1 = box_frac
    img = img.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)))
    # Trim surrounding white, keep a small even border.
    bbox = ImageOps.invert(img.convert("L")).getbbox()
    if bbox:
        img = img.crop(bbox)
    out = Image.new("RGB", (img.width + 2 * pad, img.height + 2 * pad), "white")
    out.paste(img, (pad, pad))
    return out


# Figure region per cill sheet, as fractions of the upright landscape page.
# They differ because description length and figure placement vary by sheet
# (G also carries a second paragraph below its figure, excluded here and
# folded into the typeset description instead).
CILL_BOX = {
    "A": (0.025, 0.20, 0.975, 0.80),
    "B": (0.025, 0.18, 0.975, 0.80),
    "C": (0.025, 0.18, 0.975, 0.80),
    "D": (0.025, 0.18, 0.975, 0.80),
    "E": (0.025, 0.20, 0.975, 0.80),
    "F": (0.025, 0.19, 0.975, 0.80),
    "G": (0.025, 0.18, 0.975, 0.68),
    "H": (0.025, 0.38, 0.975, 0.80),
    "J": (0.025, 0.19, 0.975, 0.80),
}

for t, box in CILL_BOX.items():
    img = crop_trim(render(os.path.join(SRC, f"Cill_{t}_TYPE.pdf"), rotate=True), box)
    img.save(os.path.join(OUT, f"cill_{t}.png"))
    print(f"cill_{t}.png", img.size)

# Door handing diagrams -------------------------------------------------------

# Branded handing chart: keep only the four single-door-set diagrams with
# their captions (its own header/footer bands would clash inside our layout).
img = crop_trim(render(os.path.join(SRC, "Design-and-Supply-Handing-Chart-01.pdf")), (0.03, 0.40, 0.97, 0.88))
img.save(os.path.join(OUT, "handing_singles.png"))
print("handing_singles.png", img.size)

# Clean full-page CAD exports: trim to content.
for name, pdf in [
    ("astragal", "Standard_Astragal_Single_Double_Door.pdf"),
    ("lipped_flush", "New_Lipped_Flush_Doors.pdf"),
]:
    img = crop_trim(render(os.path.join(SRC, pdf)), (0.0, 0.0, 1.0, 1.0))
    img.save(os.path.join(OUT, f"{name}.png"))
    print(f"{name}.png", img.size)

print("done ->", OUT)
