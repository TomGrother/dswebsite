"""Design & Supply technical documents, in the company-brochure design language.

    py -3 docs-src/build_docs.py            build everything
    py -3 docs-src/build_docs.py cill       just one: cill | handing | colours | sheets

Each document is written as HTML (docs-src/html/) and printed to PDF by headless
Microsoft Edge, then copied over its public/files/ target. Filenames never
change, so every existing link (site pages, brochure, legacy redirects) picks
up the new version.

Inputs
  content/tech-docs/*.png        cill + handing artwork (tools/extract-tech-images.py)
  docs-src/data/datasheets.json  data-sheet content, extracted from the original D&S sheets
  brochure/assets/*              reversed logo and product cutouts (brochure/make-assets.py)
  public/files/DS_All_Standard_Colours.pdf  colour swatches (kept; header/footer replaced)

Needs: py -3 -m pip install pymupdf pillow
"""
import html
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

from PIL import Image

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
FILES = ROOT / "public" / "files"
HTML = HERE / "html"
ART = HERE / "art"
HTML.mkdir(exist_ok=True)
ART.mkdir(exist_ok=True)

ASSETS = ROOT / "brochure" / "assets"
TECH = ROOT / "content" / "tech-docs"
CSS = (HERE / "docs.css").as_uri()
LOGO = (ASSETS / "logo-reversed.png").as_uri()
FONTS = ('<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800'
         '&family=Inter:wght@400;500;600;700&display=block" rel="stylesheet">')

VERSION = "2.0"
DATE = "October 2026"
PHONE = "01685 350 114"
CONTACT = "sales@designandsupply.co.uk · designandsupply.co.uk"
EST = "Merthyr Tydfil · Established 1986"


def esc(s):
    return html.escape(str(s), quote=False)


# ------------------------------------------------------------------ art --

def to_alpha(src, dst, white=False):
    """White background -> transparent, keeping ink colour (colour-to-alpha).
    white=True also turns the ink white, for use on the dark cover panels."""
    im = Image.open(src).convert("RGB")
    out = []
    for r, g, b in im.get_flattened_data():
        a = 255 - min(r, g, b)
        if a < 6:
            out.append((255, 255, 255, 0))
            continue
        if white:
            out.append((255, 255, 255, min(255, int(a * 1.15))))
        else:
            k = 255 / a
            out.append(tuple(max(0, min(255, round(255 - (255 - c) * k))) for c in (r, g, b)) + (a,))
    o = Image.new("RGBA", im.size)
    o.putdata(out)
    o.save(dst, optimize=True)


def cover_art(name, box, thicken=5):
    """Bold white line art for a cover panel: crop a region (fractions of the
    drawing), thicken its lines, then make it white-on-transparent."""
    from PIL import ImageFilter
    dst = ART / (name.replace(".png", "") + "_cover.png")
    src = TECH / name
    if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
        im = Image.open(src).convert("L")
        w, h = im.size
        im = im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))
        im = im.filter(ImageFilter.MinFilter(thicken))
        tmp = ART / "_cover_tmp.png"
        im.convert("RGB").save(tmp)
        to_alpha(tmp, dst, white=True)
        tmp.unlink()
    return dst.as_uri()


def art(name, white=False):
    """Transparent copy of a tech-docs drawing (cached in docs-src/art/)."""
    dst = ART / (name.replace(".png", "") + ("_white" if white else "") + ".png")
    src = TECH / name
    if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
        to_alpha(src, dst, white)
    return dst.as_uri()


# --------------------------------------------------------------- render --

EDGE = next(p for p in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe") if os.path.exists(p))


def render(html_path, pdf_path):
    """HTML -> PDF with headless Edge. Prints to a temp file first and copies it
    over the target, so OneDrive sees a modify, not a delete + create (which is
    what produces its 'Name clash' duplicates)."""
    tmpdir = pathlib.Path(tempfile.mkdtemp(prefix="ds-docs-"))
    tmp = tmpdir / "out.pdf"
    subprocess.run([EDGE, "--headless=new", "--disable-gpu", "--no-first-run",
                    f"--user-data-dir={tmpdir / 'profile'}", "--no-pdf-header-footer",
                    "--run-all-compositor-stages-before-draw", "--virtual-time-budget=15000",
                    f"--print-to-pdf={tmp}", pathlib.Path(html_path).as_uri()],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    last, stable = -1, 0
    for _ in range(120):
        if tmp.exists():
            size = tmp.stat().st_size
            stable = stable + 1 if size and size == last else 0
            last = size
            if stable >= 2:
                break
        time.sleep(0.5)
    if not tmp.exists():
        raise RuntimeError(f"Edge did not produce {pdf_path}")
    shutil.copyfile(tmp, pdf_path)
    shutil.rmtree(tmpdir, ignore_errors=True)
    print(f"  {pathlib.Path(pdf_path).name}  {round(pathlib.Path(pdf_path).stat().st_size / 1024)} KB")


def page_html(title, body):
    return (f'<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><title>{esc(title)}</title>'
            f'{FONTS}<link rel="stylesheet" href="{CSS}"></head><body>{body}</body></html>')


def cover(kicker, h1, ref, art_uri, intro, note_title, note, toc, cta_l, cta_s):
    toc_html = "".join(f"<li><b>{t}</b><span>page {p}</span></li>" for t, p in toc)
    return f"""<section class="page">
<header class="cv"><div class="leaf leaf-edge"></div><div class="leaf leaf-panel"></div>
<div class="art"><img src="{art_uri}" alt=""></div>
<img class="logo" src="{LOGO}" alt="Design &amp; Supply"><div class="est">{EST}</div>
<div class="tt"><div class="kick">{kicker}</div><h1>{h1}</h1><div class="ref">{ref} · Version {VERSION} · {DATE}</div></div></header>
<div class="cb"><p class="lead">{intro}</p>
<div class="note"><b>{note_title}</b><p>{note}</p></div>
<div class="toc"><h2>Contents</h2><ol>{toc_html}</ol></div></div>
<footer class="ft"><div class="l"><b>{cta_l}</b><span>{cta_s}</span></div><div class="r"><b>{PHONE}</b><span>{CONTACT}</span></div></footer>
</section>"""


def inner(doc_title, ref, n, total, content):
    return f"""<section class="page">
<div class="hb"><img src="{LOGO}" alt="Design &amp; Supply"><div class="t">{doc_title}</div></div>
{content}
<div class="folio"><span><b>Design &amp; Supply Ltd</b> · {ref} · v{VERSION} · {PHONE}</span><span class="pn">{n} / {total}</span></div>
</section>"""


# ----------------------------------------------------------- cill types --

CILLS = [
    ("A", "This type of cill is used when perhaps the floor outside is raised. Using this cill will allow the door to swing freely open without being obstructed by the outside floor.", None),
    ("B", "This type of cill is only ever used on an inward opening door. The cill is fitted in the rebate of the frame, with the slope running down towards the outside. Thus if any rain runs down the door onto the cill it will then run down the slope of the cill and onto the outside floor.", None),
    ("C", "This type of cill is commonly used on doors where perhaps wheelchairs, trolleys, etc are common traffic through the doors.", None),
    ("D", "This type of cill is commonly used on doors where perhaps wheelchairs, trolleys, etc are common traffic through the doors.", None),
    ("E", "This type of cill is a 6mm flat bar cill which sits directly under the frame. This cill is particularly good when the floor isn't finished or is uneven or crumbly. Please note that this cill is not standard and is chargeable.", ("warn", "Non-standard · chargeable")),
    ("F", "This type of cill sits at the back of the frame. A good cill to choose if a flat low-level cill is required, also if a panic bolt is being used on the door.", None),
    ("G", "This type of cill is an aluminium cill with a neoprene seal; it is not a standard cill and is therefore chargeable. It is commonly used on doors where wheelchairs, trolleys, etc are common traffic through the doors.", ("warn", "Non-standard · chargeable")),
    ("H", "This type of cill is our most popular of all the cills. It is similar to the 'F' type but it has a leading face which fits under the door. Good for every kind of purpose, particularly panic bolts. If you do not specify a different cill, this will come as standard.", ("std", "Supplied as standard")),
    ("J", "This type of cill has a sloping leading face which fits under the door.", None),
]


# One-line summaries of the descriptions above, for the selector table.
GLANCE = [
    ("A", "Raised floor outside — lets the door swing clear", ""),
    ("B", "Inward-opening doors only — slope sheds rain to the outside", ""),
    ("C", "Wheelchair and trolley traffic", ""),
    ("D", "Wheelchair and trolley traffic", ""),
    ("E", "6mm flat bar under the frame — unfinished or uneven floors", "Chargeable"),
    ("F", "Flat, low-level cill at the back of the frame — suits panic bolts", ""),
    ("G", "Aluminium with neoprene seal — wheelchair and trolley traffic", "Chargeable"),
    ("H", "Our most popular cill — every purpose, particularly panic bolts", "Standard"),
    ("J", "Sloping leading face that fits under the door", ""),
]


def glance_table():
    rows = "".join(f'<tr><td class="l">{t}</td><td>{esc(u)}</td><td>{f"<span class=\"chip{" warn" if s == "Chargeable" else ""}\">{s}</span>" if s else ""}</td></tr>'
                   for t, u, s in GLANCE)
    return f'<div class="glance"><h2>Cills <em>at a glance</em></h2><table><thead><tr><th>Type</th><th>Best for</th><th></th></tr></thead><tbody>{rows}</tbody></table></div>'


def build_cill():
    ref = "DS-TEC-CILL"
    per_page = [CILLS[i:i + 2] for i in range(0, len(CILLS), 2)]
    total = 1 + len(per_page)
    toc = []
    for pi, group in enumerate(per_page):
        for t, _, chip in group:
            label = f"Cill type {t}" + (f'<i>{chip[1].lower()}</i>' if chip else "")
            toc.append((label, pi + 2))
    pages = [cover(
        "Technical information", "Cill<br><em>types.</em>", ref, cover_art("cill_B.png", (0, 0, 0.6, 1)),
        "The standard cill profiles for Design &amp; Supply steel doorsets — what each type is for, when to choose it, and its section dimensions. Types A to J.",
        "Ordering",
        "Please quote the cill type when ordering. Handings and sizes must be confirmed when ordering. If you do not specify a cill, the H type is supplied as standard.",
        toc, "Questions about your order?", "Contact us to discuss your cill requirements.")]
    for pi, group in enumerate(per_page):
        cards = ""
        for t, text, chip in group:
            chip_html = f'<span class="chip{" warn" if chip and chip[0] == "warn" else ""}">{esc(chip[1])}</span>' if chip else ""
            cards += (f'<div class="cill"><div class="top"><div class="letter">{t}</div><div>'
                      f'<h2>Cill type {t} {chip_html}</h2><p>{esc(text)}</p></div></div>'
                      f'<div class="draw"><img src="{art(f"cill_{t}.png")}" alt=""></div></div>')
        extra = glance_table() if len(group) == 1 else ""
        pages.append(inner("Cill types", ref, pi + 2, total, f'<div class="cards">{cards}{extra}</div>'))
    out = HTML / "Design-and-Supply-Cill-Types.html"
    out.write_text(page_html("Cill Types — Design & Supply", "".join(pages)), encoding="utf-8")
    render(out, FILES / "Design-and-Supply-Cill-Types.pdf")


# -------------------------------------------------------------- handing --

HANDING = [
    ("Single <em>doorsets</em>", "Single doorsets", "handing_singles.png",
     "Each arrangement is drawn in plan with the inside at the top — hinge side and direction of opening as captioned.", 105),
    ("Standard <em>astragal</em>", "Standard astragal — single &amp; double", "astragal.png",
     "Plan sections through standard astragal doorsets, single and double, left and right handed.", 205),
    ("Lipped <em>flush</em>", "Lipped flush — single &amp; double", "lipped_flush.png",
     "Plan sections through lipped flush doorsets, single and double, left and right handed.", 205),
]


def build_handing():
    ref = "DS-TEC-HAND"
    total = 1 + len(HANDING)
    pages = [cover(
        "Technical information", "Door<br>handing<br><em>diagrams.</em>", ref, cover_art("handing_singles.png", (0, 0, 0.255, 1), 5),
        "How Design &amp; Supply doorsets are handed — single doorsets, standard astragal doubles and lipped flush doors, each drawn left and right handed.",
        "Ordering",
        "Handings must be confirmed when ordering. If you are unsure, send photographs or a sketch with your enquiry and our team will confirm the handing on your order acknowledgement.",
        [(t, i + 2) for i, (_, t, _, _, _) in enumerate(HANDING)],
        "Not sure which handing?", "Send us photographs or a sketch of the opening and we’ll confirm it for you.")]
    for i, (h2, _, img, text, h) in enumerate(HANDING):
        pages.append(inner("Door handing diagrams", ref, i + 2, total,
                           f'<div class="sect"><h2>{h2}</h2><p class="lead">{text}</p>'
                           f'<div class="draw" style="height:{h}mm"><img src="{art(img)}" alt=""></div></div>'))
    out = HTML / "Design-and-Supply-Door-Handing-Diagrams.html"
    out.write_text(page_html("Door Handing Diagrams — Design & Supply", "".join(pages)), encoding="utf-8")
    render(out, FILES / "Design-and-Supply-Door-Handing-Diagrams.pdf")


# ---------------------------------------------------------- data sheets --
# Content: docs-src/data/datasheets.json, extracted from the original D&S
# sheets with their facts unchanged. SHEETS adds only presentation: the title,
# tag and product image for the new layout.

IMG = ROOT / "public" / "images"
PHOTOS = HERE / "source" / "photos"   # each sheet's own photo, from the original sheets
SR_WORD = {1: "one", 2: "two", 3: "three", 4: "four"}


def _sr(n):
    cfg = dict(src=f"Design-and-Supply-Data-Sheet-Steel-Security-Rated-SR{n}.pdf", title=f"Security door<br><em>level {SR_WORD[n]}.</em>",
               tag=f"LPS 1175 · SR{n}", sub="Fortifying spaces", photo=PHOTOS / f"sr{n}.jpg")
    if n == 2:  # studio shot on black: show the whole door rather than crop it
        cfg.update(fit="contain", photo_bg="#000")
    return cfg


SHEETS = [
    _sr(1), _sr(2), _sr(3), _sr(4),
    dict(src="Design-and-Supply-Data-Sheet-Steel-Fire-Rated-Doors.pdf", title="Fire rated<br><em>doors.</em>",
         tag="EN 1634-1", sub="Dependable fire compartmentation", cutout=ASSETS / "door-fire.png"),
    dict(src="Design-and-Supply-Data-Sheet-Multi-Storey-Car-Park.pdf", title="Car park<br><em>doors.</em>",
         tag="Fire rated · EN 1634-1", sub="Fire-rated steel doorsets", photo=IMG / "news" / "carpark.png"),
    dict(src="Design-and-Supply-Data-Sheet-Steel-Flood-Rated.pdf", title="Flood<br><em>doors.</em>",
         tag="Flood defence", sub="Defend, protect, prevail", cutout=ASSETS / "door-flood.png"),
    dict(src="Design-and-Supply-Data-Sheet-Steel-Thermal-Doors.pdf", title="Therma-Line<br><em>doors.</em>",
         tag="U-value as low as 1.3 W/m²K", sub="Thermally efficient steel doorsets", cutout=ASSETS / "door-thermal.png"),
    dict(src="Design-and-Supply-Data-Sheet-Streamline-Door.pdf", title="Streamline<br><em>doors.</em>",
         tag="Bespoke steel doors", sub="Built for strength, reliability and lasting performance", cutout=ASSETS / "door-gp.png"),
    dict(src="Design-and-Supply-Data-Sheet-Slimline.pdf", title="Slimline<br><em>glazed doors.</em>",
         tag="LPS 1175 SR2 · LPS 2081", sub="Glazed security doors", photo=PHOTOS / "slimline.jpg"),
]

TICK = '<svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-5" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
CROSS = '<svg viewBox="0 0 12 12"><path d="M3.6 3.6l4.8 4.8M8.4 3.6l-4.8 4.8" fill="none" stroke="#8aa29b" stroke-width="1.6" stroke-linecap="round"/></svg>'
SOON = '<svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="3.6" fill="none" stroke="#0F7E98" stroke-width="1.3"/><path d="M6 4v2.2l1.4.9" fill="none" stroke="#0F7E98" stroke-width="1.3" stroke-linecap="round"/></svg>'

# notes in the extraction that describe the sheet rather than appear on it
NOT_SHEET_TEXT = ("Table key", "Specification table key", "This is the only", "Personnel Hardware and Fully Glazed are marked")


def size_label(label):
    l = label.lower()
    kind = "Single" if "single" in l else "Double" if "double" in l else label
    if "thickness" in l:
        return "Leaf thickness"
    extra = " inc. panel" if "panel" in l else ""
    mm = " · minimum" if "minimum" in l else " · maximum"
    return kind + extra + mm


def size_value(v):
    v = v.replace("mm (w) x ", " × ").replace("(w) x ", "× ").replace(" (h)", "").replace("mm x ", " × ")
    return v


def feature_state(f):
    fn = f["footnote"].strip()
    if "coming soon" in fn.lower():
        return "soon", ""
    mark = "**" if fn.startswith("**") else "*" if fn.startswith("*") else ""
    return ("yes" if f["available"] else "no"), mark


def build_sheet(cfg, s):
    title_plain = s["product"]
    apps = "".join(f"<li>{esc(a)}</li>" for a in s["applications"])
    bens = "".join(f'<li><span class="ic y">{TICK}</span>{esc(b)}</li>' for b in s["benefits"])
    sizes = "".join(f"<div><b>{esc(size_label(d['label']))}</b><span>{esc(size_value(d['value']))}</span></div>" for d in s["dimensions"])
    cells, legend_soon = "", False
    for f in s["features"]:
        state, mark = feature_state(f)
        legend_soon |= state == "soon"
        icon = {"yes": TICK, "no": CROSS, "soon": SOON}[state]
        label = esc(f["name"]) + (f"<sup>{mark}</sup>" if mark else "") + ('<em>Coming soon</em>' if state == "soon" else "")
        cells += f'<div class="cell {state}"><span class="ic {state[0]}">{icon}</span><span>{label}</span></div>'
    notes = [n for n in s["notes"] if not n.startswith(NOT_SHEET_TEXT)]
    notes_html = ('<div class="notes">' + "".join(f"<div>{esc(n)}</div>" for n in notes) + "</div>") if notes else ""
    legend = (f'<div class="legend"><span><span class="ic y">{TICK}</span>Available</span>'
              f'<span><span class="ic n">{CROSS}</span>Not available</span>'
              + (f'<span><span class="ic s">{SOON}</span>Coming soon</span>' if legend_soon else "") + "</div>")
    if "photo" in cfg:
        bg = f' style="background:{cfg["photo_bg"]}"' if "photo_bg" in cfg else ""
        fit = ' style="object-fit:contain"' if cfg.get("fit") == "contain" else ""
        visual = f'<div class="leaf ds-photo"{bg}><img src="{cfg["photo"].as_uri()}" alt=""{fit}></div>'
    else:
        visual = f'<img class="ds-door" src="{cfg["cutout"].as_uri()}" alt="">'
    closing = s["closingLine"].split(":", 1)[-1].strip() if s["closingLine"].lower().startswith("contact us today") else s["closingLine"]
    # units must keep their case inside the upper-cased tag chip (W/m²K, not W/M²K)
    tag = esc(cfg["tag"]).replace("W/m²K", '<span style="text-transform:none">W/m²K</span>')
    apps_note = next((e["text"] for e in s["extraSections"] if e["heading"].lower().startswith("key applications")), "")
    body = f"""<section class="page ds">
<header class="ds-hd"><div class="leaf leaf-edge"></div><div class="leaf leaf-panel"{f' style="background:{cfg["panel"]}"' if "panel" in cfg else ""}></div>{visual}
<img class="logo" src="{LOGO}" alt="Design &amp; Supply">
<div class="tt"><div><span class="kick">Product data sheet</span><span class="chip">{tag}</span></div><h1>{cfg["title"]}</h1><div class="sub">{esc(cfg["sub"])}</div></div></header>
<section class="ds-bd"><div>
<h3>Product overview</h3><p>{esc(s["overview"])}</p>
<h3>Key applications</h3><ul class="apps">{apps}</ul>{f'<p class="apps-note">{esc(apps_note)}</p>' if apps_note else ""}
<h3>Key benefits</h3><ul class="ben">{bens}</ul>
</div><aside><div class="sizes"><h4>Sizes (w × h)</h4>{sizes}</div>
<div class="order"><b>Ordering</b>Handings and sizes must be confirmed when ordering.</div></aside></section>
<section class="ds-spec"><div class="spec-head"><h3>Product specification</h3>{legend}</div>
<div class="grid">{cells}</div>{notes_html}</section>
<footer class="ft"><div class="l"><b>Contact us today</b><span>{esc(closing)}</span></div><div class="r"><b>{PHONE}</b><span>{CONTACT}</span><i>{esc(title_plain)} · Issue {VERSION} · {DATE}</i></div></footer>
</section>"""
    name = cfg["src"].replace(".pdf", "")
    out = HTML / f"{name}.html"
    out.write_text(page_html(f"{title_plain} — Data Sheet | Design & Supply", body), encoding="utf-8")
    render(out, FILES / cfg["src"])


def build_sheets(only=None):
    content = {s["sourceFile"]: s for s in json.loads((HERE / "data" / "datasheets.json").read_text(encoding="utf-8"))["sheets"]}
    for cfg in SHEETS:
        if only and only not in cfg["src"]:
            continue
        build_sheet(cfg, content[cfg["src"]])


# --------------------------------------------------------------- colours --
# Redesigned chart: one tile per RAL/BS colour (158 of them), grouped by
# colour family, listing each finish and product reference available in it.
# Data: docs-src/data/colours.json — 484 rows read from the original chart
# (its codes are vector outlines) by two OCR engines that had to agree, the
# rest checked by eye; swatch colours are the original's exact fill values.

FAMILIES = [
    ("1", "Yellows &amp; beiges"), ("2", "Oranges"), ("3", "Reds"), ("4", "Violets"), ("5", "Blues"),
    ("6", "Greens"), ("7", "Greys"), ("8", "Browns"), ("9", "Whites &amp; blacks"), ("BS", "British Standard (BS 4800)"),
]


def _finish_label(r):
    """'HR' + 'Smooth Matt HR' -> 'Smooth Matt HR'; other qualifiers (GL, CA) are kept
    in front exactly as the original printed them. Rows printed without a finish say so."""
    finish, suffix = r["finish"], r["suffix"]
    parts = [p for p in suffix.split() if p not in finish.split()]
    label = " ".join(parts + [finish]).strip()
    return label or "Finish not stated"


def _ink(hexc):
    r, g, b = (int(hexc[i:i + 2], 16) for i in (1, 3, 5))
    return "#fff" if (0.299 * r + 0.587 * g + 0.114 * b) < 150 else "#0f1d19"


def build_colours():
    data = json.loads((HERE / "data" / "colours.json").read_text(encoding="utf-8"))["colours"]
    groups = {}
    for c in data:
        fam = "BS" if c["std"] == "BS" else c["code"][0]
        tile = groups.setdefault(fam, {}).setdefault((c["std"], c["code"]), {"hex": c["hex"], "rows": []})
        tile["rows"].append(c)
    total = sum(len(t) for t in groups.values())

    def family(key, name):
        tiles = ""
        for (std, code), t in sorted(groups[key].items(), key=lambda kv: kv[0][1]):
            n = len(t["rows"])
            span = 3 if n > 14 else 2 if n > 6 else 1   # long finish lists spread across columns
            lines = "".join(f'<li><span>{esc(_finish_label(r))}</span><b>{esc(r["ref"])}</b></li>' for r in t["rows"])
            tiles += (f'<div class="ct" style="grid-column:span {span}"><div class="sw" style="background:{t["hex"]};color:{_ink(t["hex"])}">'
                      f'<span>{std}</span><b>{esc(code)}</b></div><ul style="column-count:{span}">{lines}</ul></div>')
        n_col = len(groups[key])
        return f'<section class="cfam"><h2>{name}<span>{n_col} colour{"" if n_col == 1 else "s"}</span></h2><div class="cgrid">{tiles}</div></section>'

    # BS colours are few, so they sit on the cover page; the RAL families flow after it
    sections = "".join(family(k, n) for k, n in FAMILIES if k in groups and k != "BS")
    bs_section = family("BS", dict(FAMILIES)["BS"]) if "BS" in groups else ""

    body = f"""<section class="page cpage-cover">
<header class="cv cv-short"><div class="leaf leaf-edge"></div><div class="leaf leaf-panel"></div>
<div class="fan">{"".join(f'<i style="background:{h};transform:rotate({-28 + i * 7}deg)"></i>' for i, h in enumerate(["#c1121c", "#e25303", "#f3a505", "#3b83bd", "#0E6551", "#41BDD6", "#7d7f7d", "#1e1e1e", "#f4f4f4"]))}</div>
<img class="logo" src="{LOGO}" alt="Design &amp; Supply"><div class="est">{EST}</div>
<div class="tt"><div class="kick">Colour chart</div><h1>Standard<br><em>colours.</em></h1><div class="ref">{total} colours · {len(data)} finishes · Version {VERSION} · {DATE}</div></div></header>
<div class="cb"><p class="lead">Our standard powder-coat range, finished in-house. Each colour lists the finishes we stock it in and the product reference to quote when ordering.</p>
<div class="note"><b>Please note</b><p>All colours and finishes are available, but options outside of this list may incur additional cost or an extended lead time. Printed and on-screen colours are a guide only — please check critical colour matches with our team.</p></div>
<div class="toc c-toc"><h2>Contents</h2><ol>{"".join(f"<li><b>{n}</b><span>{len(groups[k])} colour{'' if len(groups[k]) == 1 else 's'}</span></li>" for k, n in FAMILIES if k in groups and k != "BS")}</ol></div>
<div class="c-bs">{bs_section}</div></div>
<footer class="ft"><div class="l"><b>Contact us today</b><span>To discuss any colours outside of this range.</span></div><div class="r"><b>{PHONE}</b><span>{CONTACT}</span></div></footer>
</section>
<main class="cbody">{sections}</main>"""
    out = HTML / "Design-and-Supply-Standard-Colours.html"
    out.write_text(page_html("Standard Colours — Design & Supply", f'<style>@page {{ size: 210mm 297mm; margin: 0; }}</style>{body}'), encoding="utf-8")

    # Like the manual: Edge prints the flowing body with page margins, then a
    # header/folio overlay is stamped on each body page.
    import fitz
    cover_pdf, body_pdf, ov_pdf = HTML / "colours-cover.pdf", HTML / "colours-body.pdf", HTML / "colours-overlay.pdf"
    cov = HTML / "colours-cover.html"
    cov.write_text(page_html("Standard Colours", body.split("<main")[0]), encoding="utf-8")
    render(cov, cover_pdf)
    bod = HTML / "colours-body.html"
    bod.write_text(page_html("Standard Colours", '<style>@page { size: 210mm 297mm; margin: 25mm 13mm 19mm; }</style><main class="cbody">' + sections + "</main>"), encoding="utf-8")
    render(bod, body_pdf)
    bdoc = fitz.open(body_pdf)
    n = bdoc.page_count + 1
    ov = HTML / "colours-overlay.html"
    ov.write_text(page_html("Standard Colours", "<style>@page { size: 210mm 297mm; margin: 0; } html, body { background: transparent; }</style>" + "".join(
        f'<section class="ov"><div class="hb"><img src="{LOGO}" alt=""><div class="t">Standard colours</div></div>'
        f'<div class="folio"><span><b>Design &amp; Supply Ltd</b> · Colours outside this list may incur additional cost or lead time · {PHONE}</span><span class="pn">{i} / {n}</span></div></section>'
        for i in range(2, n + 1))), encoding="utf-8")
    render(ov, ov_pdf)
    odoc = fitz.open(ov_pdf)
    for i, pg in enumerate(bdoc):
        pg.show_pdf_page(pg.rect, odoc, i, overlay=True)
    doc = fitz.open(cover_pdf)
    doc.insert_pdf(bdoc)
    doc.set_metadata({"title": "Design & Supply — Standard Colours", "author": "Design & Supply Ltd",
                      "subject": "Standard powder-coat colour range", "creator": "Design & Supply Ltd", "producer": "Design & Supply Ltd"})
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="ds-colours-")) / "out.pdf"
    doc.save(tmp, garbage=4, deflate=True)
    shutil.copyfile(tmp, FILES / "DS_All_Standard_Colours.pdf")
    print(f"  DS_All_Standard_Colours.pdf  {doc.page_count} pages  {total} colours / {len(data)} finishes  {round((FILES / 'DS_All_Standard_Colours.pdf').stat().st_size / 1024)} KB")


# ---------------------------------------------------------------- manual --
# Content: content/manual.js (the same source as the web page
# /installation-guides, which build-manual.js still generates). Edge cannot
# put running headers or page numbers on flowing text, so the PDF is made in
# three parts: a full-bleed cover, the body (flowing, with page margins), and
# an overlay with the header bar and "n / N" folio for each body page, which
# is stamped onto the body before the cover is prepended.

import re as _re


def _inline(s):
    return _re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", esc(s))


def _block(b):
    t = b["type"]
    if t == "p":
        return f"<p>{_inline(b['text'])}</p>"
    if t == "list":
        return "<ul class=\"m-list\">" + "".join(f"<li>{_inline(i)}</li>" for i in b["items"]) + "</ul>"
    if t == "steps":
        return "<ol class=\"m-steps\">" + "".join(f"<li>{_inline(i)}</li>" for i in b["items"]) + "</ol>"
    if t == "warning":
        return f"<div class=\"m-warn\"><b>{esc(b.get('title') or 'Warning')}</b><p>{_inline(b['text'])}</p></div>"
    if t == "note":
        return f"<div class=\"m-note\">{_inline(b['text'])}</div>"
    if t == "confirm":
        return f"<div class=\"m-confirm\"><b>To be confirmed by Design &amp; Supply technical</b><p>{_inline(b['text'])}</p></div>"
    if t == "table":
        head = "".join(f"<th>{esc(h)}</th>" for h in b["head"])
        rows = "".join("<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in r) + "</tr>" for r in b["rows"])
        return f"<table class=\"m-table\"><thead><tr>{head}</tr></thead><tbody>{rows}</tbody></table>"
    raise ValueError(f"unknown manual block type {t}")


def build_manual():
    import fitz
    m = json.loads(subprocess.run(["node", "-e", "process.stdout.write(JSON.stringify(require('./content/manual')))"],
                                  cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True).stdout)
    ver, ref = m["version"], m["docRef"]
    title_plain = "Installation, Operation & Maintenance"

    # 1. cover
    toc = "".join(f"<li><b><span>{i + 1:02d}</span>{esc(s['title'])}</b></li>" for i, s in enumerate(m["sections"]))
    cover_html = f"""<section class="page">
<header class="cv"><div class="leaf leaf-edge"></div><div class="leaf leaf-panel"></div>
<img class="m-door" src="{(ASSETS / 'door-fire.png').as_uri()}" alt="">
<img class="logo" src="{LOGO}" alt="Design &amp; Supply"><div class="est">{EST}</div>
<div class="tt"><div class="kick">O&amp;M manual</div><h1 class="m-h1">Installation,<br>operation &amp;<br><em>maintenance.</em></h1><div class="ref">{esc(ref)} · Version {esc(ver)} · {esc(m['date'])}</div></div></header>
<div class="cb"><p class="lead">{_inline(m['strapline'])}</p>
<div class="toc m-toc"><h2>Contents</h2><ol>{toc}</ol></div></div>
<footer class="ft"><div class="l"><b>Need help on site?</b><span>Our technical team can talk an installer through any of this.</span></div><div class="r"><b>{PHONE}</b><span>{CONTACT}</span></div></footer>
</section>"""
    cov = HTML / "manual-cover.html"
    cov.write_text(page_html(title_plain, cover_html), encoding="utf-8")
    render(cov, HTML / "manual-cover.pdf")

    # 2. body
    secs = "".join(
        f"<section class=\"m-sec\"><h2><span class=\"num\">{i + 1:02d}</span>{esc(s['title'])}</h2>"
        + (f"<p class=\"m-intro\">{_inline(s['intro'])}</p>" if s.get("intro") else "")
        + "".join(_block(b) for b in s.get("blocks", [])) + "</section>"
        for i, s in enumerate(m["sections"]))
    secs += (f"<section class=\"m-sec m-help\"><h2>Need help <em>on site?</em></h2><p>Our technical team can talk an installer "
             f"through any of this. Call {PHONE} or email sales@designandsupply.co.uk.</p></section>")
    body = HTML / "manual-body.html"
    body.write_text(page_html(title_plain, f'<style>@page {{ size: 210mm 297mm; margin: 27mm 15mm 21mm; }}</style><main class="m-body">{secs}</main>'), encoding="utf-8")
    render(body, HTML / "manual-body.pdf")
    bdoc = fitz.open(HTML / "manual-body.pdf")
    total = bdoc.page_count + 1

    # 3. header bar + folio, one overlay page per body page
    ov_pages = "".join(
        f"""<section class="ov"><div class="hb"><img src="{LOGO}" alt=""><div class="t">Installation · operation · maintenance</div></div>
<div class="folio"><span><b>Design &amp; Supply Ltd</b> · {esc(ref)} · v{esc(ver)} · {PHONE}</span><span class="pn">{n} / {total}</span></div></section>"""
        for n in range(2, total + 1))
    ov = HTML / "manual-overlay.html"
    ov.write_text(page_html(title_plain, f"<style>@page {{ size: 210mm 297mm; margin: 0; }} html, body {{ background: transparent; }}</style>{ov_pages}"), encoding="utf-8")
    render(ov, HTML / "manual-overlay.pdf")
    odoc = fitz.open(HTML / "manual-overlay.pdf")
    assert odoc.page_count == bdoc.page_count, (odoc.page_count, bdoc.page_count)

    out = fitz.open(HTML / "manual-cover.pdf")
    for i, pg in enumerate(bdoc):
        pg.show_pdf_page(pg.rect, odoc, i, overlay=True)
    out.insert_pdf(bdoc)
    out.set_metadata({"title": f"Design & Supply — {title_plain} Manual", "author": "Design & Supply Ltd",
                      "subject": "Installation, operation and maintenance of steel doorsets", "creator": "Design & Supply Ltd", "producer": "Design & Supply Ltd"})
    tmp = pathlib.Path(tempfile.mkdtemp(prefix="ds-manual-")) / "out.pdf"
    out.save(tmp, deflate=True)
    target = FILES / m["pdfFilename"]
    shutil.copyfile(tmp, target)
    print(f"  {target.name}  {total} pages  {round(target.stat().st_size / 1024)} KB")


# ------------------------------------------------------------- downloads --
# Thumbnails (public/images/docs/) and the document cards on /downloads, which
# are regenerated between the <!--DOCS--> markers in public/downloads.html so
# sizes and page counts always match the files. Run `node build.js` after.

BROCHURE = "Design-and-Supply-Company-Brochure.pdf"
MANUAL = "Design-and-Supply-Installation-Operation-Maintenance-Manual.pdf"
DS = "Design-and-Supply-Data-Sheet-"
DOC_SECTIONS = [
    ("data-sheets", True, "Product data sheets", "One page per <em>doorset.</em>",
     "Sizes, key applications, benefits and the options available for each product — ready to drop into a specification or tender pack.", [
        (f"{DS}Steel-Security-Rated-SR1.pdf", "Data sheet", "Security Rated Doors — SR1", "LPCB-certified LPS 1175 SR1 steel doorsets: sizes, applications and options."),
        (f"{DS}Steel-Security-Rated-SR2.pdf", "Data sheet", "Security Rated Doors — SR2", "LPCB-certified LPS 1175 SR2 steel doorsets: sizes, applications and options."),
        (f"{DS}Steel-Security-Rated-SR3.pdf", "Data sheet", "Security Rated Doors — SR3", "LPCB-certified LPS 1175 SR3 steel doorsets: sizes, applications and options."),
        (f"{DS}Steel-Security-Rated-SR4.pdf", "Data sheet", "Security Rated Doors — SR4", "LPCB-certified LPS 1175 SR4 steel doorsets: sizes, applications and options."),
        (f"{DS}Steel-Fire-Rated-Doors.pdf", "Data sheet", "Fire Rated Doors", "Steel doorsets tested to EN 1634-1 as complete assemblies."),
        (f"{DS}Multi-Storey-Car-Park.pdf", "Data sheet", "Car Park Doors", "EN 1634-1 fire rated doorsets for multi-storey and underground car parks."),
        (f"{DS}Steel-Flood-Rated.pdf", "Data sheet", "Flood Doors", "Steel flood doors: sizes, applications and options."),
        (f"{DS}Steel-Thermal-Doors.pdf", "Data sheet", "Therma-Line Thermal Doors", "Thermally efficient doorsets with U-values as low as 1.3 W/m²K."),
        (f"{DS}Streamline-Door.pdf", "Data sheet", "Streamline Doors", "Bespoke steel doors for commercial and industrial applications."),
        (f"{DS}Slimline.pdf", "Data sheet", "Slimline Glazed Doors", "Glazed security doors to LPS 1175 SR2 and LPS 2081."),
    ]),
    ("installation", False, "Installation, operation &amp; maintenance", "Install it right. <em>Keep it right.</em>",
     "Site safety, pre-installation checks, fire and security requirements, handover, inspection schedules and troubleshooting — for installers and building managers.", [
        (MANUAL, "O&amp;M manual", "Installation, Operation &amp; Maintenance Manual", "The full manual as a PDF, for your O&amp;M handover pack."),
        ("/installation-guides", "Read online", "The Manual Online", "The same manual as a web page — easy to search and share on site."),
    ]),
    ("technical", True, "Technical information", "Cills, handing <em>and colours.</em>",
     "Confirm the cill type, handing and colour when you order. If you don’t specify a cill, the H type is supplied as standard.", [
        ("Design-and-Supply-Cill-Types.pdf", "Technical", "Cill Types", "Cill profiles A to J — what each is for and when to choose it."),
        ("Design-and-Supply-Door-Handing-Diagrams.pdf", "Technical", "Door Handing Diagrams", "Single, standard astragal and lipped flush doorsets, left and right handed."),
        ("DS_All_Standard_Colours.pdf", "Colour chart", "Standard Colours", "Our standard powder-coat colours. Talk to us about colours outside the range."),
    ]),
    ("company", False, "Company documents", "Policies.", "", [
        ("Modern_Slavery_Statement.pdf", "Policy", "Modern Slavery Statement", "Our modern slavery policy."),
    ]),
]

PDF_ICON = ('<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M12 12v6"/><path d="m9 15 3 3 3-3"/></svg>')
WEB_ICON = ('<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>')


def _thumb(pdf, out, page=0, square=False):
    import fitz
    p = fitz.open(pdf)[page]
    z = (720 if square else 640) / p.rect.width
    pix = p.get_pixmap(matrix=fitz.Matrix(z, z))
    im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if not square:
        im = im.crop((0, 0, 640, 480))
    im.save(out, quality=84, optimize=True, progressive=True)


def _meta(path):
    import fitz
    kb = path.stat().st_size / 1024
    size = f"{kb / 1024:.1f} MB" if kb >= 1024 else f"{round(kb)} KB"
    n = fitz.open(path).page_count
    return f"PDF · {size}" + (f" · {n} pages" if n > 1 else ""), n


def build_downloads():
    thumbs = ROOT / "public" / "images" / "docs"
    thumbs.mkdir(parents=True, exist_ok=True)
    _thumb(FILES / BROCHURE, thumbs / BROCHURE.replace(".pdf", ".jpg"), square=True)
    bmeta, _ = _meta(FILES / BROCHURE)
    html_out = f"""<section class="section">
  <div class="container">
    <div class="split brochure-feature">
      <a class="brochure-cover reveal" href="/files/{BROCHURE}" target="_blank" rel="noopener"><img width="720" height="720" src="/images/docs/{BROCHURE.replace('.pdf', '.jpg')}" alt="Cover of the Design &amp; Supply company brochure" loading="lazy" decoding="async"></a>
      <div class="reveal">
        <span class="kicker">Company brochure</span>
        <h2>The Design &amp; Supply <em>brochure.</em></h2>
        <p>Who we are and what we make — security, fire, thermal, flood and acoustic doorsets, Stock and Streamline doors and Slimline architectural glazing — with our accreditations, the sectors we serve and recent projects.</p>
        <div class="doc-links"><a class="btn btn-primary" href="/files/{BROCHURE}" target="_blank" rel="noopener">Download the brochure</a></div>
        <p class="doc-note">{bmeta}</p>
      </div>
    </div>
  </div>
</section>
"""
    for sid, alt, kicker, h2, intro, docs in DOC_SECTIONS:
        cards = ""
        for target, dkick, title, blurb in docs:
            if target.startswith("/"):
                thumb = MANUAL.replace(".pdf", "-online.jpg")
                _thumb(FILES / MANUAL, thumbs / thumb, page=4)
                href, meta, icon = target, "Web page", WEB_ICON
                attrs = ""
            else:
                thumb = target.replace(".pdf", ".jpg")
                _thumb(FILES / target, thumbs / thumb)
                href, (meta, _), icon = f"/files/{target}", _meta(FILES / target), PDF_ICON
                attrs = ' target="_blank" rel="noopener"'
            cards += f"""
      <a class="doc-card reveal" href="{href}"{attrs}>
        <span class="doc-thumb"><img width="640" height="480" src="/images/docs/{thumb}" alt="" loading="lazy" decoding="async"></span>
        <span class="doc-body">
          <span class="doc-kicker">{dkick}</span>
          <h3>{title}</h3>
          <span class="doc-blurb">{blurb}</span>
          <span class="doc-meta">{icon}{meta}</span>
        </span>
      </a>"""
        html_out += f"""
<section class="section{' section-alt' if alt else ''}" id="{sid}">
  <div class="container">
    <div class="section-head reveal">
      <span class="kicker">{kicker}</span>
      <h2>{h2}</h2>{f'''
      <p>{intro}</p>''' if intro else ''}
    </div>
    <div class="doc-grid">{cards}
    </div>
  </div>
</section>
"""
    page = ROOT / "public" / "downloads.html"
    s = page.read_text(encoding="utf-8")
    a, b = s.index("<!--DOCS-->") + len("<!--DOCS-->"), s.index("<!--/DOCS-->")
    page.write_text(s[:a] + "\n" + html_out + s[b:], encoding="utf-8")
    print(f"  downloads.html: {sum(len(d[5]) for d in DOC_SECTIONS) + 1} documents, thumbnails in public/images/docs/")


# ------------------------------------------------------------------ main --

BUILDERS = {"cill": build_cill, "handing": build_handing, "sheets": build_sheets, "colours": build_colours,
            "manual": build_manual, "downloads": build_downloads}

if __name__ == "__main__":
    wanted = sys.argv[1:] or list(BUILDERS)
    for name in wanted:
        print(name)
        BUILDERS[name]()
