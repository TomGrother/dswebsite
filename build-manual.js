/**
 * Installation, Operation & Maintenance manual generator.
 *
 * ONE source of truth (content/manual.js) produces BOTH deliverables:
 *   - public/installation-guides.html  (web page, indexable + accessible)
 *   - public/files/<pdf>               (downloadable, for O&M handover packs)
 *
 * This matters: the old manual was 8 scanned images with no text at all, and
 * keeping a web page and a PDF in sync by hand is how documents drift. Run:
 *   node build-manual.js      (then `node build.js` to inject header/footer)
 *
 * pdfkit is a devDependency — the PDF is committed, so production never needs it.
 */
const fs = require("fs");
const path = require("path");
const manual = require("./content/manual");

const OUT_HTML = path.join(__dirname, "public", "installation-guides.html");
const OUT_PDF = path.join(__dirname, "public", "files", manual.pdfFilename);

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Inline formatting: **bold** only — kept deliberately minimal so the same
// source renders predictably in both HTML and PDF.
const inlineHtml = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
// h1 is authored as raw HTML (it carries the brand <em> accent), so it must NOT
// be escaped for the web page — and must be flattened to plain text for the PDF.
const rawHtml = (s) => String(s == null ? "" : s);
const plain = (s) =>
  String(s == null ? "" : s)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
const stripFmt = (s) => plain(String(s == null ? "" : s).replace(/\*\*(.+?)\*\*/g, "$1"));

/* ------------------------------------------------------------------ HTML -- */

function blockHtml(b) {
  switch (b.type) {
    case "p":
      return `<p>${inlineHtml(b.text)}</p>`;
    case "list":
      return `<ul class="check-list">${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</ul>`;
    case "steps":
      return `<ol class="man-steps">${b.items.map((i) => `<li>${inlineHtml(i)}</li>`).join("")}</ol>`;
    case "warning":
      return `<div class="man-warning"><b>${esc(b.title || "Warning")}</b><p>${inlineHtml(b.text)}</p></div>`;
    case "note":
      return `<div class="man-note">${inlineHtml(b.text)}</div>`;
    case "confirm":
      return `<div class="man-confirm"><b>To be confirmed by Design &amp; Supply technical</b><p>${inlineHtml(b.text)}</p></div>`;
    case "table":
      return `<div class="table-scroll"><table class="spec-table"><thead><tr>${b.head
        .map((h) => `<th>${esc(h)}</th>`)
        .join("")}</tr></thead><tbody>${b.rows
        .map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`;
    default:
      return "";
  }
}

function buildHtml() {
  const toc = manual.sections
    .map((s, i) => `<li><a href="#${s.id}">${i + 1}. ${esc(s.title)}</a></li>`)
    .join("");

  const body = manual.sections
    .map(
      (s, i) => `<section class="man-section" id="${s.id}">
      <h2><span class="man-num">${i + 1}</span>${esc(s.title)}</h2>
      ${s.intro ? `<p class="man-intro">${inlineHtml(s.intro)}</p>` : ""}
      ${(s.blocks || []).map(blockHtml).join("\n      ")}
    </section>`
    )
    .join("\n\n    ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(manual.metaTitle)}</title>
<meta name="description" content="${esc(manual.metaDescription)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<link rel="icon" href="/images/favicon.png">
<link rel="apple-touch-icon" sizes="180x180" href="/images/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0e6551">
</head>
<body data-page="downloads">
<!--HEADER-->
<!--/HEADER-->

<section class="page-hero">
  <div class="container">
    <div class="breadcrumb"><a href="/">Home</a> / <a href="/downloads">Downloads</a> / Installation &amp; Maintenance</div>
    <h1>${rawHtml(manual.h1)}</h1>
    <p>${inlineHtml(manual.strapline)}</p>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="man-actions">
      <a class="btn btn-primary" href="/files/${esc(manual.pdfFilename)}" rel="noopener">Download the PDF manual</a>
      <span class="man-meta">${esc(manual.docRef)} &nbsp;·&nbsp; Version ${esc(manual.version)} &nbsp;·&nbsp; ${esc(manual.date)}</span>
    </div>

    <nav class="man-toc" aria-label="Contents">
      <h2>Contents</h2>
      <ol>${toc}</ol>
    </nav>

    ${body}

    <div class="man-help">
      <h2>Need help on site?</h2>
      <p>Our technical team can talk an installer through any of this. Call <a href="tel:01685350114">01685 350 114</a> or email <a href="mailto:sales@designandsupply.co.uk">sales@designandsupply.co.uk</a>.</p>
    </div>
  </div>
</section>

<!--FOOTER-->
<!--/FOOTER-->
</body>
</html>
`;
}

/* ------------------------------------------------------------------- PDF -- */

const GREEN = "#0E6551";
const INK = "#1a2b26";
const SLATE = "#5a6b66";
const RULE = "#dfe8e5";

function buildPdf() {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 62, bottom: 64, left: 56, right: 56 },
    info: {
      Title: manual.metaTitle,
      Author: "Design & Supply Ltd",
      Subject: "Installation, operation and maintenance of steel doorsets",
      Keywords: "steel doorset, installation, maintenance, fire door, LPS 1175",
    },
  });
  doc.pipe(fs.createWriteStream(OUT_PDF));

  const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const L = doc.page.margins.left;
  let pageNo = 0;

  // Drawing the footer sits below the bottom margin, which would make pdfkit
  // auto-add another page and recurse forever. Guard with a flag and restore
  // the cursor afterwards so body flow is unaffected.
  let inChrome = false;
  const chrome = () => {
    if (inChrome) return;
    inChrome = true;
    pageNo++;
    const yBefore = doc.y;
    const bottom = doc.page.height - 42;
    doc.save();
    doc.fontSize(7.5).fillColor(SLATE).font("Helvetica");
    doc.text("Design & Supply Ltd · " + manual.docRef + " · v" + manual.version, L, bottom, {
      width: W, align: "left", lineBreak: false, height: 12,
    });
    doc.text(String(pageNo), L, bottom, { width: W, align: "right", lineBreak: false, height: 12 });
    doc.moveTo(L, bottom - 8).lineTo(L + W, bottom - 8).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.restore();
    doc.y = yBefore;
    inChrome = false;
  };
  doc.on("pageAdded", chrome);

  // ---- cover
  doc.rect(0, 0, doc.page.width, 190).fill(GREEN);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(27)
    .text("DESIGN & SUPPLY", L, 56, { width: W, characterSpacing: 1.4 });
  doc.font("Helvetica").fontSize(11.5)
    .text("Door Specialists · Merthyr Tydfil · Established 1986", L, 92, { width: W, characterSpacing: 0.6 });
  doc.font("Helvetica-Bold").fontSize(15)
    .text(stripFmt(manual.h1).toUpperCase(), L, 132, { width: W, characterSpacing: 0.8 });
  chrome();

  doc.fillColor(INK).font("Helvetica").fontSize(11.5)
    .text(stripFmt(manual.strapline), L, 224, { width: W, lineGap: 3.5 });

  doc.moveDown(1.4);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(SLATE)
    .text(`${manual.docRef}   |   VERSION ${manual.version}   |   ${manual.date}`, { characterSpacing: 0.5 });

  // contents
  doc.moveDown(1.6);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(GREEN).text("Contents");
  doc.moveDown(0.55);
  manual.sections.forEach((s, i) => {
    doc.font("Helvetica").fontSize(10).fillColor(INK)
      .text(`${i + 1}.  ${s.title}`, { indent: 6, lineGap: 2.6 });
  });

  // ---- body
  const space = (need) => {
    if (doc.y + need > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };
  const para = (t, o = {}) => {
    space(46);
    doc.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size || 10)
      .fillColor(o.color || INK)
      .text(stripFmt(t), { width: W, lineGap: o.lineGap == null ? 2.6 : o.lineGap, indent: o.indent || 0 });
  };

  const panel = (title, text, bg, border, titleColor) => {
    const inner = W - 22;
    doc.font("Helvetica-Bold").fontSize(9.5);
    const th = title ? doc.heightOfString(title, { width: inner }) + 3 : 0;
    doc.font("Helvetica").fontSize(9.5);
    const bh = doc.heightOfString(stripFmt(text), { width: inner, lineGap: 2.2 });
    const h = th + bh + 20;
    space(h + 10);
    const top = doc.y;
    doc.save().roundedRect(L, top, W, h, 5).fillOpacity(1).fill(bg)
      .roundedRect(L, top, W, h, 5).lineWidth(0.8).strokeColor(border).stroke().restore();
    let y = top + 10;
    if (title) {
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(titleColor)
        .text(title, L + 11, y, { width: inner });
      y = doc.y + 3;
    }
    doc.font("Helvetica").fontSize(9.5).fillColor(INK)
      .text(stripFmt(text), L + 11, y, { width: inner, lineGap: 2.2 });
    doc.y = top + h + 11;
  };

  manual.sections.forEach((s, i) => {
    space(96);
    doc.moveDown(0.9);
    doc.font("Helvetica-Bold").fontSize(14).fillColor(GREEN)
      .text(`${i + 1}.  ${s.title}`, { width: W });
    doc.moveTo(L, doc.y + 4).lineTo(L + W, doc.y + 4).lineWidth(1).strokeColor(GREEN).stroke();
    doc.moveDown(0.75);
    if (s.intro) { para(s.intro, { color: SLATE }); doc.moveDown(0.35); }

    (s.blocks || []).forEach((b) => {
      switch (b.type) {
        case "p":
          para(b.text); doc.moveDown(0.42); break;
        case "list":
          b.items.forEach((it) => {
            space(34);
            const y0 = doc.y;
            doc.font("Helvetica-Bold").fontSize(10).fillColor(GREEN).text("•", L + 3, y0, { lineBreak: false });
            doc.font("Helvetica").fontSize(10).fillColor(INK)
              .text(stripFmt(it), L + 16, y0, { width: W - 16, lineGap: 2.4 });
            doc.moveDown(0.28);
          });
          doc.moveDown(0.32); break;
        case "steps":
          b.items.forEach((it, n) => {
            space(34);
            const y0 = doc.y;
            doc.font("Helvetica-Bold").fontSize(10).fillColor(GREEN)
              .text(`${n + 1}.`, L + 2, y0, { width: 18, lineBreak: false });
            doc.font("Helvetica").fontSize(10).fillColor(INK)
              .text(stripFmt(it), L + 22, y0, { width: W - 22, lineGap: 2.4 });
            doc.moveDown(0.3);
          });
          doc.moveDown(0.32); break;
        case "warning":
          panel(b.title || "Warning", b.text, "#fff3ec", "#f2c4a3", "#9a3412"); break;
        case "note":
          panel(null, b.text, "#f2f7f5", RULE, SLATE); break;
        case "confirm":
          panel("To be confirmed by Design & Supply technical", b.text, "#fdf3e2", "#ebc98a", "#8a5a12"); break;
        case "table": {
          const cols = b.head.length;
          const cw = W / cols;
          space(70);
          let y = doc.y;
          doc.save().rect(L, y, W, 20).fill(GREEN).restore();
          b.head.forEach((h, c) => {
            doc.font("Helvetica-Bold").fontSize(8.6).fillColor("#fff")
              .text(h, L + c * cw + 7, y + 6, { width: cw - 12, lineBreak: false });
          });
          y += 20;
          b.rows.forEach((r, ri) => {
            doc.font("Helvetica").fontSize(9);
            const hs = r.map((c, ci) => doc.heightOfString(stripFmt(c), { width: cw - 14, lineGap: 1.8 }));
            const rh = Math.max(...hs) + 11;
            if (y + rh > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = doc.y; }
            if (ri % 2 === 0) doc.save().rect(L, y, W, rh).fill("#f7faf9").restore();
            r.forEach((c, ci) => {
              doc.font("Helvetica").fontSize(9).fillColor(INK)
                .text(stripFmt(c), L + ci * cw + 7, y + 5, { width: cw - 14, lineGap: 1.8 });
            });
            doc.moveTo(L, y + rh).lineTo(L + W, y + rh).lineWidth(0.4).strokeColor(RULE).stroke();
            y += rh;
          });
          doc.y = y + 12;
          break;
        }
      }
    });
  });

  // ---- back page
  doc.addPage();
  doc.font("Helvetica-Bold").fontSize(14).fillColor(GREEN).text("Technical support", { width: W });
  doc.moveDown(0.5);
  para("Our technical team can talk an installer through any part of this document.");
  doc.moveDown(0.5);
  para("Design & Supply Ltd\n13 Pant Industrial Estate, Merthyr Tydfil, Mid Glamorgan, CF48 2SR\n01685 350 114\nsales@designandsupply.co.uk\ndesignandsupply.co.uk", { lineGap: 3.4 });

  doc.end();
  return new Promise((res) => doc.on("end", res));
}

/* ------------------------------------------------------------------ main -- */
(async () => {
  fs.writeFileSync(OUT_HTML, buildHtml(), "utf8");
  console.log("wrote", path.relative(__dirname, OUT_HTML));
  await buildPdf();
  const kb = Math.round(fs.statSync(OUT_PDF).size / 1024);
  console.log("wrote", path.relative(__dirname, OUT_PDF), `(${kb}KB)`);
  const words = manual.sections.reduce(
    (n, s) => n + (s.blocks || []).reduce((m, b) =>
      m + String(b.text || (b.items || []).join(" ") || (b.rows || []).flat().join(" ")).split(/\s+/).length, 0), 0);
  console.log("sections:", manual.sections.length, "| approx words:", words);
})();
