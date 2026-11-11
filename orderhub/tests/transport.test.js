/**
 * Transport dates from dbo.door_transport: the collection date (the day the
 * doors leave us) and the drop date + time (the day the delivery lands).
 * Run with:  node --test orderhub/tests
 */
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-transport-"));
delete process.env.RESEND_API_KEY;

const store = require("../db");
const auth = require("../auth");
const notify = require("../notify");

const d = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const door = (id, order_id, extra = {}) => ({
  id, order_id, order_number: order_id, customer_acc_ref: "TR", status_id: 1, complete_pack: 0, date_completion: d(10), ...extra,
});
let user;
const order = (id) => store.ordersForUser(user, {}).find((o) => o.order_id === id);

test.before(async () => {
  auth.addMapping("transport.co.uk", "TR");
  user = await auth.createUser({ email: "t@transport.co.uk", password: "Password123!", role: "customer" });
});

test("stores the collection and drop dates, with the drop time only alongside a drop date", () => {
  store.ingestDoors([
    door(1, "A", { collection_date: d(12), drop_date: d(14), drop_time: "10:30" }),
    door(2, "B", { collection_date: d(12), drop_date: null, drop_time: "10:30" }),
    door(3, "C", { collection_date: "12/11/2026", drop_date: d(14), drop_time: "25:00" }),
    door(4, "D", { collection_date: d(12), drop_date: d(14), drop_time: "00:00" }),
  ], { snapshot: true });
  const row = (id) => store.db.prepare("SELECT collection_date, drop_date, drop_time FROM door WHERE id = ?").get(id);
  assert.deepStrictEqual(row(1), { collection_date: d(12), drop_date: d(14), drop_time: "10:30" });
  assert.deepStrictEqual(row(2), { collection_date: d(12), drop_date: null, drop_time: null }, "no time without a drop date");
  assert.deepStrictEqual(row(3), { collection_date: null, drop_date: d(14), drop_time: null }, "malformed values are stored as unknown");
  assert.strictEqual(row(4).drop_time, null, "midnight = no time entered");
});

test("a sync that doesn't send transport dates still works and leaves them blank", () => {
  store.ingestDoors([door(1, "A")], { snapshot: true });
  assert.deepStrictEqual(store.db.prepare("SELECT collection_date, drop_date, drop_time FROM door WHERE id = 1").get(),
    { collection_date: null, drop_date: null, drop_time: null });
});

test("an order shows one collection and delivery when its doors share them", () => {
  store.ingestDoors([
    door(10, "S", { collection_date: d(5), drop_date: d(7), drop_time: "09:00" }),
    door(11, "S", { collection_date: d(5), drop_date: d(7), drop_time: "09:00" }),
  ], { snapshot: true });
  assert.deepStrictEqual(order("S").transport, {
    collection_date: d(5), collectionVaries: false, drop_date: d(7), drop_time: "09:00", dropVaries: false,
  });
});

test("doors with different dates make the order say 'varies' (on-hold doors don't count)", () => {
  store.ingestDoors([
    door(20, "V", { collection_date: d(5), drop_date: d(7) }),
    door(21, "V", { collection_date: d(9), drop_date: null }),
    door(22, "H", { collection_date: d(5) }),
    door(23, "H", { collection_date: d(30), status_id: 5 }),
    door(24, "N"),
  ], { snapshot: true });
  const v = order("V").transport;
  assert.strictEqual(v.collection_date, null);
  assert.strictEqual(v.collectionVaries, true);
  assert.strictEqual(v.dropVaries, true, "one door with a drop date and one without");
  const h = order("H").transport;
  assert.strictEqual(h.collection_date, d(5), "the on-hold door's date is ignored");
  assert.strictEqual(h.collectionVaries, false);
  assert.deepStrictEqual(order("N").transport, {
    collection_date: null, collectionVaries: false, drop_date: null, drop_time: null, dropVaries: false,
  }, "no dates at all = nothing to show");
});

test("the orders email shows the order's dates, or each door's when they vary", () => {
  store.ingestDoors([
    door(30, "E1", { collection_date: "2026-12-04", drop_date: "2026-12-08", drop_time: "10:30" }),
    door(31, "E2", { collection_date: "2026-12-04" }),
    door(32, "E2", { collection_date: "2026-12-10" }),
  ], { snapshot: true });
  const { html } = notify.renderOrdersEmail(user, store.ordersForUser(user, {}));
  assert.match(html, /Collection date: <b>4 December 2026<\/b>/);
  assert.match(html, /Delivery date: <b>8 December 2026 at 10:30<\/b>/);
  assert.match(html, /Collection date: <b>varies by door<\/b>/);
  assert.match(html, /Collection: 10 December 2026/);
});
