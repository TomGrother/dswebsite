# Step 3: match both OCR passes to the swatch rows, normalise each field by
# its format, and accept a row only where the two engines agree.
#   py -3 docs-src/colours-extract/merge.py <workdir>
# Writes <workdir>/merged.json and prints the rows that need a visual check.
import json
import pathlib
import re
import sys

work = pathlib.Path(sys.argv[1])
rows = json.loads((work / "rows.json").read_text())
ocr = {
    "win": json.loads((work / "ocr_windows.json").read_text(encoding="utf-8-sig")),
    "tes": json.loads((work / "ocr_tesseract.json").read_text(encoding="utf-8")),
}

TO_DIGIT = str.maketrans({"O": "0", "o": "0", "D": "0", "Q": "0", "I": "1", "l": "1", "|": "1", "i": "1", "Z": "2", "S": "5", "B": "8", "G": "6"})
TO_LETTER = str.maketrans({"0": "O", "1": "I", "5": "S", "8": "B", "2": "Z", "6": "G"})
FINISH_WORDS = {"smooth", "matt", "gloss", "satin", "fine", "texture", "coarse", "hr", "semi", "metallic", "sand", "hammer", "structure", "low", "sheen", "silk", "eggshell", "antique", "wrinkle", "pearl"}


def norm_ref(tok):
    """Supplier product ref: 2-3 letters, 2-3 digits, then 1-2 letters (e.g. SA716JR, SNJ17G, NLB04I)."""
    # tesseract reads J as ) ] or |; lowercase l in a ref is always I
    t = tok.replace(")J", "J").replace("]J", "J").replace("|J", "J")
    t = t.replace(")", "J").replace("]", "J").replace("|", "J").replace("l", "I").upper().replace(" ", "")
    head = t[:2].translate(TO_LETTER)
    rest = t[2:]
    third = ""
    if rest and rest[0] in "JBA":
        third, rest = rest[0], rest[1:]
    # the suffix is one of a few known endings; everything before it is digits
    for tail in ("JR", "GF", "G", "E", "F", "D", "L"):
        if rest.endswith(tail) and 2 <= len(rest) - len(tail) <= 3:
            break
    else:
        tail = "I" if rest[-1:] in ("I", "1") else ""
    digits = rest[: len(rest) - len(tail)].translate(TO_DIGIT)
    if not (tail and re.fullmatch(r"\d{2,3}", digits)):
        return t   # leave as read; the engines will disagree and it goes to visual review
    return head + third + digits + tail


def norm_code(std, code):
    if std == "RAL":
        return code.translate(TO_DIGIT)[:4]
    if std == "BS":   # BS 4800: 2 digits, letter, 2 digits
        c = code.upper()
        if len(c) == 5:
            return c[:2].translate(TO_DIGIT) + c[2].translate(TO_LETTER) + c[3:].translate(TO_DIGIT)
    return code


def parse(text):
    t = re.sub(r"\s+", " ", text.replace("—", "-").replace("–", "-")).strip()
    m = re.match(r"^(RAL|BS|NCS)\s+(\S+)\s*(.*)$", t, re.I)
    if not m:
        return None
    std, code, rest = m.group(1).upper(), m.group(2), m.group(3)
    toks = rest.replace(" - ", " | ").replace("- ", "| ").split()
    ref = toks[-1] if toks else ""
    mid = " ".join(toks[:-1]).replace("|", "-").strip()
    suffix, finish = mid, ""
    if "-" in mid:
        suffix, finish = [s.strip() for s in mid.split("-", 1)]
    finish = " ".join(w.capitalize() if w.lower() != "hr" else "HR" for w in finish.split())
    suffix = suffix.upper().replace("0", "O")
    return {"std": std, "code": norm_code(std, code), "suffix": suffix, "finish": finish, "ref": norm_ref(ref)}


def lines_for(engine, page, py0, py1):
    out = []
    for p in ocr[engine]:
        if p["page"] != page:
            continue
        for l in p["lines"]:
            yc = l["y"] + l["h"] / 2
            if py0 - 6 <= yc <= py1 + 6:
                out.append(l)
    return sorted(out, key=lambda l: (l.get("x", 0), l["y"]))


merged, review = [], []
for r in rows:
    got = {}
    for e in ocr:
        ls = lines_for(e, r["page"], r["py0"], r["py1"])
        got[e] = " ".join(l["text"] for l in ls)
    pw, pt = parse(got["win"]), parse(got["tes"])
    ok = pw is not None and pw == pt
    rec = dict(r, win=got["win"], tes=got["tes"], parsed=pw if ok else None, a=pw, b=pt)
    merged.append(rec)
    if not ok:
        review.append(rec)

(work / "merged.json").write_text(json.dumps(merged, indent=1, ensure_ascii=False))
print(f"{len(merged) - len(review)}/{len(merged)} rows agree; {len(review)} need a visual check")
for r in review:
    print(f"p{r['page']:02d} r{r['row']:02d} | WIN: {r['win']!r:58} | TES: {r['tes']!r}")
