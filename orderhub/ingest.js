/**
 * Secured ingest endpoint. The internal sync script (on the SQL Server box)
 * POSTs recent doors here over HTTPS with a shared-secret header. This is the
 * ONLY way production data reaches the online hub — the SQL Server is never
 * exposed to the internet.
 *
 *   POST /api/ingest/doors
 *   Header: x-api-key: <INGEST_API_KEY>
 *   Body:   { doors: [ {...} ], snapshot: true, source: "sql-sync" }
 *
 * snapshot:true means the payload is the full current in-window set, so any
 * door not present is deleted (keeps the hub trimmed and self-healing).
 */
const crypto = require("crypto");
const express = require("express");
const store = require("./db");

const router = express.Router();

function authorised(req) {
  const key = process.env.INGEST_API_KEY;
  if (!key) return { ok: false, code: 503, error: "Ingest is not configured (INGEST_API_KEY unset)." };
  const given = req.get("x-api-key") || "";
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, code: 401, error: "Unauthorized." };
  }
  return { ok: true };
}

router.post("/doors", (req, res) => {
  const gate = authorised(req);
  if (!gate.ok) {
    if (gate.code === 401) store.logSync({ status: "error", message: "Unauthorized ingest attempt", source: req.ip });
    return res.status(gate.code).json({ ok: false, error: gate.error });
  }
  const doors = Array.isArray(req.body && req.body.doors) ? req.body.doors : null;
  if (!doors) return res.status(400).json({ ok: false, error: "Body must be { doors: [...] }." });

  try {
    const { upserted, removed } = store.ingestDoors(doors, { snapshot: !!req.body.snapshot });
    // The sync reports its own retention window so we never prune TIGHTER than
    // it uploads — otherwise rows would flap (pruned here, re-sent next sync).
    const r = req.body && req.body.retention;
    const pruned = store.pruneAgedOut({
      recentDays: r ? Number(r.recent) : undefined,
      staleDays: r ? Number(r.stale) : undefined,
    });
    const totalRemoved = removed + pruned;
    store.logSync({
      rows_received: doors.length,
      rows_upserted: upserted,
      rows_removed: totalRemoved,
      status: "ok",
      source: String(req.body.source || "sync"),
    });
    res.json({ ok: true, received: doors.length, upserted, removed: totalRemoved });
  } catch (e) {
    store.logSync({ rows_received: doors.length, status: "error", message: e.message, source: String((req.body && req.body.source) || "sync") });
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
