# Step 4: apply the visual readings of rows the two OCR engines disagreed on,
# sanity-check every ref against its RAL number, and write the colour list.
#   py -3 docs-src/colours-extract/finalise.py <workdir>
# Writes docs-src/data/colours.json (the source for the redesigned chart).
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
work = pathlib.Path(sys.argv[1])
merged = json.loads((work / "merged.json").read_text(encoding="utf-8"))

# Read by eye from 4x renders of the original where the engines disagreed.
VISUAL = {
    (1, 3): "BS 00A01 EL303E",
    (4, 19): "RAL 5004 - Smooth Gloss SJJ04G",
    (5, 20): "RAL 5014 - Smooth Gloss SJJ14G",
    (6, 1): "RAL 5017 - Smooth Gloss SJJ17G",
    (6, 5): "RAL 5018 - Smooth Gloss SJJ18G",
    (6, 15): "RAL 5024 - Smooth Gloss SJJ24G",
    (11, 14): "RAL 7016 - Smooth Matt 0L816G",   # printed with a zero; probably SL816G — flagged to Tom
    (18, 8): "RAL 9005 - Smooth Matt MN805F",
    (19, 8): "RAL 9010 - Smooth Satin MA710E",
    (16, 9): "RAL 8017 HR - Smooth Matt HR SM8C0F",   # printed with a zero after the C
}


def parse_exact(text):
    m = re.match(r"^(RAL|BS)\s+(\S+)\s*(.*?)\s*-?\s*(.*)\s+(\S+)$", text)
    std, code = text.split()[0], text.split()[1]
    rest = text[len(std) + len(code) + 2:]
    ref = rest.split()[-1]
    mid = rest[: -len(ref)].strip()
    suffix, finish = (mid.split(" - ", 1) + [""])[:2] if " - " in mid else (mid.lstrip("- ").strip(), "")
    if mid.startswith("- "):
        suffix, finish = "", mid[2:].strip()
    return {"std": std, "code": code, "suffix": suffix.strip(), "finish": finish.strip(), "ref": ref}


out = []
for r in merged:
    key = (r["page"], r["row"])
    if key in VISUAL:
        p, src = parse_exact(VISUAL[key]), "visual"
    else:
        p, src = r["parsed"], "ocr x2"
    assert p, key
    out.append({"std": p["std"], "code": p["code"], "suffix": p["suffix"], "finish": p["finish"], "ref": p["ref"],
                "hex": r["hex"], "page": r["page"], "row": r["row"], "source": src})

# Sanity check: a ref's digits normally repeat the RAL number's last two digits.
odd = [c for c in out if c["std"] == "RAL" and c["code"][-2:] not in c["ref"]]
for c in odd:
    print(f"CHECK p{c['page']:02d} r{c['row']:02d}: {c['std']} {c['code']} {c['suffix']} - {c['finish']} {c['ref']}")
dst = HERE.parent / "data" / "colours.json"
dst.write_text(json.dumps({"source": "DS_All_Standard_Colours.pdf (original, pre-2026 redesign)", "colours": out}, indent=1, ensure_ascii=False), encoding="utf-8")
print(len(out), "colours ->", dst, "|", len(odd), "rows to check by eye")
