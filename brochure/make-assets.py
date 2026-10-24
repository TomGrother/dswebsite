# Prepares brochure-only image assets from the website's own images.
#   py -3 brochure/make-assets.py
# - logo-reversed.png : the logo recoloured for dark backgrounds
#   (green wordmark -> white, teal door/strapline -> brand cyan)
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "brochure", "assets")
os.makedirs(OUT, exist_ok=True)

GREEN = (14, 101, 81)
TEAL = (15, 126, 152)
WHITE = (255, 255, 255)
CYAN = (65, 189, 214)


def nearest(rgb):
    dg = sum((a - b) ** 2 for a, b in zip(rgb, GREEN))
    dt = sum((a - b) ** 2 for a, b in zip(rgb, TEAL))
    return WHITE if dg <= dt else CYAN


logo = Image.open(os.path.join(ROOT, "public", "images", "logo.png")).convert("RGBA")
px = logo.load()
for y in range(logo.height):
    for x in range(logo.width):
        r, g, b, a = px[x, y]
        if a:
            px[x, y] = (*nearest((r, g, b)), a)
logo.save(os.path.join(OUT, "logo-reversed.png"))
print("logo-reversed.png", logo.size)

# - door-*.png : product cutouts trimmed to the door, sized for print
#   (see MAX_H) and with the drop shadow baked in.
#   A CSS filter: drop-shadow makes Edge rasterise each door into a large
#   lossless image, which is what made the PDF ~10 MB.
from PIL import ImageFilter

IMG = os.path.join(ROOT, "public", "images")
MAX_H = 900           # px — ~195 dpi at the largest use (118 mm); sources top out ~270 dpi
PAD = 0.10            # shadow margin, as a fraction of the door height
for name, src in {
    "door-security": "doors/cat-security.png",
    "door-fire": "doors/cat-fire.png",
    "door-thermal": "doors/thermal-main.png",
    "door-flood": "doors/cat-flood.png",
    "door-acoustic": "doors/cat-acoustic.png",
    "door-gp": "doors/cat-gp.png",
    "door-stock": "shop/IMG_3560-Cutout-600x800.png",
}.items():
    im = Image.open(os.path.join(IMG, src)).convert("RGBA")
    bbox = im.getchannel("A").point(lambda a: 255 if a > 12 else 0).getbbox()
    im = im.crop(bbox)
    if im.height > MAX_H:
        im = im.resize((round(im.width * MAX_H / im.height), MAX_H), Image.LANCZOS)
    # bake a soft shadow below/behind the door
    p = round(im.height * PAD)
    canvas = Image.new("RGBA", (im.width + 2 * p, im.height + 2 * p), (0, 0, 0, 0))
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    a = im.getchannel("A").point(lambda v: int(v * 0.55))
    shadow.paste(Image.new("RGBA", im.size, (0, 0, 0, 255)), (p, p + round(im.height * 0.035)), a)
    shadow = shadow.filter(ImageFilter.GaussianBlur(round(im.height * 0.03)))
    canvas.alpha_composite(shadow)
    canvas.alpha_composite(im, (p, p))
    canvas.save(os.path.join(OUT, name + ".png"), optimize=True)
    print(name + ".png", canvas.size, "pad", p)

# - slim-*.jpg : the photo inside the website's framed slimline images
#   (white border + offset green block are baked into those files)
for name, src in {
    "slim-janisol": "slimline/janisol.png",
    "slim-viss": "slimline/jansen-viss.png",
    "slim-arte15": "slimline/jansen-arte-15.png",
    "slim-c4": "slimline/janisol-c4.png",
    "slim-viss-fire": "slimline/jansen-viss-fire.png",
}.items():
    im = Image.open(os.path.join(IMG, src)).convert("RGB").crop((112, 76, 739, 703))
    im.save(os.path.join(OUT, name + ".jpg"), quality=92)
    print(name + ".jpg", im.size)

# - qr-*.svg : QR codes for the back cover (py -3 -m pip install segno)
import segno

for name, url in {
    "qr-downloads": "https://designandsupply.co.uk/downloads",
    "qr-contact": "https://designandsupply.co.uk/contact",
}.items():
    segno.make(url, error="m").save(os.path.join(OUT, name + ".svg"), scale=4, border=0, dark="#0f1d19")
    print(name + ".svg", url)
