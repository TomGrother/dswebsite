/**
 * The df_ref value the contact and spec-pack forms pass on to DesignForce.
 * Run with:  node --test orderhub/tests
 */
const test = require("node:test");
const assert = require("node:assert");
const { cleanDfRef } = require("../../dfref");

// DesignForce's tracking script (public/t/s.js): each utm tag lower-cased,
// anything outside [a-z0-9_-] turned into "-", cut to 30 characters.
const tag = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 30);
const fromScript = (source, medium, campaign) => `DFSRC-${tag(source)}.${tag(medium)}.${tag(campaign)}`;
// DesignForce's own reading of it (db/person-source.js srcRef).
const dfReads = (ref) => /^DFSRC-([a-z0-9_-]*)\.([a-z0-9_-]*)\.([a-z0-9_-]*)$/.test(ref);

test("email references are kept as before", () => {
  assert.strictEqual(cleanDfRef("DFREF-Ab3dE5gH9jK1"), "DFREF-Ab3dE5gH9jK1");
  assert.strictEqual(cleanDfRef("  DFREF-abc_123-x  "), "DFREF-abc_123-x");
  assert.strictEqual(cleanDfRef("DFREF-"), "");
  assert.strictEqual(cleanDfRef("DFREF-" + "a".repeat(65)), "");
});

test("references from tagged posts, adverts and QR codes are kept", () => {
  for (const [s, m, c] of [
    ["LinkedIn", "social", "Spring Launch 2027"],
    ["instagram", "", ""],
    ["", "qr", "Hospital Expo"],
    ["google", "cpc", "x".repeat(80)],
    ["a".repeat(40), "b".repeat(40), "c".repeat(40)],
  ]) {
    const ref = fromScript(s, m, c);
    assert.strictEqual(cleanDfRef(ref), ref, ref);
    assert.ok(dfReads(ref), "DesignForce reads it too");
    assert.ok(ref.length <= 100, "within DesignForce's 100-character limit");
  }
});

test("anything else is dropped", () => {
  for (const bad of [
    "", null, undefined, "<x>", "DFSRC-", "DFSRC-..", "DFSRC-linkedin.social", "DFSRC-LinkedIn.social.x",
    "DFSRC-linked in.social.x", "DFSRC-a.b.c.d", `DFSRC-${"a".repeat(31)}.b.c`, "dfsrc-a.b.c", "DFREF-a.b",
  ]) assert.strictEqual(cleanDfRef(bad), "", String(bad));
});
