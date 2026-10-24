/**
 * SQLite data layer for editable content (news articles and case studies).
 *
 * IMPORTANT (Railway): the database lives in DATA_DIR. Railway's filesystem is
 * ephemeral, so mount a Volume and set DATA_DIR to its mount path (e.g. /data)
 * or every deploy will wipe the content.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
// Uploaded content images live on the volume (DATA_DIR) so a Railway deploy
// doesn't wipe them. Served at /uploads by server.js.
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "content.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type         TEXT NOT NULL CHECK (type IN ('news','case-study')),
    slug         TEXT NOT NULL,
    title        TEXT NOT NULL,
    category     TEXT,
    excerpt      TEXT,
    body         TEXT,
    image        TEXT,
    published_at TEXT,
    is_published INTEGER NOT NULL DEFAULT 1,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (type, slug)
  );
  CREATE INDEX IF NOT EXISTS idx_posts_type_published ON posts (type, is_published);

  -- Website contact-form enquiries. Stored on the volume as the durable record
  -- so an enquiry survives even if the notification email fails to send.
  CREATE TABLE IF NOT EXISTS enquiry (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT,
    email      TEXT,
    phone      TEXT,
    subject    TEXT,
    message    TEXT,
    df_ref     TEXT,
    emailed_at TEXT,
    error      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Specification-pack requests from /downloads. marketing_consent is only ever
// set from the unticked-by-default opt-in box; consent_text records the exact
// wording the person agreed to, for the consent record.
db.exec(`
  CREATE TABLE IF NOT EXISTS spec_pack_request (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    name              TEXT NOT NULL,
    email             TEXT NOT NULL,
    company           TEXT,
    marketing_consent INTEGER NOT NULL DEFAULT 0,
    consent_text      TEXT,
    df_ref            TEXT,
    emailed_at        TEXT,
    error             TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Existing databases predate the df_ref column (DesignForce email-tracking ref).
if (!db.prepare("SELECT 1 FROM pragma_table_info('enquiry') WHERE name = 'df_ref'").get()) {
  db.exec("ALTER TABLE enquiry ADD COLUMN df_ref TEXT");
}

// The sort and the article date both need published_at in ISO YYYY-MM-DD.
// People naturally type UK dates ("25/09/2026") into the field — accept them.
// Returns ISO for ISO or recognisable D/M/YYYY input (also - or . separators),
// null for blank/unrecognisable.
function toIsoDate(value) {
  const s = String(value == null ? "" : value).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (m) {
    const day = m[1].padStart(2, "0"), month = m[2].padStart(2, "0");
    if (+month >= 1 && +month <= 12 && +day >= 1 && +day <= 31) return `${m[3]}-${month}-${day}`;
  }
  return null;
}

// Normalise at boot: blank dates adopt the post's created_at ("when it was
// posted"); non-ISO dates (UK-format entries) are converted, or fall back to
// created_at if unrecognisable. Blank/malformed published_at both fail to
// render on the article page AND string-sort to the wrong end of the list.
// Idempotent — a row is only written when the value actually changes.
{
  const rows = db
    .prepare("SELECT id, published_at, created_at FROM posts WHERE published_at IS NULL OR published_at NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'")
    .all();
  const fix = db.prepare("UPDATE posts SET published_at = ? WHERE id = ?");
  let n = 0;
  for (const r of rows) {
    const iso = toIsoDate(r.published_at) || String(r.created_at).slice(0, 10);
    if (iso !== r.published_at) { fix.run(iso, r.id); n++; }
  }
  if (n) console.log(`Normalised published_at on ${n} post(s).`);
}

// Product renames inside CMS articles. The live articles sit in the volume's
// database, so they are corrected here rather than in a local copy. Exact
// phrases only (generic uses of the word stay as written); idempotent.
{
  const RENAMES = [
    // Oct 2026: the flood door range is named Flood-Line.
    ["flood-doors-protecting-uk-property", "Design &amp; Supply's flood-rated steel doors", "Design &amp; Supply's Flood-Line steel doors"],
    ["flood-doors-protecting-uk-property", "Design &amp; Supply Flood-Rated Doors", "Design &amp; Supply Flood-Line Doors"],
    ["flood-doors-protecting-uk-property", "Our flood-rated doors are built", "Our Flood-Line doors are built"],
  ];
  const get = db.prepare("SELECT id, body FROM posts WHERE slug = ?");
  const put = db.prepare("UPDATE posts SET body = ? WHERE id = ?");
  for (const [slug, from, to] of RENAMES) {
    const row = get.get(slug);
    if (row && row.body && row.body.includes(from)) put.run(row.body.split(from).join(to), row.id);
  }
}

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Ensure a slug is unique within a type, ignoring the row being edited. */
function uniqueSlug(type, desired, ignoreId) {
  let base = slugify(desired) || "post";
  let slug = base;
  let n = 2;
  const check = db.prepare("SELECT id FROM posts WHERE type = ? AND slug = ? AND id IS NOT ?");
  while (check.get(type, slug, ignoreId || null)) slug = `${base}-${n++}`;
  return slug;
}

// Newest first by DATE. sort_order comes second — it was the migrated WP
// ordering (15..1) and admin-created posts get 0, so leading with it pinned
// every new article below all the old ones. Date-first preserves the migrated
// order (their dates descend in step with sort_order) and leaves sort_order as
// a manual tiebreaker for same-day posts.
const listPublished = db.prepare(`
  SELECT * FROM posts WHERE type = ? AND is_published = 1
  ORDER BY COALESCE(published_at,'') DESC, sort_order DESC, id DESC
`);
const listAllOfType = db.prepare(`
  SELECT * FROM posts WHERE type = ?
  ORDER BY COALESCE(published_at,'') DESC, sort_order DESC, id DESC
`);
const getBySlugStmt = db.prepare("SELECT * FROM posts WHERE type = ? AND slug = ? AND is_published = 1");
const getByIdStmt = db.prepare("SELECT * FROM posts WHERE id = ?");

module.exports = {
  db,
  UPLOADS_DIR,

  // ---- contact-form enquiries ---------------------------------------------
  saveEnquiry(e) {
    return db
      .prepare(
        "INSERT INTO enquiry (name, email, phone, subject, message, df_ref) VALUES (@name, @email, @phone, @subject, @message, @df_ref)"
      )
      .run({
        name: e.name || null,
        email: e.email || null,
        phone: e.phone || null,
        subject: e.subject || null,
        message: e.message || null,
        df_ref: e.df_ref || null,
      }).lastInsertRowid;
  },
  markEnquiryEmailed: (id) =>
    db.prepare("UPDATE enquiry SET emailed_at = datetime('now'), error = NULL WHERE id = ?").run(id),
  markEnquiryFailed: (id, error) =>
    db.prepare("UPDATE enquiry SET error = ? WHERE id = ?").run(String(error || "").slice(0, 500), id),
  recentEnquiries: (n = 50) =>
    db.prepare("SELECT * FROM enquiry ORDER BY id DESC LIMIT ?").all(n),

  // ---- specification-pack requests ----------------------------------------
  saveSpecPackRequest(r) {
    return db
      .prepare(
        "INSERT INTO spec_pack_request (name, email, company, marketing_consent, consent_text, df_ref) VALUES (@name, @email, @company, @marketing_consent, @consent_text, @df_ref)"
      )
      .run({
        name: r.name,
        email: r.email,
        company: r.company || null,
        marketing_consent: r.marketing_consent ? 1 : 0,
        consent_text: r.marketing_consent ? r.consent_text : null,
        df_ref: r.df_ref || null,
      }).lastInsertRowid;
  },
  markSpecPackEmailed: (id) =>
    db.prepare("UPDATE spec_pack_request SET emailed_at = datetime('now'), error = NULL WHERE id = ?").run(id),
  markSpecPackFailed: (id, error) =>
    db.prepare("UPDATE spec_pack_request SET error = ? WHERE id = ?").run(String(error || "").slice(0, 500), id),
  specPackRequests: () => db.prepare("SELECT * FROM spec_pack_request ORDER BY id DESC").all(),

  // Save a base64 data-URL image onto the volume; returns its public /uploads/ path.
  saveUpload(dataUrl) {
    const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || "").trim());
    if (!m) throw new Error("Expected a PNG, JPEG or WebP image.");
    const ext = m[1].toLowerCase() === "png" ? "png" : m[1].toLowerCase() === "webp" ? "webp" : "jpg";
    const buf = Buffer.from(m[2], "base64");
    if (!buf.length) throw new Error("The image was empty.");
    if (buf.length > 6 * 1024 * 1024) throw new Error("Image too large (max 6MB).");
    const name = "news-" + crypto.randomBytes(8).toString("hex") + "." + ext;
    fs.writeFileSync(path.join(UPLOADS_DIR, name), buf);
    return "/uploads/" + name;
  },
  slugify,
  uniqueSlug,

  published: (type) => listPublished.all(type),
  allOfType: (type) => listAllOfType.all(type),
  getBySlug: (type, slug) => getBySlugStmt.get(type, slug),
  getById: (id) => getByIdStmt.get(id),

  count: () => db.prepare("SELECT COUNT(*) AS n FROM posts").get().n,

  create(p) {
    const slug = uniqueSlug(p.type, p.slug || p.title);
    const info = db
      .prepare(
        `INSERT INTO posts (type, slug, title, category, excerpt, body, image, published_at, is_published, sort_order)
         VALUES (@type, @slug, @title, @category, @excerpt, @body, @image, @published_at, @is_published, @sort_order)`
      )
      .run({
        type: p.type,
        slug,
        title: p.title,
        category: p.category || null,
        excerpt: p.excerpt || null,
        body: p.body || null,
        image: p.image || null,
        // Blank date would sink the post to the bottom of the date-first sort,
        // so a new post defaults to today (UK) — visible and editable in admin.
        published_at: toIsoDate(p.published_at) || new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date()),
        is_published: p.is_published === 0 ? 0 : 1,
        sort_order: p.sort_order || 0,
      });
    return getByIdStmt.get(info.lastInsertRowid);
  },

  update(id, p) {
    const existing = getByIdStmt.get(id);
    if (!existing) return null;
    const slug = p.slug ? uniqueSlug(existing.type, p.slug, id) : existing.slug;
    db.prepare(
      `UPDATE posts SET slug=@slug, title=@title, category=@category, excerpt=@excerpt,
        body=@body, image=@image, published_at=@published_at, is_published=@is_published,
        sort_order=@sort_order, updated_at=datetime('now')
       WHERE id=@id`
    ).run({
      id,
      slug,
      title: p.title ?? existing.title,
      category: p.category ?? existing.category,
      excerpt: p.excerpt ?? existing.excerpt,
      body: p.body ?? existing.body,
      image: p.image ?? existing.image,
      // Convert whatever was typed to ISO; if it's unrecognisable, keep the
      // existing date rather than storing something unrenderable/unsortable.
      published_at: p.published_at === undefined ? existing.published_at : (toIsoDate(p.published_at) || existing.published_at),
      is_published: p.is_published === undefined ? existing.is_published : (p.is_published ? 1 : 0),
      sort_order: p.sort_order ?? existing.sort_order,
    });
    return getByIdStmt.get(id);
  },

  remove: (id) => db.prepare("DELETE FROM posts WHERE id = ?").run(id).changes > 0,
};
