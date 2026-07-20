/**
 * Recency-window tests — the hub only shows current + fairly recent orders.
 * Run with:  node --test orderhub/tests
 */
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-recency-"));
process.env.RECENT_DAYS = "30";
process.env.STALE_DAYS = "90";

const store = require("../db");
const auth = require("../auth");

const d = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test("recency window: keep unpacked + recently-scheduled, drop old-packed/cancelled/removed", async () => {
  store.ingestDoors(
    [
      // not yet packed (scheduled far out) -> KEEP
      { id: 1, order_id: "K1", order_number: "1", customer_acc_ref: "R", status_id: 1, complete_pack: 0, date_completion: d(90) },
      // packed, scheduled within window -> KEEP
      { id: 2, order_id: "K2", order_number: "2", customer_acc_ref: "R", status_id: 3, complete_pack: 1, date_completion: d(-10) },
      // packed, scheduled long ago -> DROP
      { id: 3, order_id: "D1", order_number: "3", customer_acc_ref: "R", status_id: 3, complete_pack: 1, date_completion: d(-120) },
      // cancelled -> DROP
      { id: 4, order_id: "D2", order_number: "4", customer_acc_ref: "R", status_id: 4, complete_pack: 0, date_completion: d(5) },
      // removed -> DROP
      { id: 5, order_id: "D3", order_number: "5", customer_acc_ref: "R", status_id: 6, complete_pack: 0, date_completion: d(5) },
      // NOT packed but scheduled long ago (ancient/dead) -> DROP via STALE_DAYS
      { id: 6, order_id: "D4", order_number: "6", customer_acc_ref: "R", status_id: 1, complete_pack: 0, date_completion: d(-200) },
    ],
    { snapshot: true }
  );
  auth.addMapping("r.co.uk", "R");
  const u = await auth.createUser({ email: "u@r.co.uk", password: "Password123", role: "customer" });

  const ids = store.ordersForUser(u, {}).flatMap((o) => o.doors.map((x) => x.id)).sort();
  assert.deepStrictEqual(ids, [1, 2], "keeps unpacked+recent and packed+recent; drops old-packed, cancelled, removed, and ancient un-packed");
  assert.ok(!ids.includes(6), "ancient un-packed door dropped by the staleness floor");
});

test("Complete (status 3) but un-packed ages out via RECENT_DAYS, not STALE_DAYS", async () => {
  store.ingestDoors(
    [
      // Complete, not packed, scheduled 60d ago: inside STALE(90) but past RECENT(30) -> DROP
      { id: 30, order_id: "C1", order_number: "C1", customer_acc_ref: "R", status_id: 3, complete_pack: 0, date_completion: d(-60) },
      // Complete, not packed, scheduled 10d ago: within RECENT -> KEEP
      { id: 31, order_id: "C2", order_number: "C2", customer_acc_ref: "R", status_id: 3, complete_pack: 0, date_completion: d(-10) },
    ],
    { snapshot: false }
  );
  const u = auth.getUserByEmail("u@r.co.uk");
  const ids = store.ordersForUser(u, {}).flatMap((o) => o.doors.map((x) => x.id));
  assert.ok(!ids.includes(30), "old Complete-but-unpacked door aged out (the staleness fix)");
  assert.ok(ids.includes(31), "recent Complete-but-unpacked door kept");
});

test("stage dates: only stages with a date are shown; door_ref surfaces", async () => {
  store.ingestDoors(
    [{ id: 40, order_id: "SD", order_number: "SD", order_ref: "PO-40", door_ref: "DOOR-XYZ",
       customer_acc_ref: "R", status_id: 1, complete_pack: 0, date_completion: d(5),
       complete_punch: 1, complete_bend: 1,
       date_punch: d(-3), date_bend: d(-1), date_weld: d(2) }],
    { snapshot: false }
  );
  const u = auth.getUserByEmail("u@r.co.uk");
  const door = store.ordersForUser(u, {}).find((o) => o.order_id === "SD").doors[0];
  assert.strictEqual(door.door_ref, "DOOR-XYZ", "door_ref surfaced to the UI");
  assert.deepStrictEqual(door.stages.map((s) => s.key), ["punch", "bend", "weld"],
    "stages without a stage-date are left out");
});

test("stage dates: a door with no stage dates falls back to the full route", async () => {
  store.ingestDoors(
    [{ id: 41, order_id: "SD2", order_number: "SD2", customer_acc_ref: "R", status_id: 1,
       complete_pack: 0, date_completion: d(5) }],
    { snapshot: false }
  );
  const u = auth.getUserByEmail("u@r.co.uk");
  const door = store.ordersForUser(u, {}).find((o) => o.order_id === "SD2").doors[0];
  assert.strictEqual(door.stages.length, 6, "no stage dates -> show all six stages");
});

test("on-hold (status 5) doors are shown and flagged", async () => {
  store.ingestDoors(
    [{ id: 10, order_id: "H1", order_number: "H", customer_acc_ref: "R", status_id: 5, complete_punch: 1, complete_pack: 0, date_completion: d(2) }],
    { snapshot: false }
  );
  const u = auth.getUserByEmail("u@r.co.uk");
  const order = store.ordersForUser(u, {}).find((o) => o.order_id === "H1");
  assert.ok(order, "on-hold order is visible");
  assert.strictEqual(order.doors[0].onHold, true, "door flagged on hold");
  assert.strictEqual(order.onHold, 1, "order counts one on-hold door");
});

test("status 1 (Active) and 2 (Query) both render as 'Active'", async () => {
  store.ingestDoors(
    [
      { id: 20, order_id: "S1", order_number: "S1", customer_acc_ref: "R", status_id: 1, complete_pack: 0, date_completion: d(1) },
      { id: 21, order_id: "S2", order_number: "S2", customer_acc_ref: "R", status_id: 2, complete_pack: 0, date_completion: d(1) },
    ],
    { snapshot: false }
  );
  const u = auth.getUserByEmail("u@r.co.uk");
  const orders = store.ordersForUser(u, {});
  const s1 = orders.find((o) => o.order_id === "S1").doors[0];
  const s2 = orders.find((o) => o.order_id === "S2").doors[0];
  assert.strictEqual(s1.statusLabel, "Active");
  assert.strictEqual(s2.statusLabel, "Active", "Query shown as Active");
});
