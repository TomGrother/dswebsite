/**
 * Self-service password reset: token lifecycle + session invalidation.
 * Run with:  node --test orderhub/tests
 */
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "oh-reset-"));
process.env.SESSION_SECRET = "test-secret-reset";

const store = require("../db");
const auth = require("../auth");

// Capture the signed cookie issueSession() would set, to feed back to currentUser().
function captureSession(user) {
  let token;
  auth.issueSession({ cookie: (n, v) => { token = v; } }, { protocol: "http" }, user);
  return token;
}
const reqWith = (token) => ({ cookies: { [auth.COOKIE]: token } });

test("reset: token creates, resets the password, and is single-use", async () => {
  const u = await auth.createUser({ email: "c@acme.co.uk", password: "OldPassword1", role: "customer" });
  const token = auth.createResetToken(u.id);
  assert.strictEqual(auth.resetTokenUser(token)?.email, "c@acme.co.uk", "valid token maps to the user");

  const r = await auth.resetPasswordWithToken(token, "BrandNewPass9");
  assert.strictEqual(r.ok, true, "reset succeeds");
  assert.ok(await auth.authenticate("c@acme.co.uk", "BrandNewPass9"), "new password works");
  assert.strictEqual(await auth.authenticate("c@acme.co.uk", "OldPassword1"), null, "old password no longer works");

  const again = await auth.resetPasswordWithToken(token, "AnotherPass9");
  assert.strictEqual(again.ok, false, "token is single-use");
  assert.strictEqual(auth.resetTokenUser(token), null, "consumed token no longer valid");
});

test("reset: rejects short passwords (without burning the token) and bogus tokens", async () => {
  const u = await auth.createUser({ email: "d@acme.co.uk", password: "OldPassword1", role: "customer" });
  const token = auth.createResetToken(u.id);
  assert.strictEqual((await auth.resetPasswordWithToken(token, "short")).ok, false, "short password rejected");
  assert.ok(auth.resetTokenUser(token), "token survives a validation failure");
  assert.strictEqual((await auth.resetPasswordWithToken("not-a-real-token", "GoodPassword9")).ok, false, "bogus token rejected");
});

test("reset: expired tokens are rejected", async () => {
  const u = await auth.createUser({ email: "e@acme.co.uk", password: "OldPassword1", role: "customer" });
  const raw = "expired-raw-token-value";
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  store.db.prepare("INSERT INTO password_reset (user_id, token_hash, expires_at) VALUES (?,?, datetime('now','-1 hour'))").run(u.id, hash);
  assert.strictEqual(auth.resetTokenUser(raw), null, "expired token is not valid");
  assert.strictEqual((await auth.resetPasswordWithToken(raw, "GoodPassword9")).ok, false, "expired token can't reset");
});

test("reset: invalidates sessions issued before the password change", async () => {
  const u = await auth.createUser({ email: "s@acme.co.uk", password: "OldPassword1", role: "customer" });
  const old = captureSession(u);
  assert.ok(auth.currentUser(reqWith(old)), "a fresh session is valid");

  const token = auth.createResetToken(u.id);
  await auth.resetPasswordWithToken(token, "AfterResetPass9");

  assert.strictEqual(auth.currentUser(reqWith(old)), null, "the pre-reset session is now invalidated");
  const fresh = captureSession(auth.getUserById(u.id));
  assert.ok(auth.currentUser(reqWith(fresh)), "a session issued after the reset is valid");
});
