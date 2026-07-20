/**
 * Internal → Online sync (runs on the Design & Supply network, NOT on Railway).
 *
 * Reads recent doors from the internal SQL Server (dbo.door INNER JOIN
 * dbo.door_type) and pushes them to the hub's secured ingest endpoint over
 * HTTPS. The SQL Server is never exposed to the internet.
 *
 * Language: Node.js (the internal box already runs Node; keeps one language and
 * shared field names with the app). Reads SQL Server via the `mssql` package.
 *
 * Schedule it with Windows Task Scheduler (or cron), e.g. every 15 minutes:
 *   node sync/sync.js
 *
 * Config (environment variables — see .env.example):
 *   SQLSERVER_HOST, SQLSERVER_PORT, SQLSERVER_DB, SQLSERVER_USER,
 *   SQLSERVER_PASSWORD, SQLSERVER_ENCRYPT(true/false)
 *   HUB_INGEST_URL   e.g. https://designandsupply.co.uk/api/ingest/doors
 *   INGEST_API_KEY   must match the value set on the hub
 *   RECENT_DAYS      default 30  (how long packed doors stay visible)
 *   STALE_DAYS       default 90  (drop un-packed doors scheduled longer ago than this)
 *
 * Flags:  --dry-run   read + print counts, push nothing.
 */
const path = require("path");
try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch { /* dotenv optional */ }

const DRY_RUN = process.argv.includes("--dry-run");
const RECENT_DAYS = parseInt(process.env.RECENT_DAYS || "30", 10);
const STALE_DAYS = parseInt(process.env.STALE_DAYS || "90", 10);
const INGEST_URL = process.env.HUB_INGEST_URL;
const API_KEY = process.env.INGEST_API_KEY;

// Only the fields the hub needs. Booleans come back as SQL Server bit (0/1);
// door_type_description is joined from dbo.door_type. The WHERE clause mirrors
// the hub's recency window so we never upload old, fully-packed rows.
const QUERY = `
  SELECT
    d.id                       AS id,
    d.order_id                 AS order_id,
    d.order_number             AS order_number,
    d.order_ref                AS order_ref,
    d.door_ref                 AS door_ref,
    dt.door_type_description   AS door_type_description,
    d.customer_acc_ref         AS customer_acc_ref,
    d.status_id                AS status_id,
    d.complete_punch           AS complete_punch,
    d.complete_bend            AS complete_bend,
    d.complete_weld            AS complete_weld,
    d.complete_buff            AS complete_buff,
    d.complete_paint           AS complete_paint,
    d.complete_pack            AS complete_pack,
    d.date_punch               AS date_punch,
    d.date_bend                AS date_bend,
    d.date_weld                AS date_weld,
    d.date_buff                AS date_buff,
    d.date_paint               AS date_paint,
    d.date_pack                AS date_pack,
    d.date_completion          AS date_completion
  FROM dbo.door d
  INNER JOIN dbo.door_type dt ON d.door_type_id = dt.id
  WHERE d.status_id NOT IN (4, 6)
    -- Steel doors only — Slimline architectural glazing is excluded from the hub.
    AND (dt.slimline_y_n = 0 OR dt.slimline_y_n IS NULL)
    -- "Done" = packed OR status Complete (3). Done rows drop once scheduled more
    -- than RECENT_DAYS ago; still-in-production rows drop once scheduled more
    -- than STALE_DAYS ago (this also sheds ancient Complete-but-unpacked doors).
    AND (
      ((d.complete_pack = 1 OR d.status_id = 3) AND d.date_completion IS NOT NULL AND d.date_completion >= DATEADD(day, -@recent, CAST(GETDATE() AS date)))
      OR
      (NOT (d.complete_pack = 1 OR d.status_id = 3) AND (d.date_completion IS NULL OR d.date_completion >= DATEADD(day, -@stale, CAST(GETDATE() AS date))))
    );
`;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function readDoors() {
  const sql = require("mssql");
  const config = {
    server: process.env.SQLSERVER_HOST || "localhost",
    port: parseInt(process.env.SQLSERVER_PORT || "1433", 10),
    database: process.env.SQLSERVER_DB,
    user: process.env.SQLSERVER_USER,
    password: process.env.SQLSERVER_PASSWORD,
    options: {
      encrypt: String(process.env.SQLSERVER_ENCRYPT || "false") === "true",
      trustServerCertificate: true,
    },
  };
  const pool = await sql.connect(config);
  try {
    const result = await pool
      .request()
      .input("recent", sql.Int, RECENT_DAYS)
      .input("stale", sql.Int, STALE_DAYS)
      .query(QUERY); // parameterised — no string-built SQL
    return result.recordset;
  } finally {
    await pool.close();
  }
}

function normalise(rows) {
  const toBool = (v) => v === true || v === 1 || v === "1";
  const toDate = (v) => {
    if (!v) return null;
    const d = v instanceof Date ? v : new Date(v);
    return isNaN(d) ? null : d.toISOString().slice(0, 10); // YYYY-MM-DD (scheduled date)
  };
  return rows.map((r) => ({
    id: Number(r.id),
    order_id: String(r.order_id),
    order_number: r.order_number == null ? null : String(r.order_number),
    order_ref: r.order_ref == null ? null : String(r.order_ref),
    door_ref: r.door_ref == null ? null : String(r.door_ref),
    door_type_description: r.door_type_description || null,
    customer_acc_ref: String(r.customer_acc_ref),
    status_id: r.status_id == null ? null : Number(r.status_id),
    complete_punch: toBool(r.complete_punch),
    complete_bend: toBool(r.complete_bend),
    complete_weld: toBool(r.complete_weld),
    complete_buff: toBool(r.complete_buff),
    complete_paint: toBool(r.complete_paint),
    complete_pack: toBool(r.complete_pack),
    date_punch: toDate(r.date_punch),
    date_bend: toDate(r.date_bend),
    date_weld: toDate(r.date_weld),
    date_buff: toDate(r.date_buff),
    date_paint: toDate(r.date_paint),
    date_pack: toDate(r.date_pack),
    date_completion: toDate(r.date_completion),
  }));
}

/** Print a composition breakdown so we can see WHAT is coming through and tune
 *  RECENT_DAYS / STALE_DAYS. Helps diagnose "still stale" reports. */
function diagnose(doors) {
  const byStatus = {};
  let nullDate = 0, packed = 0, complete3 = 0;
  let min = null, max = null;
  for (const d of doors) {
    byStatus[d.status_id] = (byStatus[d.status_id] || 0) + 1;
    if (!d.date_completion) nullDate++;
    if (d.complete_pack) packed++;
    if (d.status_id === 3) complete3++;
    if (d.date_completion) {
      if (min === null || d.date_completion < min) min = d.date_completion;
      if (max === null || d.date_completion > max) max = d.date_completion;
    }
  }
  const labels = { 1: "Active", 2: "Query", 3: "Complete", 5: "On Hold" };
  log("  by status:", Object.entries(byStatus)
    .map(([s, n]) => `${labels[s] || "status " + s}=${n}`).join(", ") || "(none)");
  log(`  packed=${packed}, status-Complete=${complete3}, blank scheduled-date=${nullDate}`);
  log(`  scheduled-date range: ${min || "n/a"} … ${max || "n/a"}`);
}

async function push(doors) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ doors, snapshot: true, source: "sql-sync" }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Ingest failed ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function main() {
  const started = Date.now();
  log(`Sync starting (recent ${RECENT_DAYS}d / stale ${STALE_DAYS}d${DRY_RUN ? ", DRY RUN" : ""}).`);
  const raw = await readDoors();
  const doors = normalise(raw);
  log(`Read ${doors.length} doors from SQL Server.`);
  diagnose(doors);

  if (DRY_RUN) {
    log("Dry run — not pushing. Sample:", JSON.stringify(doors.slice(0, 2), null, 2));
    return;
  }
  if (!INGEST_URL || !API_KEY) throw new Error("HUB_INGEST_URL and INGEST_API_KEY must be set to push.");
  const result = await push(doors);
  log(`Pushed OK — received ${result.received}, upserted ${result.upserted}, removed ${result.removed}. (${Date.now() - started}ms)`);
}

main().catch((err) => {
  log("SYNC ERROR:", err.message);
  process.exit(1);
});
