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

const files = fs.readdirSync(PUBLIC).filter((f) => f.endsWith(".html"));
for (const file of files) {
  const fp = path.join(PUBLIC, file);
  let html = fs.readFileSync(fp, "utf8");

  // 1. Bake header/footer (marker-wrapped so re-runs replace cleanly)
  const headerBlock = `<!--HEADER-->\n${header}\n<!--/HEADER-->`;
  const footerBlock = `<!--FOOTER-->\n${footer}\n<!--/FOOTER-->`;
  if (html.includes("<!--HEADER-->")) {
    html = html.replace(/<!--HEADER-->[\s\S]*?<!--\/HEADER-->/, headerBlock);
  } else {
    html = html.replace(/<div id="header"><\/div>/, headerBlock);
  }
  if (html.includes("<!--FOOTER-->")) {
    html = html.replace(/<!--FOOTER-->[\s\S]*?<!--\/FOOTER-->/, footerBlock);
  } else {
    html = html.replace(/<footer id="footer"><\/footer>/, footerBlock);
  }

  // 2. Clean internal URLs
  html = rewriteLinks(html);

  // 3. SEO meta (once)
  if (!html.includes('property="og:title"')) {
    html = html.replace("</head>", seoBlock(file, html) + "\n</head>");
  }

  // 4. Image dimensions for CLS
  html = addImageDimensions(html);

  // 5. Cache-busted asset URLs (assets are served with a 7-day cache)
  html = html.replace(/\/css\/style\.css(\?v=[a-f0-9]+)?/g, `/css/style.css?v=${CSS_V}`);
  html = html.replace(/\/js\/main\.js(\?v=[a-f0-9]+)?/g, `/js/main.js?v=${JS_V}`);

  fs.writeFileSync(fp, html);
  console.log("built", file);
}
console.log(`\n${files.length} pages built.`);
