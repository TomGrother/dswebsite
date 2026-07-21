/**
 * Order Hub authentication & account management.
 *
 * - Passwords: argon2id (prebuilt @node-rs/argon2, no native build).
 * - Sessions: stateless HMAC-signed cookie (survives redeploys, no session
 *   table). The user is still re-loaded from the DB on every request so a
 *   disabled account is locked out immediately.
 */
const crypto = require("crypto");
const argon2 = require("@node-rs/argon2");
const { db, isGenericDomain, domainOf } = require("./db");

const COOKIE = "ds_portal";
const SESSION_HOURS = 12;
const SECRET =
  process.env.SESSION_SECRET ||
  (process.env.NODE_ENV === "production"
    ? null
    : "dev-only-insecure-secret-change-me");

if (!SECRET) {
  console.warn("[orderhub] SESSION_SECRET is not set — portal logins are disabled until it is.");
}

// ---- password hashing ------------------------------------------------------
const hashPassword = (pw) => argon2.hash(pw);
async function verifyPassword(hash, pw) {
  try {
    return await argon2.verify(hash, pw);
  } catch {
    return false;
  }
}

// ---- session cookie (HMAC signed) ------------------------------------------
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verifyToken(token) {
  if (!token || !SECRET) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

function issueSession(res, req, user) {
  const token = sign({ uid: user.id, role: user.role, iat: Date.now(), exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.protocol === "https",
    maxAge: SESSION_HOURS * 3600 * 1000,
    path: "/",
  });
}
function clearSession(res) {
  res.clearCookie(COOKIE, { path: "/" });
}

// ---- user store ------------------------------------------------------------
const getUserByEmail = (email) =>
  db.prepare("SELECT * FROM app_user WHERE email = ?").get(String(email || "").toLowerCase().trim());
const getUserById = (id) => db.prepare("SELECT * FROM app_user WHERE id = ?").get(id);
const listUsers = () =>
  db.prepare("SELECT id, email, role, display_name, is_active, created_at FROM app_user ORDER BY role, email").all();

async function createUser({ email, password, role = "customer", display_name = null }) {
  const clean = String(email || "").toLowerCase().trim();
  if (!clean || !clean.includes("@")) throw new Error("A valid email is required.");
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");
  if (getUserByEmail(clean)) throw new Error("An account with that email already exists.");
  const hash = await hashPassword(password);
  const info = db
    .prepare("INSERT INTO app_user (email, password_hash, role, display_name) VALUES (?,?,?,?)")
    .run(clean, hash, role === "staff" ? "staff" : "customer", display_name || null);
  return getUserById(info.lastInsertRowid);
}
async function setPassword(userId, password) {
  if (!password || password.length < 8) throw new Error("Password must be at least 8 characters.");
  const hash = await hashPassword(password);
  // Millisecond precision so a session issued moments before the change is still
  // (correctly) invalidated by the iat comparison in currentUser().
  db.prepare(
    "UPDATE app_user SET password_hash = ?, password_changed_at = strftime('%Y-%m-%d %H:%M:%f','now'), updated_at = datetime('now') WHERE id = ?"
  ).run(hash, userId);
}
function setActive(userId, active) {
  db.prepare("UPDATE app_user SET is_active = ?, updated_at = datetime('now') WHERE id = ?").run(active ? 1 : 0, userId);
}
function setRole(userId, role) {
  db.prepare("UPDATE app_user SET role = ?, updated_at = datetime('now') WHERE id = ?").run(
    role === "staff" ? "staff" : "customer",
    userId
  );
}

/** Verify credentials. Generic result — never reveals which part was wrong. */
async function authenticate(email, password) {
  const user = getUserByEmail(email);
  if (!user || !user.is_active) {
    // Still spend time hashing to blunt timing/user-enumeration.
    await hashPassword(password || "x").catch(() => {});
    return null;
  }
  const ok = await verifyPassword(user.password_hash, password || "");
  return ok ? user : null;
}

// ---- password reset (self-service) -----------------------------------------
const RESET_TTL_MIN = 60;
const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

/** Create a single-use reset token for a user; returns the RAW token (emailed).
 *  Only its SHA-256 is stored. Any earlier outstanding tokens are invalidated. */
function createResetToken(userId) {
  const raw = crypto.randomBytes(32).toString("base64url");
  db.prepare("DELETE FROM password_reset WHERE user_id = ? AND used_at IS NULL").run(userId);
  db.prepare(
    "INSERT INTO password_reset (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', ?))"
  ).run(userId, sha256(raw), `+${RESET_TTL_MIN} minutes`);
  return raw;
}

const findResetRow = (rawToken) =>
  rawToken
    ? db.prepare(
        "SELECT * FROM password_reset WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')"
      ).get(sha256(rawToken))
    : null;

/** The active user for a valid reset token (for showing the reset form), else null. */
function resetTokenUser(rawToken) {
  const row = findResetRow(rawToken);
  if (!row) return null;
  const user = getUserById(row.user_id);
  return user && user.is_active ? user : null;
}

/** Consume a reset token and set the new password. Returns {ok, user} / {ok:false, error}. */
async function resetPasswordWithToken(rawToken, newPassword) {
  if (!newPassword || newPassword.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  const row = findResetRow(rawToken);
  if (!row) return { ok: false, error: "This reset link is invalid or has expired — please request a new one." };
  const user = getUserById(row.user_id);
  if (!user || !user.is_active) return { ok: false, error: "This account isn't available. Please contact us." };
  // Claim the token (single-use); if it was used between the lookup and now, stop.
  const claimed = db.prepare("UPDATE password_reset SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL").run(row.id);
  if (claimed.changes !== 1) return { ok: false, error: "This reset link has already been used." };
  await setPassword(user.id, newPassword); // stamps password_changed_at -> invalidates older sessions
  db.prepare("DELETE FROM password_reset WHERE user_id = ? AND used_at IS NULL").run(user.id);
  return { ok: true, user };
}

// ---- domain map & per-user overrides --------------------------------------
const listMappings = () =>
  db.prepare("SELECT id, domain, customer_acc_ref FROM domain_account_map ORDER BY domain, customer_acc_ref").all();

function addMapping(domain, ref) {
  const d = String(domain || "").toLowerCase().trim().replace(/^@/, "");
  const r = String(ref || "").trim();
  if (!d || !d.includes(".")) throw new Error("Enter a valid domain, e.g. acme.co.uk");
  if (!r) throw new Error("A customer_acc_ref is required.");
  if (isGenericDomain(d))
    throw new Error(`"${d}" is a shared/free email domain and can't be mapped — use a per-user ref override instead.`);
  db.prepare("INSERT OR IGNORE INTO domain_account_map (domain, customer_acc_ref) VALUES (?,?)").run(d, r);
}
const removeMapping = (id) => db.prepare("DELETE FROM domain_account_map WHERE id = ?").run(id);

const listOverrides = (userId) =>
  db.prepare("SELECT id, customer_acc_ref FROM user_ref_override WHERE user_id = ? ORDER BY customer_acc_ref").all(userId);
function addOverride(userId, ref) {
  const r = String(ref || "").trim();
  if (!r) throw new Error("A customer_acc_ref is required.");
  db.prepare("INSERT OR IGNORE INTO user_ref_override (user_id, customer_acc_ref) VALUES (?,?)").run(userId, r);
}
const removeOverride = (id) => db.prepare("DELETE FROM user_ref_override WHERE id = ?").run(id);

// ---- middleware ------------------------------------------------------------
function currentUser(req) {
  const payload = verifyToken(req.cookies ? req.cookies[COOKIE] : null);
  if (!payload) return null;
  const user = getUserById(payload.uid);
  if (!user || !user.is_active) return null;
  // Sessions issued before the password was last changed are invalidated (so a
  // password reset logs out any other active sessions).
  if (user.password_changed_at) {
    const changedMs = Date.parse(user.password_changed_at.replace(" ", "T") + "Z");
    if (!isNaN(changedMs) && (payload.iat || 0) < changedMs) return null;
  }
  return user;
}
function requireUser(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.redirect("/portal/login?next=" + encodeURIComponent(req.originalUrl));
  req.portalUser = user;
  next();
}
function requireStaff(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.redirect("/portal/login?next=" + encodeURIComponent(req.originalUrl));
  if (user.role !== "staff") return res.status(403).type("html").send("<p style='font-family:sans-serif;padding:40px'>403 — staff access only. <a href='/portal'>Back</a></p>");
  req.portalUser = user;
  next();
}

module.exports = {
  COOKIE,
  hasSecret: () => !!SECRET,
  hashPassword,
  verifyPassword,
  authenticate,
  issueSession,
  clearSession,
  currentUser,
  requireUser,
  requireStaff,
  // user store
  getUserByEmail,
  getUserById,
  listUsers,
  createUser,
  setPassword,
  setActive,
  setRole,
  // password reset
  createResetToken,
  resetTokenUser,
  resetPasswordWithToken,
  // mappings & overrides
  listMappings,
  addMapping,
  removeMapping,
  listOverrides,
  addOverride,
  removeOverride,
  domainOf,
  isGenericDomain,
};
