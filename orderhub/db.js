/**
 * Order Hub data layer — a synced, read-only-for-customers copy of production
 * door data, plus the accounts and access mappings that scope who sees what.
 *
 * Uses the same engine (better-sqlite3) and the same Railway volume (DATA_DIR)
 * as the marketing-site CMS, but in its own file (orders.db) so the frequent
 * sync churn never touches News/Case Studies content.
 */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "orders.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS door (
    id                     INTEGER PRIMARY KEY,
    order_id               TEXT NOT NULL,
    order_number           TEXT,
    order_ref              TEXT,
    door_type_description  TEXT,
    customer_acc_ref       TEXT NOT NULL,
    status_id              INTEGER,
    complete_punch         INTEGER NOT NULL DEFAULT 0,
    complete_bend          INTEGER NOT NULL DEFAULT 0,
    complete_weld          INTEGER NOT NULL DEFAULT 0,
    complete_buff          INTEGER NOT NULL DEFAULT 0,
    complete_paint         INTEGER NOT NULL DEFAULT 0,
    complete_pack          INTEGER NOT NULL DEFAULT 0,
    date_completion        TEXT,
    updated_at             TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_door_ref     ON door (customer_acc_ref);
  CREATE INDEX IF NOT EXISTS idx_door_order   ON door (order_id);
  CREATE INDEX IF NOT EXISTS idx_door_status  ON door (status_id);
  CREATE INDEX IF NOT EXISTS idx_door_window  ON door (complete_pack, date_completion);

  CREATE TABLE IF NOT EXISTS app_user (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','staff')),
    display_name  TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS domain_account_map (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    domain           TEXT NOT NULL,
    customer_acc_ref TEXT NOT NULL,
    UNIQUE (domain, customer_acc_ref)
  );
  CREATE INDEX IF NOT EXISTS idx_dam_domain ON domain_account_map (domain);

  CREATE TABLE IF NOT EXISTS user_ref_override (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    customer_acc_ref TEXT NOT NULL,
    UNIQUE (user_id, customer_acc_ref)
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ran_at        TEXT NOT NULL DEFAULT (datetime('now')),
    rows_received INTEGER,
    rows_upserted INTEGER,
    rows_removed  INTEGER,
    status        TEXT NOT NULL,
    message       TEXT,
    source        TEXT
  );
`);

// ---- config ----------------------------------------------------------------
// RECENT_DAYS: how long a PACKED door stays visible after its scheduled date.
// STALE_DAYS: hard floor — nothing scheduled more than this many days ago is
// shown, packed or not. This drops ancient un-packed orders (e.g. doors dated
// years ago that were never packed and never cancelled) while still keeping
// genuinely active, even mildly-overdue, work visible.
const RECENT_DAYS = parseInt(process.env.RECENT_DAYS || "30", 10);
const STALE_DAYS = parseInt(process.env.STALE_DAYS || "90", 10);
const RECENT_MODIFIER = `-${RECENT_DAYS} days`;
const STALE_MODIFIER = `-${STALE_DAYS} days`;

// Production status_id semantics (confirmed with the business):
//   1 Active, 2 Query (shown as Active), 3 Complete, 4 Cancelled (hidden),
//   5 On Hold, 6 Removed (hidden).
const HIDDEN_STATUSES = [4, 6];
const STATUS = {
  1: { label: "Active", tone: "active" },
  2: { label: "Active", tone: "active" },
  3: { label: "Complete", tone: "complete" },
  5: { label: "On Hold", tone: "hold" },
};
const STAGES = ["punch", "bend", "weld", "buff", "paint", "pack"];

// A door is in the hub window when it isn't cancelled/removed AND either:
//   - it's packed and was scheduled within RECENT_DAYS, or
//   - it's not yet packed and either has no scheduled date or was scheduled
//     within STALE_DAYS (so ancient un-packed doors drop out).
const WINDOW_SQL =
  `status_id NOT IN (${HIDDEN_STATUSES.join(",")}) AND (` +
  `(complete_pack = 1 AND date_completion IS NOT NULL AND date_completion >= date('now', @recent)) ` +
  `OR (complete_pack = 0 AND (date_completion IS NULL OR date_completion >= date('now', @stale)))` +
  `)`;

// Free/shared email domains must never scope by domain — two unrelated
// customers on gmail would otherwise see each other. These are blocked from the
// mapping table; such users must be given explicit per-user ref overrides.
const GENERIC_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "live.com", "live.co.uk", "yahoo.com", "yahoo.co.uk", "ymail.com", "icloud.com",
  "me.com", "aol.com", "btinternet.com", "msn.com", "gmx.com", "gmx.co.uk",
  "proton.me", "protonmail.com", "sky.com", "talktalk.net", "virginmedia.com",
]);
const isGenericDomain = (d) => GENERIC_DOMAINS.has(String(d || "").toLowerCase());

function domainOf(email) {
  return String(email || "").toLowerCase().split("@")[1] || "";
}

// ---- access scoping (enforced server-side on every customer query) ---------
/**
 * The set of customer_acc_ref a user may see.
 *   staff              -> null  (meaning: everything)
 *   customer w/ overrides -> exactly those refs
 *   customer, no overrides -> refs mapped to their email domain
 * A customer with no resolvable refs gets [] and therefore sees nothing.
 */
function allowedRefsForUser(user) {
  if (!user) return [];
  if (user.role === "staff") return null;
  const overrides = db
    .prepare("SELECT customer_acc_ref FROM user_ref_override WHERE user_id = ?")
    .all(user.id)
    .map((r) => r.customer_acc_ref);
  if (overrides.length) return overrides;
  const domain = domainOf(user.email);
  if (isGenericDomain(domain)) return []; // generic domains never scope by domain
  return db
    .prepare("SELECT customer_acc_ref FROM domain_account_map WHERE domain = ?")
    .all(domain)
    .map((r) => r.customer_acc_ref);
}

// ---- reads -----------------------------------------------------------------
function mapDoor(row) {
  const stages = STAGES.map((s) => ({ key: s, done: !!row["complete_" + s] }));
  const packedCount = stages.filter((s) => s.done).length;
  const status = STATUS[row.status_id] || { label: "Active", tone: "active" };
  return {
    ...row,
    onHold: row.status_id === 5,
    statusLabel: status.label,
    statusTone: status.tone,
    stages,
    packed: !!row.complete_pack,
    progress: packedCount, // 0..6
  };
}

function rowsToOrders(rows) {
  const byOrder = new Map();
  for (const r of rows) {
    const d = mapDoor(r);
    if (!byOrder.has(r.order_id)) {
      byOrder.set(r.order_id, {
        order_id: r.order_id,
        order_number: r.order_number,
        order_ref: r.order_ref,
        doors: [],
      });
    }
    byOrder.get(r.order_id).doors.push(d);
  }
  // Per-order summary + newest-first sort key
  const orders = [...byOrder.values()].map((o) => {
    const total = o.doors.length;
    const packed = o.doors.filter((d) => d.packed).length;
    const onHold = o.doors.filter((d) => d.onHold).length;
    const allPacked = packed === total && total > 0;
    // sort key: soonest outstanding scheduled date first; else latest date
    const dates = o.doors.map((d) => d.date_completion).filter(Boolean).sort();
    return {
      ...o,
      total,
      packed,
      onHold,
      allPacked,
      complete: o.doors.every((d) => d.status_id === 3),
      summary: `${packed} of ${total} doors packed`,
      sortDate: dates.length ? dates[dates.length - 1] : "",
    };
  });
  // Active/most-recent first: not-fully-packed before packed, then by date desc
  orders.sort((a, b) => {
    if (a.allPacked !== b.allPacked) return a.allPacked ? 1 : -1;
    return (b.sortDate || "").localeCompare(a.sortDate || "");
  });
  return orders;
}

function buildWhere(extra, params) {
  const clauses = [WINDOW_SQL];
  params.recent = RECENT_MODIFIER;
  params.stale = STALE_MODIFIER;
  if (extra) clauses.push(extra);
  return clauses.join(" AND ");
}

/** Orders visible to a customer/staff user, optionally filtered by search text. */
function ordersForUser(user, opts = {}) {
  const refs = allowedRefsForUser(user);
  if (refs !== null && refs.length === 0) return [];
  const params = {};
  let extra = "";
  if (refs !== null) {
    const ph = refs.map((_, i) => "@r" + i);
    refs.forEach((r, i) => (params["r" + i] = r));
    extra = `customer_acc_ref IN (${ph.join(",")})`;
  }
  const rows = queryDoors(buildWhere(extra, params), params, opts);
  return rowsToOrders(rows);
}

/** Admin: every in-window order, with optional structured filters. */
function ordersForAdmin(opts = {}) {
  const params = {};
  const extra = [];
  if (opts.acc_ref) { extra.push("customer_acc_ref = @acc"); params.acc = opts.acc_ref; }
  if (opts.door_type) { extra.push("door_type_description LIKE @dt"); params.dt = `%${opts.door_type}%`; }
  if (opts.on_hold) { extra.push("status_id = 5"); }
  if (opts.stage && STAGES.includes(opts.stage)) { extra.push(`complete_${opts.stage} = 1`); }
  const rows = queryDoors(buildWhere(extra.join(" AND "), params), params, opts);
  return rowsToOrders(rows);
}

function queryDoors(where, params, opts) {
  let sql = `SELECT * FROM door WHERE ${where}`;
  if (opts.search) {
    sql += ` AND (order_number LIKE @q OR order_ref LIKE @q OR order_id LIKE @q)`;
    params.q = `%${opts.search}%`;
  }
  sql += ` ORDER BY order_id, id`;
  return db.prepare(sql).all(params);
}

/** A single order a user is allowed to see (scoping re-checked here). */
function orderForUser(user, orderId) {
  const orders = ordersForUser(user, {});
  return orders.find((o) => String(o.order_id) === String(orderId)) || null;
}

// ---- ingest (called by the secured API from the internal sync script) ------
const upsertStmt = db.prepare(`
  INSERT INTO door (id, order_id, order_number, order_ref, door_type_description,
                    customer_acc_ref, status_id, complete_punch, complete_bend,
                    complete_weld, complete_buff, complete_paint, complete_pack,
                    date_completion, updated_at)
  VALUES (@id, @order_id, @order_number, @order_ref, @door_type_description,
          @customer_acc_ref, @status_id, @complete_punch, @complete_bend,
          @complete_weld, @complete_buff, @complete_paint, @complete_pack,
          @date_completion, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    order_id=excluded.order_id, order_number=excluded.order_number,
    order_ref=excluded.order_ref, door_type_description=excluded.door_type_description,
    customer_acc_ref=excluded.customer_acc_ref, status_id=excluded.status_id,
    complete_punch=excluded.complete_punch, complete_bend=excluded.complete_bend,
    complete_weld=excluded.complete_weld, complete_buff=excluded.complete_buff,
    complete_paint=excluded.complete_paint, complete_pack=excluded.complete_pack,
    date_completion=excluded.date_completion, updated_at=datetime('now')
`);

const b = (v) => (v ? 1 : 0);

/**
 * Idempotent ingest. `snapshot: true` means the payload is the full current
 * in-window set, so any door.id not present is deleted (keeps the hub trimmed).
 * Returns counts for the sync log.
 */
const ingestDoors = db.transaction((doors, { snapshot = false } = {}) => {
  let upserted = 0;
  for (const d of doors) {
    upsertStmt.run({
      id: d.id,
      order_id: String(d.order_id),
      order_number: d.order_number == null ? null : String(d.order_number),
      order_ref: d.order_ref == null ? null : String(d.order_ref),
      door_type_description: d.door_type_description || null,
      customer_acc_ref: String(d.customer_acc_ref),
      status_id: d.status_id == null ? null : Number(d.status_id),
      complete_punch: b(d.complete_punch), complete_bend: b(d.complete_bend),
      complete_weld: b(d.complete_weld), complete_buff: b(d.complete_buff),
      complete_paint: b(d.complete_paint), complete_pack: b(d.complete_pack),
      date_completion: d.date_completion || null,
    });
    upserted++;
  }
  let removed = 0;
  if (snapshot) {
    const keep = new Set(doors.map((d) => Number(d.id)));
    const all = db.prepare("SELECT id FROM door").all().map((r) => r.id);
    const del = db.prepare("DELETE FROM door WHERE id = ?");
    for (const id of all) if (!keep.has(id)) { del.run(id); removed++; }
  }
  return { upserted, removed };
});

// Delete rows that have aged out of the window (belt-and-braces trim).
function pruneAgedOut() {
  const info = db
    .prepare(
      `DELETE FROM door WHERE status_id IN (${HIDDEN_STATUSES.join(",")}) ` +
        `OR (complete_pack = 1 AND (date_completion IS NULL OR date_completion < date('now', @recent))) ` +
        `OR (complete_pack = 0 AND date_completion IS NOT NULL AND date_completion < date('now', @stale))`
    )
    .run({ recent: RECENT_MODIFIER, stale: STALE_MODIFIER });
  return info.changes;
}

function logSync(entry) {
  db.prepare(
    `INSERT INTO sync_log (rows_received, rows_upserted, rows_removed, status, message, source)
     VALUES (@rows_received, @rows_upserted, @rows_removed, @status, @message, @source)`
  ).run({
    rows_received: entry.rows_received ?? null,
    rows_upserted: entry.rows_upserted ?? null,
    rows_removed: entry.rows_removed ?? null,
    status: entry.status || "ok",
    message: entry.message || null,
    source: entry.source || null,
  });
}

module.exports = {
  db,
  RECENT_DAYS,
  STAGES,
  isGenericDomain,
  domainOf,
  allowedRefsForUser,
  ordersForUser,
  ordersForAdmin,
  orderForUser,
  ingestDoors,
  pruneAgedOut,
  logSync,
  lastSync: () => db.prepare("SELECT * FROM sync_log ORDER BY id DESC LIMIT 1").get(),
  recentSyncs: (n = 10) => db.prepare("SELECT * FROM sync_log ORDER BY id DESC LIMIT ?").all(n),
  doorCount: () => db.prepare("SELECT COUNT(*) AS n FROM door").get().n,
  stats: () => ({
    doors: db.prepare("SELECT COUNT(*) AS n FROM door").get().n,
    orders: db.prepare("SELECT COUNT(DISTINCT order_id) AS n FROM door").get().n,
    onHold: db.prepare("SELECT COUNT(*) AS n FROM door WHERE status_id = 5").get().n,
  }),
};
