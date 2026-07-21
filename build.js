/**
 * Build script: bakes shared header/footer into every page (SEO-crawlable nav),
 * rewrites internal links to clean extensionless URLs, injects social/canonical
 * meta tags, and adds width/height to images to prevent layout shift.
 *
 * Run after editing partials/ or adding pages:  node build.js
 * Idempotent — safe to run repeatedly.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PUBLIC = path.join(__dirname, "public");
const BASE = "https://designandsupply.co.uk";

// Company age, recomputed on every build so "N years" never goes stale. Every
// "NN years / NN+ years / NN Years" on the site is this founding-age claim.
const FOUNDED = 1986;
const YEARS = new Date().getFullYear() - FOUNDED;
function updateYears(html) {
  return html
    .replace(/\b\d{1,3}(\+)? (years|Years)\b/g, (m, plus, word) => `${YEARS}${plus || ""} ${word}`)
    // Home hero stat: <b>40+</b><span>Years of UK manufacturing</span>
    .replace(/<b>\d{1,3}\+<\/b>(<span>Years of UK manufacturing)/g, `<b>${YEARS}+</b>$1`);
}

function assetHash(rel) {
  return crypto.createHash("md5").update(fs.readFileSync(path.join(PUBLIC, rel))).digest("hex").slice(0, 10);
}
const CSS_V = assetHash("css/style.css");
const JS_V = assetHash("js/main.js");

const header = fs.readFileSync(path.join(__dirname, "partials", "header.html"), "utf8").trim();
const footer = fs.readFileSync(path.join(__dirname, "partials", "footer.html"), "utf8").trim();

const OG_IMAGE = {
  "index.html": "/images/products/steel.png",
  "shop.html": "/images/shop/IMG_3547-Cutout-600x800.png",
  "products.html": "/images/products/steel.png",
  "steel-doors.html": "/images/doors/cat-security.png",
  "security-doors.html": "/images/doors/security-main.png",
  "fire-doors.html": "/images/doors/fire-main.png",
  "thermal-doors.html": "/images/doors/thermal-main.png",
  "flood-doors.html": "/images/doors/flood-main.png",
  "acoustic-doors.html": "/images/doors/acoustic-main.png",
  "stock-doors.html": "/images/doors/stock-main.png",
  "streamline-doors.html": "/images/doors/streamline-main.png",
  "slimline.html": "/images/products/slimline.png",
  "slimline-security.html": "/images/slimline/janisol.png",
  "slimline-fire.html": "/images/slimline/janisol-2.png",
  "slimline-non-rated.html": "/images/slimline/janisol.png",
};
const DEFAULT_OG_IMAGE = "/images/products/steel.png";

function imageSize(file) {
  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }
  // PNG
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

function rewriteLinks(html) {
  return html.replace(/(href|src)="(?!https?:|mailto:|tel:|\/|#|data:)([^"]+)"/g, (m, attr, url) => {
    let out = url.replace(/\.html(?=#|$)/, "");
    if (out === "index") out = "";
    else if (out.startsWith("index#")) out = out.slice("index".length);
    return `${attr}="/${out}"`;
  });
}

function slugOf(file) {
  if (file === "index.html") return "/";
  return "/" + file.replace(/\.html$/, "");
}

function extract(html, re) {
  const m = html.match(re);
  return m ? m[1].trim() : "";
}

function seoBlock(file, html) {
  const title = extract(html, /<title>([\s\S]*?)<\/title>/i);
  const desc = extract(html, /<meta name="description" content="([^"]*)"/i);
  const slug = slugOf(file);
  const ogImage = BASE + (OG_IMAGE[file] || DEFAULT_OG_IMAGE);
  const type = file === "shop.html" ? "product" : "website";
  return [
    `<meta name="theme-color" content="#0e6551">`,
    `<link rel="canonical" href="${BASE}${slug}">`,
    `<meta property="og:site_name" content="Design &amp; Supply">`,
    `<meta property="og:locale" content="en_GB">`,
    `<meta property="og:type" content="${type}">`,
    `<meta property="og:url" content="${BASE}${slug}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:image" content="${ogImage}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join("\n");
}

// apple-touch-icon + web manifest for every page. Added right after the
// existing favicon <link>, once (idempotent).
const HEAD_ICONS = [
  `<link rel="apple-touch-icon" sizes="180x180" href="/images/apple-touch-icon.png">`,
  `<link rel="manifest" href="/site.webmanifest">`,
].join("\n");

function addHeadIcons(html) {
  if (html.includes('rel="manifest"')) return html;
  return html.replace(/(<link rel="icon"[^>]*>)/, `$1\n${HEAD_ICONS}`);
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Build BreadcrumbList JSON-LD from the visible .breadcrumb trail, so search
// engines can show the breadcrumb path in results.
function breadcrumbSchema(html) {
  const m = html.match(/<div class="breadcrumb">([\s\S]*?)<\/div>/);
  if (!m) return "";
  const inner = m[1];
  const items = [];
  // Each <a href="x">Label</a> becomes a linked crumb; the trailing plain
  // text after the last "/" becomes the current (unlinked) page.
  const anchorRe = /<a href="([^"]+)">([\s\S]*?)<\/a>/g;
  let am;
  while ((am = anchorRe.exec(inner)) !== null) {
    items.push({ name: decodeEntities(am[2].replace(/<[^>]+>/g, "").trim()), item: am[1] });
  }
  const tail = inner.replace(/<a href="[^"]+">[\s\S]*?<\/a>/g, "").replace(/\//g, " ").replace(/<[^>]+>/g, "").trim();
  if (tail) items.push({ name: decodeEntities(tail), item: null });
  if (items.length < 2) return "";
  const list = items.map((it, i) => {
    const entry = { "@type": "ListItem", position: i + 1, name: it.name };
    if (it.item) entry.item = it.item.startsWith("http") ? it.item : BASE + it.item;
    return entry;
  });
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: list,
  })}</script>`;
}

function addImageDimensions(html) {
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    if (/\bwidth=/.test(tag)) return tag;
    const src = (tag.match(/src="(\/images\/[^"]+)"/) || [])[1];
    if (!src) return tag;
    const dims = imageSize(path.join(PUBLIC, src.replace(/^\//, "")));
    if (!dims) return tag;
    return tag.replace("<img ", `<img width="${dims.width}" height="${dims.height}" `);
  });
}

const HEADER_BLOCK = `<!--HEADER-->\n${header}\n<!--/HEADER-->`;
const FOOTER_BLOCK = `<!--FOOTER-->\n${footer}\n<!--/FOOTER-->`;

function bakeShell(html) {
  if (html.includes("<!--HEADER-->")) {
    html = html.replace(/<!--HEADER-->[\s\S]*?<!--\/HEADER-->/, HEADER_BLOCK);
  } else {
    html = html.replace(/<div id="header"><\/div>/, HEADER_BLOCK);
  }
  if (html.includes("<!--FOOTER-->")) {
    html = html.replace(/<!--FOOTER-->[\s\S]*?<!--\/FOOTER-->/, FOOTER_BLOCK);
  } else {
    html = html.replace(/<footer id="footer"><\/footer>/, FOOTER_BLOCK);
  }
  return html;
}

function bustAssets(html) {
  return html
    .replace(/\/css\/style\.css(\?v=[a-f0-9]+)?/g, `/css/style.css?v=${CSS_V}`)
    .replace(/\/js\/main\.js(\?v=[a-f0-9]+)?/g, `/js/main.js?v=${JS_V}`);
}

const files = fs.readdirSync(PUBLIC).filter((f) => f.endsWith(".html"));
for (const file of files) {
  const fp = path.join(PUBLIC, file);
  let html = fs.readFileSync(fp, "utf8");

  html = bakeShell(html);
  html = rewriteLinks(html);

  // SEO meta (once)
  if (!html.includes('property="og:title"')) {
    html = html.replace("</head>", seoBlock(file, html) + "\n</head>");
  }

  html = addHeadIcons(html);

  // BreadcrumbList schema (once), just before </body>
  if (!html.includes('"BreadcrumbList"')) {
    const crumbs = breadcrumbSchema(html);
    if (crumbs) html = html.replace("</body>", crumbs + "\n</body>");
  }

  html = addImageDimensions(html);
  html = bustAssets(html);
  html = updateYears(html); // after bakeShell so the injected footer updates too

  fs.writeFileSync(fp, html);
  console.log("built", file);
}

// Article template: same shell/link/asset treatment, but no per-page SEO block
// (the server injects canonical/OG per article at request time).
const TEMPLATES = path.join(__dirname, "templates");
if (fs.existsSync(path.join(TEMPLATES, "article.html"))) {
  let tpl = fs.readFileSync(path.join(TEMPLATES, "article.html"), "utf8");
  tpl = updateYears(addHeadIcons(bustAssets(rewriteLinks(bakeShell(tpl)))));
  fs.writeFileSync(path.join(TEMPLATES, "article.built.html"), tpl);
  console.log("built templates/article.built.html");
}

console.log(`\n${files.length} pages built. (Company age: ${YEARS} years since ${FOUNDED}.)`);
