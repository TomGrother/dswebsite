/**
 * Access-scoping tests — the security-critical guarantee that a customer can
 * NEVER see another customer's orders. Run with:  node --test orderhub/tests
 */
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

// Isolated DB per run.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-scope-"));
process.env.RECENT_DAYS = "30";

const store = require("../db");
const auth = require("../auth");

function d(offset) {
  return new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
}

function seedDoors() {
  store.ingestDoors(
    [
      { id: 1, order_id: "A1", order_number: "10432", order_ref: "PO1", door_type_description: "SR3", customer_acc_ref: "ACME01", status_id: 1, complete_pack: 0, date_completion: d(3) },
      { id: 2, order_id: "A2", order_number: "10440", order_ref: "PO2", door_type_description: "FD60", customer_acc_ref: "ACME02", status_id: 1, complete_pack: 0, date_completion: d(4) },
      { id: 3, order_id: "O1", order_number: "9001", order_ref: "PO9", door_type_description: "SR2", customer_acc_ref: "OTHER01", status_id: 1, complete_pack: 0, date_completion: d(2) },
    ],
    { snapshot: true }
  );
}

function refsSeen(orders) {
  const s = new Set();
  orders.forEach((o) => o.doors.forEach((dr) => s.add(dr.customer_acc_ref)));
  return [...s].sort();
}

test("domain-scoped customer sees only their domain's refs", async () => {
  seedDoors();
  auth.addMapping("acme.co.uk", "ACME01");
  auth.addMapping("acme.co.uk", "ACME02");
  auth.addMapping("other.co.uk", "OTHER01");
  const acme = await auth.createUser({ email: "buyer@acme.co.uk", password: "Password123", role: "customer" });

  const orders = store.ordersForUser(acme, {});
  assert.deepStrictEqual(refsSeen(orders), ["ACME01", "ACME02"], "sees both Acme refs");
  assert.ok(!refsSeen(orders).includes("OTHER01"), "must NOT see the other customer's ref");
  // And no order object exposes another customer's data
  assert.ok(orders.every((o) => o.doors.every((dr) => ["ACME01", "ACME02"].includes(dr.customer_acc_ref))));
});

test("customer with an explicit override is restricted to just that ref", async () => {
  const u = await auth.createUser({ email: "restricted@acme.co.uk", password: "Password123", role: "customer" });
  auth.addOverride(u.id, "ACME01"); // even though the domain maps to ACME01+ACME02
  const orders = store.ordersForUser(u, {});
  assert.deepStrictEqual(refsSeen(orders), ["ACME01"], "override wins over domain map");
});

test("a generic email domain scopes to nothing (no cross-customer leak)", async () => {
  const g = await auth.createUser({ email: "someone@gmail.com", password: "Password123", role: "customer" });
  const orders = store.ordersForUser(g, {});
  assert.strictEqual(orders.length, 0, "gmail user sees no orders without explicit overrides");
});

test("a customer whose domain maps to nothing sees nothing", async () => {
  const u = await auth.createUser({ email: "buyer@unmapped.co.uk", password: "Password123", role: "customer" });
  assert.strictEqual(store.ordersForUser(u, {}).length, 0);
});

test("staff see every customer's orders", async () => {
  const staff = await auth.createUser({ email: "staff@designandsupply.co.uk", password: "Password123", role: "staff" });
  const orders = store.ordersForUser(staff, {});
  assert.deepStrictEqual(refsSeen(orders), ["ACME01", "ACME02", "OTHER01"]);
});

test("orderForUser refuses another customer's order by id", async () => {
  const acme = auth.getUserByEmail("buyer@acme.co.uk");
  assert.ok(store.orderForUser(acme, "A1"), "can open own order");
  assert.strictEqual(store.orderForUser(acme, "O1"), null, "cannot open another customer's order even by id");
});
