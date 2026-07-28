/**
 * Portal access requests: persistence, admin queue, and the sales email.
 * Run with:  node --test orderhub/tests
 */
const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-access-"));
process.env.SESSION_SECRET = "test-secret-access";

const store = require("../db");
const notify = require("../notify");

test("saveAccessRequest persists and counts as pending", () => {
  const id = store.saveAccessRequest({ company: "Acme Construction", name: "Sam Buyer", email: "sam@acme.co.uk", phone: "01234 567890", message: "We order fire doors monthly." });
  assert.ok(Number.isInteger(Number(id)), "returns an insert id");
  assert.strictEqual(store.pendingAccessRequestCount(), 1, "counts as a new/pending request");

  const rows = store.recentAccessRequests(10);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].company, "Acme Construction");
  assert.strictEqual(rows[0].email, "sam@acme.co.uk");
  assert.strictEqual(rows[0].status, "new");
});

test("markAccessRequestDone removes it from the pending count; new requests sort first", () => {
  const id2 = store.saveAccessRequest({ company: "Beta Ltd", name: "Jo", email: "jo@beta.co.uk" });
  assert.strictEqual(store.pendingAccessRequestCount(), 2, "two pending now");

  // Mark the first (Acme) done.
  const acme = store.recentAccessRequests(10).find((r) => r.company === "Acme Construction");
  store.markAccessRequestDone(acme.id);
  assert.strictEqual(store.pendingAccessRequestCount(), 1, "one pending after marking one done");

  // 'new' requests sort ahead of 'done' ones.
  const ordered = store.recentAccessRequests(10);
  assert.strictEqual(ordered[0].status, "new", "pending request listed first");
  assert.strictEqual(ordered[0].company, "Beta Ltd");
});

test("markAccessRequestEmailed stamps emailed_at", () => {
  const id = store.saveAccessRequest({ company: "Gamma", name: "Pat", email: "pat@gamma.co.uk" });
  store.markAccessRequestEmailed(id);
  const row = store.recentAccessRequests(10).find((r) => r.id === id);
  assert.ok(row.emailed_at, "emailed_at is set");
});

test("renderAccessRequestEmail escapes user input (no HTML injection)", () => {
  const { subject, html } = notify.renderAccessRequestEmail({
    company: '<script>alert(1)</script>Evil Co',
    name: "Mallory",
    email: "mallory@evil.example",
    received: "1 Jan 2026",
  });
  assert.ok(subject.includes("Portal access request"), "subject names the request");
  assert.ok(!html.includes("<script>alert(1)</script>"), "raw script tag is not present");
  assert.ok(html.includes("&lt;script&gt;"), "the company name is HTML-escaped");
});

test("sendAccessRequest sets reply-to to the requester and targets Tom's inbox", async () => {
  let captured = null;
  const fakeSend = async (to, subject, html, opts) => { captured = { to, subject, opts }; };
  await notify.sendAccessRequest({ company: "Acme", name: "Sam", email: "sam@acme.co.uk", received: "now" }, { send: fakeSend });
  assert.ok(captured, "send was called");
  assert.strictEqual(captured.to, "tom@designandsupply.co.uk", "goes to Tom by default");
  assert.strictEqual(captured.opts.replyTo, "sam@acme.co.uk", "reply-to is the requester");
});
