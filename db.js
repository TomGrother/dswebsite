/**
 * SQLite data layer for editable content (news articles and case studies).
 *
 * IMPORTANT (Railway): the database lives in DATA_DIR. Railway's filesystem is
 * ephemeral, so mount a Volume and set DATA_DIR to its mount path (e.g. /data)
 * or every deploy will wipe the content.
 */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

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
`);

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

const listPublished = db.prepare(`
  SELECT * FROM posts WHERE type = ? AND is_published = 1
  ORDER BY sort_order DESC, COALESCE(published_at,'') DESC, id DESC
`);
const listAllOfType = db.prepare(`
  SELECT * FROM posts WHERE type = ?
  ORDER BY sort_order DESC, COALESCE(published_at,'') DESC, id DESC
`);
const getBySlugStmt = db.prepare("SELECT * FROM posts WHERE type = ? AND slug = ? AND is_published = 1");
const getByIdStmt = db.prepare("SELECT * FROM posts WHERE id = ?");

module.exports = {
  db,
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
        published_at: p.published_at || null,
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
      published_at: p.published_at ?? existing.published_at,
      is_published: p.is_published === undefined ? existing.is_published : (p.is_published ? 1 : 0),
      sort_order: p.sort_order ?? existing.sort_order,
    });
    return getByIdStmt.get(id);
  },

  remove: (id) => db.prepare("DELETE FROM posts WHERE id = ?").run(id).changes > 0,
};
