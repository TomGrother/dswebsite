/**
 * One-off content import: loads the scraped news / case study JSON into the
 * SQLite store. Idempotent — an existing slug is updated, not duplicated.
 *
 * Usage: node seed.js
 */
const fs = require("fs");
const path = require("path");
const store = require("./db");

const DATA = path.join(__dirname, "data");

// Map scraped articles onto the images already downloaded into the repo,
// so posts use local assets rather than hot-linking the old WordPress site.
const IMAGE_BY_KEYWORD = [
  [/buy-?out|management/i, "/images/news/mbo.jpg"],
  [/sports/i, "/images/news/sports.jpg"],
  [/car park/i, "/images/news/carpark.png"],
  [/uktc/i, "/images/news/uktc.png"],
  [/insulated/i, "/images/news/insulated.png"],
  [/u-?value/i, "/images/news/uvalue.png"],
  [/therma|thermal steel/i, "/images/news/thermal-launch.png"],
  [/flood/i, "/images/news/flood-guide.png"],
  [/lps ?1175/i, "/images/news/lps1175.png"],
  [/watling/i, "/images/cases/watling.jpeg"],
  [/temple quarter|bristol|tqec/i, "/images/cases/tqec.jpg"],
  [/ebbw/i, "/images/cases/ebbw-vale.png"],
  [/fish island/i, "/images/cases/fish-island.jpg"],
  [/delphi|tenby/i, "/images/cases/tenby.jpg"],
  [/silverstone/i, "/images/cases/silverstone.jpg"],
];

function localImageFor(title, fallback) {
  for (const [re, img] of IMAGE_BY_KEYWORD) {
    if (re.test(title) && fs.existsSync(path.join(__dirname, "public", img))) return img;
  }
  // Keep a scraped absolute URL only if we have nothing local
  return fallback || null;
}

function load(file) {
  const fp = path.join(DATA, file);
  if (!fs.existsSync(fp)) {
    console.warn(`! ${file} not found — skipping`);
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(fp, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error(`! ${file} is not valid JSON: ${e.message}`);
    return [];
  }
}

function importAll(items, type) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  items.forEach((item, i) => {
    if (!item || !item.title || !item.body) {
      console.warn(`  - skipped (missing title/body): ${item && item.title ? item.title : "#" + i}`);
      skipped++;
      return;
    }
    const slug = store.slugify(item.slug || item.title);
    const existing = store.db.prepare("SELECT id FROM posts WHERE type = ? AND slug = ?").get(type, slug);
    const payload = {
      type,
      slug,
      title: item.title.trim(),
      category: item.category || null,
      excerpt: item.excerpt || null,
      body: item.body,
      image: localImageFor(item.title, item.image),
      published_at: item.date || null,
      is_published: 1,
      // Newest first: preserve the order they were scraped in
      sort_order: items.length - i,
    };
    if (existing) {
      store.update(existing.id, payload);
      updated++;
    } else {
      store.create(payload);
      created++;
    }
  });
  console.log(`${type}: ${created} created, ${updated} updated, ${skipped} skipped`);
}

importAll(load("news-scrape.json"), "news");
importAll(load("case-studies-scrape.json"), "case-study");
console.log(`\nTotal posts in database: ${store.count()}`);
