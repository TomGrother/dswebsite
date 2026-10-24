/**
 * Specification pack (downloads page): validation, consent handling, emails.
 * Run with:  node --test orderhub/tests
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "spec-pack-"));
delete process.env.ENQUIRY_TO;

const specpack = require("../../specpack");
const store = require("../../db");

function call(body, send, post) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(j) { resolve({ status: this.statusCode, body: j }); },
    };
    specpack.handler({ send, post: post || (async () => {}) })({ body }, res);
  });
}
const latest = () => store.specPackRequests()[0];

test("spec pack: validates name and email", () => {
  assert.strictEqual(specpack.parseRequest({ email: "a@b.co" }).ok, false, "name required");
  assert.strictEqual(specpack.parseRequest({ name: "A", email: "not-an-email" }).ok, false, "valid email required");
  const ok = specpack.parseRequest({ name: " Ann Smith ", email: " Ann@Example.CO.UK ", company: " Acme " });
  assert.deepStrictEqual([ok.request.name, ok.request.email, ok.request.company], ["Ann Smith", "ann@example.co.uk", "Acme"]);
});

test("spec pack: marketing consent only from the explicit opt-in, with its wording", () => {
  assert.strictEqual(specpack.parseRequest({ name: "A", email: "a@b.co" }).request.marketing_consent, false);
  assert.strictEqual(specpack.parseRequest({ name: "A", email: "a@b.co", marketing: "on" }).request.marketing_consent, false);
  const yes = specpack.parseRequest({ name: "A", email: "a@b.co", marketing: "yes" }).request;
  assert.strictEqual(yes.marketing_consent, true);
  assert.match(yes.consent_text, /product news/);
  assert.strictEqual(specpack.parseRequest({ name: "A", email: "a@b.co", df_ref: "<x>" }).request.df_ref, "", "malformed ref dropped");
  assert.strictEqual(specpack.parseRequest({ name: "A", email: "a@b.co", df_ref: "DFREF-abc123" }).request.df_ref, "DFREF-abc123");
});

test("spec pack: emails the pack to the visitor and the lead to sales, and records consent", async () => {
  const sent = [];
  const r = await call({ name: "Ann Smith", email: "ann@example.co.uk", company: "Acme", marketing: "yes" }, async (...a) => sent.push(a));
  assert.deepStrictEqual(r, { status: 200, body: { ok: true } });
  assert.strictEqual(sent.length, 2);
  const [toVisitor, toSales] = sent;
  assert.strictEqual(toVisitor[0], "ann@example.co.uk");
  assert.strictEqual(toVisitor[3].replyTo, "sales@designandsupply.co.uk", "replies from the visitor reach sales");
  assert.strictEqual(toSales[0], "sales@designandsupply.co.uk");
  assert.strictEqual(toSales[3].replyTo, "ann@example.co.uk");
  assert.match(toSales[2], /opted in to product news/);
  const row = latest();
  assert.strictEqual(row.marketing_consent, 1);
  assert.match(row.consent_text, /product news/);
  assert.ok(row.emailed_at, "marked as emailed");
});

test("spec pack: the pack is still sent without consent, and none is recorded", async () => {
  const sent = [];
  await call({ name: "Bob", email: "bob@example.com" }, async (...a) => sent.push(a));
  assert.strictEqual(sent.length, 2, "pack + sales notification");
  assert.match(sent[1][2], /do not add to marketing campaigns/);
  const row = latest();
  assert.strictEqual(row.marketing_consent, 0);
  assert.strictEqual(row.consent_text, null);
});

test("spec pack: every document in the manifest is linked in the email", () => {
  const m = specpack.manifest();
  const { html } = specpack.renderPackEmail({ name: "Ann", email: "a@b.co", marketing_consent: false }, m);
  const urls = m.sections.flatMap((s) => s.docs.map((d) => d.url));
  assert.ok(urls.length >= 20, "manifest lists the documents");
  for (const u of urls) assert.ok(html.includes(u), `email links ${u}`);
});

test("spec pack: honeypot submissions are dropped silently", async () => {
  const before = store.specPackRequests().length;
  let sends = 0;
  const r = await call({ name: "Bot", email: "bot@spam.example", website: "http://spam" }, async () => { sends++; });
  assert.strictEqual(r.body.ok, true);
  assert.strictEqual(store.specPackRequests().length, before);
  assert.strictEqual(sends, 0);
});

test("spec pack: a failed pack email is reported and recorded", async () => {
  const r = await call({ name: "Cat", email: "cat@example.com" }, async () => { throw new Error("Resend 500"); });
  assert.strictEqual(r.status, 502);
  assert.strictEqual(r.body.ok, false);
  assert.match(latest().error, /Resend 500/);
});

test("spec pack: CSV export neutralises spreadsheet formulas", () => {
  const csv = specpack.toCsv([{ created_at: "2026-10-24", name: "=HYPERLINK(\"http://x\")", email: "a@b.co", company: "+44 Ltd", marketing_consent: 1, consent_text: "Yes", df_ref: "", emailed_at: "", error: "" }]);
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"")"`), "leading = is escaped");
  assert.ok(csv.includes(`"'+44 Ltd"`), "leading + is escaped");
  assert.ok(csv.split("\r\n")[0].startsWith("requested_at,name,email"));
});

// ---- DesignForce push ------------------------------------------------------
test("designforce: off until both settings exist", () => {
  delete process.env.DESIGNFORCE_MARKETING_URL; delete process.env.DESIGNFORCE_MARKETING_KEY;
  assert.strictEqual(specpack.designforceEnabled(), false);
  process.env.DESIGNFORCE_MARKETING_URL = "https://df.example/api/marketing/contacts";
  assert.strictEqual(specpack.designforceEnabled(), false, "URL alone is not enough");
  process.env.DESIGNFORCE_MARKETING_KEY = "test-key";
  assert.strictEqual(specpack.designforceEnabled(), true);
  delete process.env.DESIGNFORCE_MARKETING_URL; delete process.env.DESIGNFORCE_MARKETING_KEY;
});

test("designforce: opted-in requests are pushed after responding, with the consent record", async () => {
  const pushed = [];
  const post = async (p) => pushed.push(p);
  await call({ name: "Dee Jones", email: "Dee@Example.com", company: "Builders Ltd", marketing: "yes", df_ref: "DFREF-xyz9" }, async () => {}, post);
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(pushed.length, 1);
  const p = pushed[0];
  assert.match(p.external_id, /^spec-pack-\d+$/);
  assert.deepStrictEqual([p.email, p.name, p.company, p.source, p.df_ref], ["dee@example.com", "Dee Jones", "Builders Ltd", "website-spec-pack", "DFREF-xyz9"]);
  assert.strictEqual(p.consent.given, true);
  assert.match(p.consent.text, /product news/);
  assert.ok(!Number.isNaN(Date.parse(p.consent.given_at)), "ISO timestamp");
  assert.ok(latest().designforce_synced_at, "marked as sent");
});

test("designforce: requests without consent are never pushed", async () => {
  const pushed = [];
  await call({ name: "Eve", email: "eve@example.com" }, async () => {}, async (p) => pushed.push(p));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(pushed.length, 0);
  assert.strictEqual(latest().designforce_synced_at, null);
  assert.strictEqual(await specpack.syncRow(latest(), async () => { throw new Error("must not be called"); }), false);
});

test("designforce: failures are recorded and picked up by the retry", async () => {
  await call({ name: "Fay", email: "fay@example.com", marketing: "yes" }, async () => {}, async () => { throw new Error("DesignForce 503: down"); });
  await new Promise((r) => setImmediate(r));
  assert.match(latest().designforce_error, /503/);
  const ids = store.specPackPendingDesignForce().map((r) => r.id);
  assert.ok(ids.includes(latest().id), "failed contact is pending");
  const sent = [];
  const res = await specpack.syncPending(async (p) => sent.push(p.email));
  assert.ok(sent.includes("fay@example.com"));
  assert.strictEqual(res.failed, 0);
  assert.strictEqual(store.specPackPendingDesignForce().length, 0, "nothing left pending");
  assert.strictEqual(latest().designforce_error, null, "error cleared once sent");
});
