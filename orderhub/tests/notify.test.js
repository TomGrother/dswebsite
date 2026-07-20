/**
 * Daily-digest tests: event capture on sync + per-customer summary send.
 * A stubbed transport captures emails so nothing is actually sent.
 * Run with:  node --test orderhub/tests
 */
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-notify-"));
process.env.RESEND_API_KEY = "test-key"; // marks the feature enabled; transport is stubbed

const store = require("../db");
const auth = require("../auth");
const notify = require("../notify");

const d = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

test("digest: captures transitions, emails each customer only their own changes", async () => {
  auth.addMapping("r.co.uk", "R");
  auth.addMapping("other.co.uk", "OTHER");
  await auth.createUser({ email: "u@r.co.uk", password: "Password123", role: "customer", display_name: "Rita Buyer" });
  await auth.createUser({ email: "o@other.co.uk", password: "Password123", role: "customer" });

  // Baseline load into an empty hub -> NO events (avoids first-run spam).
  store.ingestDoors(
    [
      { id: 1, order_id: "100", order_number: "100", door_ref: "D-1", customer_acc_ref: "R", status_id: 1, complete_pack: 0, date_completion: d(3), door_type_description: "SR3 Doorset" },
      { id: 2, order_id: "100", order_number: "100", door_ref: "D-2", customer_acc_ref: "R", status_id: 1, complete_pack: 0, date_completion: d(3), door_type_description: "FD60 Doorset" },
      { id: 9, order_id: "900", order_number: "900", door_ref: "D-9", customer_acc_ref: "OTHER", status_id: 1, complete_pack: 0, date_completion: d(3), door_type_description: "SR2 Doorset" },
    ],
    { snapshot: false }
  );
  assert.strictEqual(store.maxUnnotifiedEventId(), null, "baseline load records no events");

  // Now some transitions.
  store.ingestDoors(
    [
      { id: 1, order_id: "100", order_number: "100", door_ref: "D-1", customer_acc_ref: "R", status_id: 1, complete_pack: 1, date_completion: d(3), door_type_description: "SR3 Doorset" }, // packed
      { id: 2, order_id: "100", order_number: "100", door_ref: "D-2", customer_acc_ref: "R", status_id: 5, complete_pack: 0, date_completion: d(3), door_type_description: "FD60 Doorset" }, // on hold
      { id: 3, order_id: "100", order_number: "100", door_ref: "D-3", customer_acc_ref: "R", status_id: 1, complete_pack: 0, date_completion: d(4), door_type_description: "Personnel Doorset" }, // added
      { id: 9, order_id: "900", order_number: "900", door_ref: "D-9", customer_acc_ref: "OTHER", status_id: 1, complete_pack: 1, date_completion: d(3), door_type_description: "SR2 Doorset" }, // packed (OTHER)
    ],
    { snapshot: false }
  );

  const sent = [];
  const fakeSend = async (to, subject, html) => { sent.push({ to, subject, html }); };
  const result = await notify.runDigest({ send: fakeSend, force: true });

  assert.strictEqual(result.events, 4, "4 change events captured");
  assert.strictEqual(result.emails, 2, "one email per affected customer");

  const rita = sent.find((m) => m.to === "u@r.co.uk");
  const other = sent.find((m) => m.to === "o@other.co.uk");
  assert.ok(rita && other, "both customers emailed");

  // Rita sees her three doors and their event labels, not OTHER's door.
  assert.ok(rita.html.includes("D-1") && rita.html.includes("Packed"), "packed shown");
  assert.ok(rita.html.includes("D-2") && rita.html.includes("hold"), "on-hold shown");
  assert.ok(rita.html.includes("D-3") && rita.html.includes("Added"), "added shown");
  assert.ok(!rita.html.includes("D-9"), "no cross-customer leak into Rita's email");
  assert.ok(rita.subject.includes("1 door ready"), "subject reflects the packed count");
  assert.ok(rita.html.includes("Rita"), "greets by first name");

  // OTHER only sees their own packed door.
  assert.ok(other.html.includes("D-9") && !other.html.includes("D-1"), "OTHER isolated to their door");
});

test("digest: idempotent — a second run has nothing left to send", async () => {
  const sent = [];
  const result = await notify.runDigest({ send: async (...a) => sent.push(a), force: true });
  assert.strictEqual(result.emails, 0, "no emails second time");
  assert.strictEqual(result.events, 0, "events already marked notified");
  assert.strictEqual(sent.length, 0, "transport not called");
});

test("digest: once-a-day guard skips a non-forced run after one has sent", async () => {
  const result = await notify.runDigest({ send: async () => {}, force: false });
  assert.strictEqual(result.skipped, "already-sent-today", "guarded against double-send");
});

test("orders broadcast: emails each customer a full snapshot of their live orders, scoped", async () => {
  // Reuses the users/doors from the first test (same DATA_DIR, sequential file).
  const sent = [];
  const r = await notify.runOrdersBroadcast({ send: async (to, subject, html) => sent.push({ to, subject, html }) });
  assert.strictEqual(r.emails, 2, "both customers with live orders emailed");

  const rita = sent.find((m) => m.to === "u@r.co.uk");
  assert.ok(rita, "Rita emailed");
  assert.ok(rita.html.includes("Order 100"), "shows her order number");
  assert.ok(rita.html.includes("D-1"), "shows door reference");
  assert.ok(rita.html.includes("Programming") && rita.html.includes("Punch") && rita.html.includes("Pack"),
    "renders the production-stage tracker");
  assert.ok(!rita.html.includes("D-9"), "scoped — no other customer's door in her email");
  assert.ok(rita.subject.includes("production status"), "snapshot subject, not a change summary");

  const other = sent.find((m) => m.to === "o@other.co.uk");
  assert.ok(other.html.includes("Order 900") && !other.html.includes("Order 100"), "OTHER isolated to their order");
});
