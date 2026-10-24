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
 * The PDF is printed by docs-src/build_docs.py (brand document design); it is
 * committed, so production never builds it.
 */
const fs = require("fs");
const path = require("path");
const manual = require("./content/manual");

const OUT_HTML = path.join(__dirname, "public", "installation-guides.html");

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Inline formatting: **bold** only — kept deliberately minimal so the same
// source renders predictably in both HTML and PDF.
const inlineHtml = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
// h1 is authored as raw HTML (it carries the brand <em> accent), so it must NOT
// be escaped for the web page.
const rawHtml = (s) => String(s == null ? "" : s);

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

/* ------------------------------------------------------------------ main -- */
fs.writeFileSync(OUT_HTML, buildHtml(), "utf8");
console.log("wrote", path.relative(__dirname, OUT_HTML));
// The PDF uses the brand document design shared with the data sheets and
// technical documents, so it is built by docs-src/build_docs.py from this
// same content/manual.js.
const r = require("child_process").spawnSync("py", ["-3", path.join(__dirname, "docs-src", "build_docs.py"), "manual"], { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status || 1);
const words = manual.sections.reduce(
  (n, s) => n + (s.blocks || []).reduce((m, b) =>
    m + String(b.text || (b.items || []).join(" ") || (b.rows || []).flat().join(" ")).split(/\s+/).length, 0), 0);
console.log("sections:", manual.sections.length, "| approx words:", words);
