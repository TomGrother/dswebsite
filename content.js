/**
 * Public rendering for editable content: the News and Case Studies indexes
 * and their individual article pages, all driven by the SQLite content store.
 */
const fs = require("fs");
const path = require("path");
const express = require("express");
const store = require("./db");

const PUBLIC = path.join(__dirname, "public");
const TEMPLATES = path.join(__dirname, "templates");
const BASE = "https://designandsupply.co.uk";

const TYPES = {
  news: {
    type: "news",
    listFile: "news.html",
    label: "News",
    nav: "news",
    ctaHeading: "Questions About a Guide?",
    ctaText: "Our technical team can advise on U-values, LPS1175 ratings and flood protection for your project.",
    empty: "No articles have been published yet.",
  },
  "case-studies": {
    type: "case-study",
    listFile: "case-studies.html",
    label: "Case Studies",
    nav: "case-studies",
    ctaHeading: "Have a Similar Project?",
    ctaText: "From survey and CAD design to fabrication and nationwide installation — let's talk about your requirements.",
    empty: "No case studies have been published yet.",
  },
};

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readTemplate(file) {
  // Read per request so edits/rebuilds show up without a restart.
  return fs.readFileSync(file, "utf8");
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function urlFor(post) {
  return (post.type === "news" ? "/news/" : "/case-studies/") + post.slug;
}

/** SQLite stores "YYYY-MM-DD HH:MM:SS" (UTC); schema.org wants ISO 8601. */
function isoDate(value) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const iso = String(value).replace(" ", "T");
  return /Z$|[+-]\d{2}:\d{2}$/.test(iso) ? iso : iso + "Z";
}

function cardHtml(post) {
  const img = post.image
    ? `<div class="card-visual photo"><img src="${esc(post.image)}" alt="${esc(post.title)}" loading="lazy"></div>`
    : "";
  const meta = post.category ? `<div class="meta">${esc(post.category)}</div>` : "";
  const excerpt = post.excerpt ? `<p>${esc(post.excerpt)}</p>` : "";
  return `<a class="card post-card reveal" href="${urlFor(post)}">
        ${img}
        ${meta}
        <h3>${esc(post.title)}</h3>
        ${excerpt}
        <span class="card-link">Read more</span>
      </a>`;
}

function renderIndex(key) {
  const cfg = TYPES[key];
  const posts = store.published(cfg.type);
  const html = readTemplate(path.join(PUBLIC, cfg.listFile));
  const cards = posts.length
    ? posts.map(cardHtml).join("\n      ")
    : `<p style="color:var(--slate)">${cfg.empty}</p>`;
  return html.replace("<!--POSTS-->", cards);
}

function renderArticle(key, post) {
  const cfg = TYPES[key];
  let html = readTemplate(path.join(TEMPLATES, "article.built.html"));

  const figure = post.image
    ? `<div class="article-figure"><img src="${esc(post.image)}" alt="${esc(post.title)}"></div>`
    : "";

  // Sidebar: a few other posts of the same type
  const others = store.published(cfg.type).filter((p) => p.id !== post.id).slice(0, 4);
  const related = others.length
    ? `<div class="aside-list"><h3>More ${esc(cfg.label)}</h3><ul>${others
        .map((p) => `<li><a href="${urlFor(p)}">${esc(p.title)}</a></li>`)
        .join("")}</ul></div>`
    : "";

  const canonical = `${BASE}${urlFor(post)}`;
  const image = post.image ? (post.image.startsWith("http") ? post.image : BASE + post.image) : `${BASE}/images/products/steel.png`;

  const seo = [
    `<link rel="canonical" href="${canonical}">`,
    `<meta name="theme-color" content="#0e6551">`,
    `<meta property="og:site_name" content="Design &amp; Supply">`,
    `<meta property="og:locale" content="en_GB">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:url" content="${canonical}">`,
    `<meta property="og:title" content="${esc(post.title)}">`,
    `<meta property="og:description" content="${esc(post.excerpt || "")}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": cfg.type === "news" ? "NewsArticle" : "Article",
      headline: post.title,
      description: post.excerpt || undefined,
      image: image,
      datePublished: isoDate(post.published_at),
      dateModified: isoDate(post.updated_at || post.published_at),
      author: { "@type": "Organization", name: "Design & Supply Ltd" },
      publisher: {
        "@type": "Organization",
        name: "Design & Supply Ltd",
        logo: { "@type": "ImageObject", url: `${BASE}/images/logo.png` },
      },
      mainEntityOfPage: canonical,
    })}</script>`,
    `<script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: BASE + "/" },
        { "@type": "ListItem", position: 2, name: cfg.label, item: `${BASE}/${key}` },
        { "@type": "ListItem", position: 3, name: post.title },
      ],
    })}</script>`,
  ].join("\n");

  const breadcrumb = `<a href="/">Home</a> / <a href="/${key}">${esc(cfg.label)}</a> / ${esc(post.title)}`;

  const map = {
    "{{TITLE}}": esc(post.title),
    "{{EXCERPT}}": esc(post.excerpt || ""),
    "{{CATEGORY}}": esc(post.category || cfg.label),
    "{{DATE}}": formatDate(post.published_at),
    "{{BREADCRUMB}}": breadcrumb,
    "{{FIGURE}}": figure,
    "{{BODY}}": post.body || "",
    "{{RELATED}}": related,
    "{{NAV}}": cfg.nav,
    "{{CTA_HEADING}}": esc(cfg.ctaHeading),
    "{{CTA_TEXT}}": esc(cfg.ctaText),
  };
  for (const [k, v] of Object.entries(map)) html = html.split(k).join(v);
  return html.replace("</head>", seo + "\n</head>");
}

const router = express.Router();

for (const key of Object.keys(TYPES)) {
  const cfg = TYPES[key];

  router.get(`/${key}`, (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(renderIndex(key));
  });

  router.get(`/${key}/:slug`, (req, res, next) => {
    const post = store.getBySlug(cfg.type, req.params.slug);
    if (!post) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(renderArticle(key, post));
  });
}

module.exports = { router, urlFor, TYPES };
