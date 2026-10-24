/**
 * Technical-information PDF generator: composes the branded "Cill Types" and
 * "Door Handing Diagrams" documents for the downloads page from the artwork
 * in content/tech-docs/ (extracted from the legacy CAD sheets by
 * tools/extract-tech-images.py — re-run that only if a source drawing in
 * public/files/ changes, then run this).
 *
 *   node build-tech-docs.js
 *
 * House style matches build-manual.js (same colours, chrome and cover).
 * pdfkit is a devDependency — the PDFs are committed, so production never
 * needs it. Descriptions are the original sheets' wording (typos fixed),
 * so the single source of technical truth stays the drawings themselves.
 */
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const ART = path.join(__dirname, "content", "tech-docs");
const FILES = path.join(__dirname, "public", "files");

const GREEN = "#0E6551";
const INK = "#1a2b26";
const SLATE = "#5a6b66";
const RULE = "#dfe8e5";
const VERSION = "1.0";
const DATE = "October 2026";

/* ---------------------------------------------------------------- content -- */

const CILLS = [
  { t: "A", text: "This type of cill is used when perhaps the floor outside is raised. Using this cill will allow the door to swing freely open without being obstructed by the outside floor." },
  { t: "B", text: "This type of cill is only ever used on an inward opening door. The cill is fitted in the rebate of the frame, with the slope running down towards the outside. Thus if any rain runs down the door onto the cill it will then run down the slope of the cill and onto the outside floor." },
  { t: "C", text: "This type of cill is commonly used on doors where perhaps wheelchairs, trolleys, etc are common traffic through the doors." },
  { t: "D", text: "This type of cill is commonly used on doors where perhaps wheelchairs, trolleys, etc are common traffic through the doors." },
  { t: "E", text: "This type of cill is a 6mm flat bar cill which sits directly under the frame. This cill is particularly good when the floor isn't finished or is uneven or crumbly. Please note that this cill is not standard and is chargeable.", badge: "NON-STANDARD · CHARGEABLE" },
  { t: "F", text: "This type of cill sits at the back of the frame. A good cill to choose if a flat low-level cill is required, also if a panic bolt is being used on the door." },
  { t: "G", text: "This type of cill is an aluminium cill with a neoprene seal; it is not a standard cill and is therefore chargeable. It is commonly used on doors where wheelchairs, trolleys, etc are common traffic through the doors.", badge: "NON-STANDARD · CHARGEABLE" },
  { t: "H", text: "This type of cill is our most popular of all the cills. It is similar to the 'F' type but it has a leading face which fits under the door. Good for every kind of purpose, particularly panic bolts. If you do not specify a different cill, this will come as standard.", badge: "SUPPLIED AS STANDARD" },
  { t: "J", text: "This type of cill has a sloping leading face which fits under the door." },
];

const HANDING = [
  {
    title: "Single Door-Sets",
    img: "handing_singles.png",
    text: "Each arrangement is drawn in plan with the inside at the top — hinge side and direction of opening as captioned.",
  },
  {
    title: "Standard Astragal — Single & Double Doors",
    img: "astragal.png",
    text: "Plan sections through standard astragal doorsets, left and right handed.",
  },
  {
    title: "Lipped Flush Doors",
    img: "lipped_flush.png",
    text: "Plan sections through lipped flush doorsets, left and right handed.",
  },
];

/* ---------------------------------------------------------------- helpers -- */

// PNG pixel size straight from the IHDR chunk (avoids a dependency).
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

function newDoc(outName, info) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 62, bottom: 64, left: 56, right: 56 },
    info: Object.assign({ Author: "Design & Supply Ltd" }, info),
  });
  doc.pipe(fs.createWriteStream(path.join(FILES, outName)));
  return doc;
}

function makeChrome(doc, docRef) {
  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const L = doc.page.margins.left;
  let pageNo = 0;
  let inChrome = false;
  const chrome = () => {
    if (inChrome) return;
    inChrome = true;
    pageNo++;
    const yBefore = doc.y;
    const bottom = doc.page.height - 42;
    doc.save();
    doc.fontSize(7.5).fillColor(SLATE).font("Helvetica");
    doc.text("Design & Supply Ltd · " + docRef + " · v" + VERSION, L, bottom, {
      width: W, align: "left", lineBreak: false, height: 12,
    });
    doc.text(String(pageNo), L, bottom, { width: W, align: "right", lineBreak: false, height: 12 });
    doc.moveTo(L, bottom - 8).lineTo(L + W, bottom - 8).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.restore();
    doc.y = yBefore;
    inChrome = false;
  };
  doc.on("pageAdded", chrome);
  return { W, L, chrome };
}

function cover(doc, { W, L, chrome }, title, intro, docRef) {
  doc.rect(0, 0, doc.page.width, 190).fill(GREEN);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(27)
    .text("DESIGN & SUPPLY", L, 56, { width: W, characterSpacing: 1.4 });
  doc.font("Helvetica").fontSize(11.5)
    .text("Door Specialists · Merthyr Tydfil · Established 1986", L, 92, { width: W, characterSpacing: 0.6 });
  doc.font("Helvetica-Bold").fontSize(15)
    .text(title.toUpperCase(), L, 132, { width: W, characterSpacing: 0.8 });
  chrome();
  doc.fillColor(INK).font("Helvetica").fontSize(11.5).text(intro, L, 224, { width: W, lineGap: 3.5 });
  doc.moveDown(1.4);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(SLATE)
    .text(`${docRef}   |   VERSION ${VERSION}   |   ${DATE}`, { characterSpacing: 0.5 });
}

function orderingNote(doc, { W, L }, text) {
  doc.moveDown(1.6);
  const y0 = doc.y;
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GREEN)
    .text("ORDERING", L + 14, y0 + 12, { width: W - 28, characterSpacing: 0.8 });
  doc.font("Helvetica").fontSize(10).fillColor(INK)
    .text(text, L + 14, doc.y + 3, { width: W - 28, lineGap: 2.5 });
  const y1 = doc.y + 12;
  doc.rect(L, y0, W, y1 - y0).lineWidth(1).strokeColor(RULE).stroke();
  doc.rect(L, y0, 3, y1 - y0).fill(GREEN);
  doc.y = y1;
}

function heading(doc, { W, L }, text) {
  doc.font("Helvetica-Bold").fontSize(14).fillColor(GREEN).text(text, L, doc.y, { width: W });
  doc.moveTo(L, doc.y + 4).lineTo(L + W, doc.y + 4).lineWidth(1).strokeColor(GREEN).stroke();
  doc.y += 16;
}

// Draw an image centred in the given box, scaled from its true pixel size.
function placeImage(doc, { L }, file, maxW, maxH) {
  const p = path.join(ART, file);
  const { w, h } = pngSize(p);
  const s = Math.min(maxW / w, maxH / h, 72 / 288); // never above its 288-dpi print size
  const dw = w * s, dh = h * s;
  doc.image(p, L + (maxW - dw) / 2, doc.y + (maxH - dh) / 2, { width: dw, height: dh });
  doc.y += maxH;
}

/* ------------------------------------------------------------- cill types -- */

function buildCills() {
  const doc = newDoc("Design-and-Supply-Cill-Types.pdf", {
    Title: "Cill Types — Design & Supply Steel Doorsets",
    Subject: "Standard cill profiles for steel doorsets, types A to J",
    Keywords: "steel doorset, cill, sill, threshold, section",
  });
  const g = makeChrome(doc, "DS-TEC-CILL");

  cover(
    doc, g, "Cill Types",
    "The standard cill profiles for Design & Supply steel doorsets — what each type is for, " +
    "when to choose it, and its section dimensions. One page per cill, types A to J.",
    "DS-TEC-CILL"
  );
  orderingNote(doc, g,
    "Please quote the cill type when ordering. Handings and sizes must be confirmed when ordering. " +
    "If you do not specify a cill, the H type is supplied as standard.");

  doc.moveDown(1.6);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(GREEN).text("Contents", g.L);
  doc.moveDown(0.55);
  CILLS.forEach((c) => {
    doc.font("Helvetica").fontSize(10).fillColor(INK)
      .text(`Cill Type ${c.t}${c.badge ? "  —  " + c.badge.toLowerCase() : ""}`, { indent: 6, lineGap: 2.6 });
  });
  doc.font("Helvetica").fontSize(9).fillColor(SLATE).moveDown(1.2)
    .text("Contact: 01685 350 114 · sales@designandsupply.co.uk · designandsupply.co.uk", g.L, doc.y, { width: g.W });

  for (const c of CILLS) {
    doc.addPage();
    heading(doc, g, `Cill Type ${c.t}`);
    if (c.badge) {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(GREEN).text(c.badge, g.L, doc.y, { characterSpacing: 0.8 });
      doc.moveDown(0.5);
    }
    doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(c.text, g.L, doc.y, { width: g.W, lineGap: 3 });
    doc.y += 26;
    const maxH = doc.page.height - doc.page.margins.bottom - doc.y - 10;
    placeImage(doc, g, `cill_${c.t}.png`, g.W, maxH);
  }

  doc.end();
  console.log("built Design-and-Supply-Cill-Types.pdf");
}

/* ------------------------------------------------------- handing diagrams -- */

function buildHanding() {
  const doc = newDoc("Design-and-Supply-Door-Handing-Diagrams.pdf", {
    Title: "Door Handing Diagrams — Design & Supply Steel Doorsets",
    Subject: "Handing of single and double steel doorsets",
    Keywords: "steel doorset, door handing, left handed, right handed, astragal, lipped flush",
  });
  const g = makeChrome(doc, "DS-TEC-HAND");

  cover(
    doc, g, "Door Handing Diagrams",
    "How Design & Supply doorsets are handed — single door-sets, standard astragal doubles " +
    "and lipped flush doors, each drawn left and right handed.",
    "DS-TEC-HAND"
  );
  orderingNote(doc, g,
    "Handings must be confirmed when ordering. If you are unsure, send photographs or a sketch " +
    "with your enquiry and our team will confirm the handing on your order acknowledgement.");

  doc.moveDown(1.6);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(GREEN).text("Contents", g.L);
  doc.moveDown(0.55);
  HANDING.forEach((s) => {
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(s.title, { indent: 6, lineGap: 2.6 });
  });
  doc.font("Helvetica").fontSize(9).fillColor(SLATE).moveDown(1.2)
    .text("Contact: 01685 350 114 · sales@designandsupply.co.uk · designandsupply.co.uk", g.L, doc.y, { width: g.W });

  for (const s of HANDING) {
    doc.addPage();
    heading(doc, g, s.title);
    doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(s.text, g.L, doc.y, { width: g.W, lineGap: 3 });
    doc.y += 22;
    const maxH = doc.page.height - doc.page.margins.bottom - doc.y - 10;
    placeImage(doc, g, s.img, g.W, maxH);
  }

  doc.end();
  console.log("built Design-and-Supply-Door-Handing-Diagrams.pdf");
}

buildCills();
buildHanding();
