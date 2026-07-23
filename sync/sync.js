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
 *   RECENT_DAYS      default 14  (how long a FULLY COMPLETED order stays visible
 *                                after its last door was packed — per order,
 *                                keyed on dbo.door.date_pack_complete)
 *   STALE_DAYS       default 90  (drop un-packed doors scheduled longer ago than this)
 *
 * Flags:  --dry-run   read + print counts, push nothing.
 */
const path = require("path");
try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch { /* dotenv optional */ }

const DRY_RUN = process.argv.includes("--dry-run");
const RECENT_DAYS = parseInt(process.env.RECENT_DAYS || "14", 10);
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
    -- Programming stage: a door is "programmed" once dbo.door_program has a row
    -- for it with programed_by_id set. EXISTS avoids row fan-out if a door has
    -- more than one door_program row.
    CASE WHEN EXISTS (
      SELECT 1 FROM dbo.door_program dp
      WHERE dp.door_id = d.id AND dp.programed_by_id IS NOT NULL
    ) THEN 1 ELSE 0 END        AS complete_program,
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
    d.date_completion          AS date_completion,
    -- The date the door was ACTUALLY packed — drives per-order retention.
    d.date_pack_complete       AS date_pack_complete,
    -- Finish is 1:1 via dbo.door.finish_id -> dbo.finish.id
    f.finish_description       AS finish_description
  FROM dbo.door d
  INNER JOIN dbo.door_type dt ON d.door_type_id = dt.id
  LEFT JOIN dbo.finish f ON f.id = d.finish_id
  WHERE COALESCE(d.status_id, 1) NOT IN (4, 6)
    -- Steel doors only — Slimline architectural glazing is excluded from the hub.
    AND (dt.slimline_y_n = 0 OR dt.slimline_y_n IS NULL)
    -- Exclude non-door service lines (e.g. installation) — not a manufactured door.
    AND (dt.door_type_description IS NULL OR LTRIM(RTRIM(dt.door_type_description)) <> 'Standard Installation')
    -- "Done" = packed OR status Complete (3). Retention is per ORDER: a door
    -- still in production stays until it's ancient (STALE_DAYS); a done door
    -- stays while its order still has live work, or for RECENT_DAYS after the
    -- LAST door on that order was actually packed (date_pack_complete, falling
    -- back to the scheduled date for legacy rows). So a finished order drops as
    -- a whole, two weeks after its final door completed.
    -- Every nullable flag is COALESCEd: under SQL Server three-valued logic a
    -- NULL makes BOTH branches UNKNOWN, silently dropping the row — and since we
    -- push snapshot:true, a dropped row is DELETED from the customer's portal.
    -- NULL status is treated as Active(1), matching the hub's IFNULL(status,1).
    AND (
      (
        NOT (COALESCE(d.complete_pack, 0) = 1 OR COALESCE(d.status_id, 1) = 3)
        AND (d.date_completion IS NULL OR d.date_completion >= DATEADD(day, -@stale, CAST(GETDATE() AS date)))
      )
      OR
      (
        (COALESCE(d.complete_pack, 0) = 1 OR COALESCE(d.status_id, 1) = 3)
        AND (
          -- The order still has live (not done, not ancient) work.
          EXISTS (
            SELECT 1
            FROM dbo.door d2
            INNER JOIN dbo.door_type dt2 ON d2.door_type_id = dt2.id
            WHERE d2.order_id = d.order_id
              AND COALESCE(d2.status_id, 1) NOT IN (4, 6)
              AND (dt2.slimline_y_n = 0 OR dt2.slimline_y_n IS NULL)
              AND (dt2.door_type_description IS NULL OR LTRIM(RTRIM(dt2.door_type_description)) <> 'Standard Installation')
              AND NOT (COALESCE(d2.complete_pack, 0) = 1 OR COALESCE(d2.status_id, 1) = 3)
              AND (d2.date_completion IS NULL OR d2.date_completion >= DATEADD(day, -@stale, CAST(GETDATE() AS date)))
          )
          -- ...or the order's last ACTUAL completion is inside the window. Only
          -- FINISHED doors count, so an un-packed door's scheduled date can't
          -- inflate it. An order with no completion date at all is kept — we
          -- can't age out what we can't date.
          OR EXISTS (
            SELECT 1 FROM (
              SELECT MAX(COALESCE(d3.date_pack_complete, d3.date_completion)) AS last_done
              FROM dbo.door d3
              INNER JOIN dbo.door_type dt3 ON d3.door_type_id = dt3.id
              WHERE d3.order_id = d.order_id
                AND COALESCE(d3.status_id, 1) NOT IN (4, 6)
                AND (dt3.slimline_y_n = 0 OR dt3.slimline_y_n IS NULL)
                AND (dt3.door_type_description IS NULL OR LTRIM(RTRIM(dt3.door_type_description)) <> 'Standard Installation')
                AND (COALESCE(d3.complete_pack, 0) = 1 OR COALESCE(d3.status_id, 1) = 3)
            ) x
            WHERE x.last_done IS NULL
               OR x.last_done >= DATEADD(day, -@recent, CAST(GETDATE() AS date))
          )
          -- Orphan safety: a door with no order_id can't be grouped, so fall
          -- back to its own completion date rather than silently vanishing.
          OR (
            d.order_id IS NULL
            AND (COALESCE(d.date_pack_complete, d.date_completion) IS NULL
                 OR COALESCE(d.date_pack_complete, d.date_completion) >= DATEADD(day, -@recent, CAST(GETDATE() AS date)))
          )
        )
      )
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
    const rows = result.recordset;
    await attachPaint(pool, rows);
    return rows;
  } finally {
    await pool.close();
  }
}

// Attach up to two DISTINCT paint colours per door from dbo.paint_to_door.
// A doorset can carry two colours (e.g. two-tone: frame one, leaf another).
// Done as a separate keyed query so the main door query doesn't fan out. Door
// ids come from our own query (integers), so inlining them in the IN list is
// injection-safe; chunked to keep each statement small.
async function attachPaint(pool, rows) {
  for (const r of rows) { r.paint_colour_1 = null; r.paint_colour_2 = null; }
  const ids = [...new Set(rows.map((r) => Number(r.id)).filter((n) => Number.isInteger(n)))];
  if (!ids.length) return;
  const byDoor = new Map();
  const CHUNK = 900;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const res = await pool.request().query(
      `SELECT door_id, description FROM dbo.paint_to_door WHERE door_id IN (${slice.join(",")})`
    );
    for (const p of res.recordset) {
      const did = Number(p.door_id);
      const desc = p.description == null ? null : String(p.description).trim();
      if (!desc) continue;
      let list = byDoor.get(did);
      if (!list) { list = []; byDoor.set(did, list); }
      if (list.length < 2 && !list.includes(desc)) list.push(desc);
    }
  }
  for (const r of rows) {
    const list = byDoor.get(Number(r.id));
    if (list) { r.paint_colour_1 = list[0] || null; r.paint_colour_2 = list[1] || null; }
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
    complete_program: toBool(r.complete_program),
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
    date_pack_complete: toDate(r.date_pack_complete),
    finish_description: r.finish_description == null ? null : String(r.finish_description).trim() || null,
    paint_colour_1: r.paint_colour_1 == null ? null : String(r.paint_colour_1),
    paint_colour_2: r.paint_colour_2 == null ? null : String(r.paint_colour_2),
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
  let withPaint = 0, withFinish = 0;
  for (const d of doors) { if (d.paint_colour_1) withPaint++; if (d.finish_description) withFinish++; }
  log(`  with paint colour: ${withPaint}, with finish: ${withFinish}`);
}

async function push(doors) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY },
    // Report our retention window so the hub never prunes tighter than we
    // upload (which would make rows flap: pruned there, re-sent by us).
    body: JSON.stringify({
      doors,
      snapshot: true,
      source: "sql-sync",
      retention: { recent: RECENT_DAYS, stale: STALE_DAYS },
    }),
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
