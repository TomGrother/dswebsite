/**
 * Order Hub web routes: customer order views + staff admin area.
 * Server-rendered HTML reusing the marketing site's design system (style.css).
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const store = require("./db");
const auth = require("./auth");
const notify = require("./notify");
const { resolvePaint } = require("./paint");

const router = express.Router();

// Content-hash the stylesheet so the portal always fetches the current CSS
// (the marketing pages do this via build.js; portal pages are rendered live,
// so without it a 7-day-cached copy can go stale after a deploy).
let CSS_V = "";
try {
  CSS_V = crypto.createHash("md5").update(fs.readFileSync(path.join(__dirname, "..", "public", "css", "style.css"))).digest("hex").slice(0, 10);
} catch { /* leave unversioned if unreadable */ }
const CSS_HREF = "/css/style.css" + (CSS_V ? "?v=" + CSS_V : "");

// Site chrome: reuse the marketing site's baked header (logo + main nav) so the
// portal looks and navigates exactly like the rest of the site. Extracted from
// the built home page at boot — links, cache-busted main.js and the Customer
// Portal nav item are already processed there by build.js.
let SITE_HEADER = "";
let JS_HREF = "/js/main.js";
try {
  const built = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  const m = built.match(/<!--HEADER-->([\s\S]*?)<!--\/HEADER-->/);
  if (m) SITE_HEADER = m[1];
  const j = built.match(/\/js\/main\.js\?v=[a-f0-9]+/);
  if (j) JS_HREF = j[0];
} catch { /* fall back to the portal-only bar */ }

// ---- helpers ---------------------------------------------------------------
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  if (isNaN(d)) return esc(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
const STAGE_LABELS = { program: "Programming", punch: "Punch", bend: "Bend", weld: "Weld", buff: "Buff", paint: "Paint", pack: "Pack" };

// If the last successful sync is older than this, flag the freshness amber — a
// stalled sync pipeline should be visible to staff and customers alike.
const STALE_SYNC_MINS = 120;

// Format a sync_log.ran_at (UTC "YYYY-MM-DD HH:MM:SS") as friendly relative +
// absolute UK time, plus how many minutes ago it was.
function fmtSyncStamp(ranAt) {
  const d = new Date(String(ranAt).replace(" ", "T") + "Z");
  if (isNaN(d)) return { rel: esc(ranAt), abs: "", mins: Infinity };
  const abs = d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/London",
  });
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  let rel;
  if (mins < 1) rel = "just now";
  else if (mins < 60) rel = `${mins} minute${mins === 1 ? "" : "s"} ago`;
  else if (mins < 1440) { const h = Math.round(mins / 60); rel = `${h} hour${h === 1 ? "" : "s"} ago`; }
  else { const days = Math.round(mins / 1440); rel = `${days} day${days === 1 ? "" : "s"} ago`; }
  return { rel, abs, mins };
}

// The "Production data last updated …" strip shown in the header for every
// logged-in user (customer and staff).
function syncStrip() {
  const last = store.lastSuccessfulSync();
  if (!last) {
    return `<div class="sync-strip"><div class="container"><span class="sync-dot stale"></span>Awaiting first data sync</div></div>`;
  }
  const { rel, abs, mins } = fmtSyncStamp(last.ran_at);
  const stale = mins >= STALE_SYNC_MINS;
  return `<div class="sync-strip${stale ? " stale" : ""}"><div class="container">` +
    `<span class="sync-dot${stale ? " stale" : ""}"></span>` +
    `Production data last updated <b>${esc(rel)}</b>` +
    `${abs ? ` <span class="sync-abs">${esc(abs)}</span>` : ""}` +
    `</div></div>`;
}

function page(title, body, opts = {}) {
  const user = opts.user;
  const staff = user && user.role === "staff";
  const tabs = user
    ? `<div class="portal-tabs"><a href="/portal">My Orders</a>${staff ? '<a href="/portal/admin">Admin</a>' : '<a href="/portal/preferences">Email preferences</a>'}</div>`
    : "";
  const right = user
    ? `<div><span style="color:#9ab0a8">${esc(user.display_name || user.email)}</span> &nbsp;&nbsp; <a href="/portal/logout">Log out</a></div>`
    : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} | Design &amp; Supply Customer Portal</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${CSS_HREF}">
<link rel="icon" href="/images/favicon.png">
</head><body data-page="portal">
${SITE_HEADER}
<div class="portal-bar"><div class="container">
  <div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap">
    <a href="/portal" style="font-family:var(--font-display);font-size:17px;letter-spacing:1px;text-transform:uppercase">Customer Portal</a>
    ${tabs}
  </div>
  ${right}
</div></div>
${user ? syncStrip() : ""}
<section class="section" style="padding:40px 0"><div class="container">${body}</div></section>
<script src="${JS_HREF}" defer></script>
</body></html>`;
}

function renderTracker(door) {
  const firstIdx = door.stages.findIndex((s) => !s.done);
  const steps = door.stages
    .map((s, i) => {
      const cls = s.done ? "done" : i === firstIdx ? "current" : "";
      const inner = s.done ? "&#10003;" : i + 1;
      return `<div class="step ${cls}"><div class="dot">${inner}</div><div class="label">${STAGE_LABELS[s.key]}</div></div>`;
    })
    .join("");
  return `<div class="tracker ${door.onHold ? "hold" : ""}">${steps}</div>`;
}

function doorBadge(door) {
  if (door.onHold) return '<span class="badge badge-hold">On Hold</span>';
  if (door.packed) return '<span class="badge badge-packed">Packed</span>';
  return `<span class="badge badge-${door.statusTone}">${esc(door.statusLabel)}</span>`;
}

// A small colour swatch + label for a paint description (RAL/BS). Unknown
// colours get a neutral hatched swatch rather than a guessed colour.
function paintChip(desc) {
  const r = resolvePaint(desc);
  if (!r) return "";
  const sw = r.hex
    ? `<span class="paint-sw" style="background:${r.hex}"></span>`
    : `<span class="paint-sw unknown" title="Colour reference"></span>`;
  return `<span class="paint-chip">${sw}<span>${esc(r.label)}</span></span>`;
}

// Finish + paint colour(s) line for a door.
function renderDoorSpec(door) {
  const bits = [door.paint_colour_1, door.paint_colour_2].filter(Boolean).map(paintChip).filter(Boolean);
  if (door.finish_description && !/^\s*no finish\s*$/i.test(door.finish_description)) {
    bits.push(`<span class="finish-tag">Finish: <b>${esc(door.finish_description)}</b></span>`);
  }
  return bits.length ? `<div class="door-spec">${bits.join("")}</div>` : "";
}

function renderDoorRow(door, opts = {}) {
  // door_ref is how the customer recognises their door — show it prominently.
  const doorRef = door.door_ref ? `<span class="door-ref">${esc(door.door_ref)}</span>` : "";
  const parts = [];
  // On-hold doors have no meaningful scheduled completion — don't show one.
  if (!door.onHold) parts.push(`Scheduled Completion: ${fmtDate(door.date_completion)}`);
  if (opts.showRef) parts.push(`Acc: ${esc(door.customer_acc_ref)}`);
  const metaText = parts.length ? parts.join(" &nbsp;·&nbsp; ") + " &nbsp;·&nbsp; " : "";
  return `<div class="door-row">
    <div class="door-row-top">
      <b><span class="door-no">Door #${esc(door.id)}</span>${doorRef ? " " + doorRef : ""} ${esc(door.door_type_description || "Doorset")}</b>
      <span class="door-row-meta">${metaText}${doorBadge(door)}</span>
    </div>
    ${renderDoorSpec(door)}
    ${renderTracker(door)}
  </div>`;
}

function renderOrder(o, opts = {}) {
  const badges = [];
  if (o.onHold) badges.push(`<span class="badge badge-hold">${o.onHold} On Hold</span>`);
  badges.push(`<span class="badge ${o.allPacked ? "badge-packed" : "badge-active"}">${esc(o.summary)}</span>`);
  const sub = [o.order_ref ? `Ref: ${esc(o.order_ref)}` : "", opts.showRef ? `Acc: ${esc(o.doors[0].customer_acc_ref)}` : ""]
    .filter(Boolean).join(" · ");
  // Make on-hold orders unmistakable: amber-flagged card + a notice banner.
  const holdNote = o.onHold
    ? `<div class="order-hold-note">On hold — ${o.onHold} door${o.onHold > 1 ? "s are" : " is"} paused and not currently progressing through production. Our team will be in touch; please contact us if you need an update.</div>`
    : "";
  return `<div class="order-card${o.onHold ? " has-hold" : ""}">
    <div class="order-head">
      <div><h3>Order ${esc(o.order_number || o.order_id)}</h3><span class="order-sub">${sub}</span></div>
      <div class="order-summary">${badges.join("")}</div>
    </div>
    ${holdNote}
    ${o.doors.map((d) => renderDoorRow(d, opts)).join("")}
  </div>`;
}

// ---- login / logout --------------------------------------------------------
router.get("/login", (req, res) => {
  if (auth.currentUser(req)) return res.redirect("/portal");
  const bad = req.query.bad ? '<p style="color:#b00;margin-bottom:14px">Incorrect email or password.</p>' : "";
  const okNote = req.query.reset
    ? '<p style="color:var(--accent-dark);background:var(--accent-soft);padding:10px 14px;border-radius:8px;margin-bottom:14px">Your password has been reset — please sign in with your new password.</p>'
    : "";
  const disabled = !auth.hasSecret()
    ? '<p style="color:#b00">Login is unavailable until SESSION_SECRET is configured.</p>'
    : "";
  const next = esc(req.query.next || "/portal");
  res.send(
    page(
      "Log in",
      `<div class="auth-wrap">
        <span class="kicker">Order Hub</span>
        <h1>Track Your <em style="font-style:normal;color:var(--accent)">Order</em></h1>
        <p style="color:var(--slate);margin:8px 0 22px">Sign in to follow your doors through production.</p>
        ${okNote}${bad}${disabled}
        <form method="post" action="/portal/login" class="form">
          <input type="hidden" name="next" value="${next}">
          <div><label for="email">Email</label><input type="email" id="email" name="email" required autofocus autocomplete="username"></div>
          <div><label for="password">Password</label><input type="password" id="password" name="password" required autocomplete="current-password"></div>
          <div style="text-align:right;margin-top:-6px"><a href="/portal/forgot" style="font-size:13px;color:var(--slate)">Forgot your password?</a></div>
          <div><button class="btn btn-primary" type="submit">Sign in</button></div>
        </form>
        <p style="color:var(--slate);font-size:14px;margin-top:22px">No account? Contact us on <a href="tel:01685350114">01685 350 114</a> or <a href="mailto:sales@designandsupply.co.uk">sales@designandsupply.co.uk</a>.</p>
      </div>`
    )
  );
});

// ---- password reset (self-service; sign-up stays in-house) ------------------
router.get("/forgot", (req, res) => {
  if (auth.currentUser(req)) return res.redirect("/portal");
  const sent = req.query.sent
    ? '<p style="color:var(--accent-dark);background:var(--accent-soft);padding:12px 14px;border-radius:8px;margin-bottom:14px">If an account exists for that email, we\'ve sent a link to reset your password. It expires in 60 minutes — please check your inbox (and spam).</p>'
    : "";
  const form = req.query.sent
    ? ""
    : `<form method="post" action="/portal/forgot" class="form">
        <div><label for="email">Email</label><input type="email" id="email" name="email" required autofocus autocomplete="username"></div>
        <div><button class="btn btn-primary" type="submit">Email me a reset link</button></div>
      </form>`;
  res.send(
    page(
      "Reset password",
      `<div class="auth-wrap">
        <span class="kicker">Order Hub</span>
        <h1>Reset Your <em style="font-style:normal;color:var(--accent)">Password</em></h1>
        <p style="color:var(--slate);margin:8px 0 22px">Enter the email address for your account and we'll send you a link to set a new password.</p>
        ${sent}${form}
        <p style="color:var(--slate);font-size:14px;margin-top:22px"><a href="/portal/login">&larr; Back to sign in</a></p>
      </div>`
    )
  );
});

router.post("/forgot", async (req, res) => {
  // Always respond the same way (no account enumeration).
  const done = () => res.redirect("/portal/forgot?sent=1");
  try {
    const user = auth.getUserByEmail(req.body.email);
    if (user && user.is_active) {
      const token = auth.createResetToken(user.id);
      const resetUrl = `${req.protocol}://${req.get("host")}/portal/reset?token=${encodeURIComponent(token)}`;
      if (notify.isEnabled()) {
        await notify.sendPasswordReset(user.email, resetUrl).catch((e) => console.error("[reset] send failed:", e.message));
      } else {
        console.warn("[reset] RESEND_API_KEY not set — reset link for", user.email, ":", resetUrl);
      }
    }
  } catch (e) {
    console.error("[reset] error:", e.message);
  }
  done();
});

router.get("/reset", (req, res) => {
  const user = auth.resetTokenUser(req.query.token);
  if (!user) {
    return res.send(
      page(
        "Reset password",
        `<div class="auth-wrap">
          <span class="kicker">Order Hub</span>
          <h1>Link <em style="font-style:normal;color:var(--accent)">Expired</em></h1>
          <p style="color:var(--slate);margin:8px 0 22px">This password reset link is invalid or has expired. Reset links can be used once and last 60 minutes.</p>
          <a class="btn btn-primary" href="/portal/forgot">Request a new link</a>
        </div>`
      )
    );
  }
  const bad = req.query.bad ? `<p style="color:#b00;margin-bottom:14px">${esc(req.query.bad)}</p>` : "";
  res.send(
    page(
      "Reset password",
      `<div class="auth-wrap">
        <span class="kicker">Order Hub</span>
        <h1>Choose a New <em style="font-style:normal;color:var(--accent)">Password</em></h1>
        <p style="color:var(--slate);margin:8px 0 22px">Setting a new password for <b>${esc(user.email)}</b>.</p>
        ${bad}
        <form method="post" action="/portal/reset" class="form">
          <input type="hidden" name="token" value="${esc(req.query.token)}">
          <div><label for="password">New password</label><input type="password" id="password" name="password" required minlength="8" autofocus autocomplete="new-password"></div>
          <div><label for="confirm">Confirm new password</label><input type="password" id="confirm" name="confirm" required minlength="8" autocomplete="new-password"></div>
          <div><button class="btn btn-primary" type="submit">Set new password</button></div>
        </form>
        <p style="color:var(--slate);font-size:13px;margin-top:16px">Use at least 8 characters.</p>
      </div>`
    )
  );
});

router.post("/reset", async (req, res) => {
  const token = req.body.token || "";
  const back = (msg) => res.redirect("/portal/reset?token=" + encodeURIComponent(token) + "&bad=" + encodeURIComponent(msg));
  if ((req.body.password || "") !== (req.body.confirm || "")) return back("Passwords don't match.");
  const result = await auth.resetPasswordWithToken(token, req.body.password || "");
  if (!result.ok) {
    // If the token itself is dead, send them to request a fresh one.
    if (/invalid|expired|used/i.test(result.error)) return res.redirect("/portal/forgot");
    return back(result.error);
  }
  res.redirect("/portal/login?reset=1");
});

router.post("/login", async (req, res) => {
  const user = await auth.authenticate(req.body.email, req.body.password);
  if (!user) return res.redirect("/portal/login?bad=1");
  auth.issueSession(res, req, user);
  const next = typeof req.body.next === "string" && req.body.next.startsWith("/portal") ? req.body.next : "/portal";
  res.redirect(next);
});

router.get("/logout", (req, res) => {
  auth.clearSession(res);
  res.redirect("/portal/login");
});

// ---- customer views --------------------------------------------------------
router.get("/", auth.requireUser, (req, res) => {
  const q = (req.query.q || "").toString().trim();
  const orders = store.ordersForUser(req.portalUser, { search: q });
  const toolbar = `<form method="get" class="toolbar">
    <input type="search" name="q" value="${esc(q)}" placeholder="Search order number or ref…" style="min-width:260px">
    <button class="btn btn-dark" type="submit">Search</button>
    ${q ? '<a class="card-link" href="/portal" style="align-self:center">Clear</a>' : ""}
  </form>`;
  const body = orders.length
    ? orders.map((o) => renderOrder(o)).join("")
    : `<div class="empty-state"><h3 style="font-size:22px">No live orders${q ? " match your search" : ""}</h3><p>${q ? "Try a different order number or reference." : "Orders in production will appear here. If you're expecting one, get in touch."}</p></div>`;
  res.send(
    page(
      "My Orders",
      `<span class="kicker">Order Hub</span><h1>Your <em style="font-style:normal;color:var(--accent)">Orders</em></h1>
       <p style="color:var(--slate);margin:6px 0 26px">Live and recently completed orders. Each door shows its progress through production.</p>
       ${toolbar}${body}`,
      { user: req.portalUser }
    )
  );
});

router.get("/orders/:orderId", auth.requireUser, (req, res) => {
  const o = store.orderForUser(req.portalUser, req.params.orderId);
  if (!o) return res.status(404).send(page("Not found", '<div class="empty-state"><h3>Order not found</h3><p><a href="/portal">Back to your orders</a></p></div>', { user: req.portalUser }));
  res.send(
    page(
      "Order " + (o.order_number || o.order_id),
      `<a class="card-link" href="/portal">&larr; All orders</a>
       <h1 style="margin-top:12px">Order <em style="font-style:normal;color:var(--accent)">${esc(o.order_number || o.order_id)}</em></h1>
       ${renderOrder(o)}`,
      { user: req.portalUser }
    )
  );
});

// ---- email preferences (customer) ------------------------------------------
function hourLabel(h) {
  const ap = h < 12 ? "am" : "pm";
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${ap}`;
}
function hourSelect(name, selected) {
  let opts = "";
  for (let h = 6; h <= 20; h++) {
    opts += `<option value="${h}"${h === Number(selected) ? " selected" : ""}>${hourLabel(h)}</option>`;
  }
  return `<select name="${name}" style="padding:7px 10px;border:1px solid var(--line);border-radius:8px;font-size:14px">${opts}</select>`;
}

function prefsBody(user, msg) {
  const p = store.getPrefs(user.id) || {};
  const off = !notify.isEnabled()
    ? `<p style="background:#fff3ec;color:#9a3412;border:1px solid #f2c4a3;padding:10px 16px;border-radius:8px">Email sending is not switched on yet — your choices are saved, but no emails go out until it's enabled on the server.</p>`
    : "";
  return `<span class="kicker">Order Hub</span><h1>Email <em style="font-style:normal;color:var(--accent)">Preferences</em></h1>
    <p style="color:var(--slate);margin:6px 0 22px">Choose which emails you'd like and when they arrive. Changes take effect from the next day's send.</p>
    ${msg ? `<p style="background:var(--accent-soft);color:var(--accent-dark);padding:10px 16px;border-radius:8px">${esc(msg)}</p>` : ""}
    ${off}
    <form method="post" action="/portal/preferences" style="max-width:640px">
      <div class="pref-card">
        <label class="pref-toggle"><input type="checkbox" name="digest_enabled" value="1"${p.digest_enabled ? " checked" : ""}> <b>Daily updates summary</b></label>
        <p class="pref-note">A short email listing what changed on your doors that day — packed, put on hold, or newly added. Only sent on days something actually changes.</p>
        <div class="pref-time">Send at ${hourSelect("digest_hour", p.digest_hour)} <span style="color:var(--slate)">UK time</span></div>
      </div>
      <div class="pref-card">
        <label class="pref-toggle"><input type="checkbox" name="snapshot_enabled" value="1"${p.snapshot_enabled ? " checked" : ""}> <b>Daily orders snapshot</b></label>
        <p class="pref-note">A full daily overview of all your live orders and each door's current production stage.</p>
        <div class="pref-time">Send at ${hourSelect("snapshot_hour", p.snapshot_hour)} <span style="color:var(--slate)">UK time</span></div>
      </div>
      <button class="btn btn-primary" type="submit" style="margin-top:8px">Save preferences</button>
    </form>
    <p style="margin-top:22px;font-size:13px"><a href="/portal/change-password" style="color:var(--accent);font-weight:600">Change your password</a></p>`;
}

router.get("/preferences", auth.requireUser, (req, res) => {
  res.send(page("Email preferences", prefsBody(req.portalUser, req.query.msg), { user: req.portalUser }));
});
router.post("/preferences", auth.requireUser, (req, res) => {
  const clampHour = (v, d) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= 0 && n <= 23 ? n : d; };
  store.setPrefs(req.portalUser.id, {
    digest_enabled: req.body.digest_enabled === "1",
    digest_hour: clampHour(req.body.digest_hour, 7),
    snapshot_enabled: req.body.snapshot_enabled === "1",
    snapshot_hour: clampHour(req.body.snapshot_hour, 8),
  });
  res.redirect("/portal/preferences?msg=" + encodeURIComponent("Preferences saved."));
});

// ---- change password (customer; forced on first login) ---------------------
function changePasswordBody(user, { error, forced } = {}) {
  return `<span class="kicker">Order Hub</span><h1>${forced ? "Set your " : "Change your "}<em style="font-style:normal;color:var(--accent)">password</em></h1>
    ${forced
      ? `<p style="background:#fff3ec;color:#9a3412;border:1px solid #f2c4a3;padding:10px 16px;border-radius:8px">You're signed in with a temporary password. Please set your own to continue.</p>`
      : `<p style="color:var(--slate);margin:6px 0 18px">Choose a new password for your account.</p>`}
    ${error ? `<p style="background:#fdecec;color:#a12020;border:1px solid #f0caca;padding:10px 16px;border-radius:8px">${esc(error)}</p>` : ""}
    <form method="post" action="/portal/change-password" class="form" style="max-width:420px">
      <div><label for="password">New password</label><input type="password" id="password" name="password" required autocomplete="new-password" autofocus></div>
      <div style="margin-top:12px"><label for="confirm">Confirm new password</label><input type="password" id="confirm" name="confirm" required autocomplete="new-password"></div>
      <p style="color:var(--slate);font-size:13px;margin:10px 0 14px">At least 8 characters, with an uppercase letter, a lowercase letter, a number and a symbol.</p>
      <button class="btn btn-primary" type="submit">Save password</button>
    </form>`;
}

router.get("/change-password", auth.requireUser, (req, res) => {
  res.send(page("Change password", changePasswordBody(req.portalUser, { forced: !!req.portalUser.must_change_password }), { user: req.portalUser }));
});
router.post("/change-password", auth.requireUser, async (req, res) => {
  const forced = !!req.portalUser.must_change_password;
  const pw = req.body.password || "";
  const problem = pw !== (req.body.confirm || "") ? "The two passwords don't match." : auth.passwordProblem(pw);
  if (problem) {
    return res.status(400).send(page("Change password", changePasswordBody(req.portalUser, { error: problem, forced }), { user: req.portalUser }));
  }
  await auth.setPassword(req.portalUser.id, pw); // clears must-change + stamps changed_at (invalidates the old session)
  auth.issueSession(res, req, auth.getUserById(req.portalUser.id)); // re-issue so they stay signed in
  res.redirect("/portal");
});

// ---- admin (staff only) ----------------------------------------------------
const admin = express.Router();
admin.use(auth.requireStaff);

admin.get("/", (req, res) => {
  const s = store.stats();
  const last = store.lastSync();
  const syncLine = last
    ? `${last.status === "ok" ? "✓" : "⚠"} ${esc(last.ran_at)} — received ${last.rows_received ?? "?"}, upserted ${last.rows_upserted ?? "?"}, removed ${last.rows_removed ?? "?"}${last.message ? " — " + esc(last.message) : ""}`
    : "No sync has run yet.";
  const lastDigest = store.lastDigest();
  const digestLine = !notify.isEnabled()
    ? "Disabled — set RESEND_API_KEY to enable the daily customer summary."
    : lastDigest
      ? `Last summary: ${esc(lastDigest.digest_date)} — ${lastDigest.recipients ?? 0} email(s), ${lastDigest.events ?? 0} change(s).`
      : "Enabled — no summary has been sent yet.";
  const msg = req.query.msg
    ? `<p style="background:var(--accent-soft);color:var(--accent-dark);padding:10px 16px;border-radius:8px">${esc(req.query.msg)}</p>`
    : "";
  const sendBtn = notify.isEnabled()
    ? `<form method="post" action="/portal/admin/digest/run" style="margin-top:10px" onsubmit="return confirm('Send the summary email now to every customer with pending updates?')">
        <button type="submit" class="btn btn-primary">Send daily summary now</button>
      </form>`
    : "";
  const broadcastBtn = notify.isEnabled()
    ? `<div style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">
        <p style="color:var(--slate);font-size:13px;margin-bottom:6px">Or email every customer a full snapshot of their current orders &amp; production stages now:</p>
        <form method="post" action="/portal/admin/orders-email/run" onsubmit="return confirm('Email EVERY customer with live orders a snapshot of their current orders and production stages now?')">
          <button type="submit" style="display:inline-block;background:#fff;border:1px solid var(--accent);color:var(--accent);font-weight:600;font-size:14px;padding:10px 20px;border-radius:8px;cursor:pointer">Email all customers their orders</button>
        </form>
      </div>`
    : "";
  res.send(
    page(
      "Admin",
      `<span class="kicker">Order Hub Admin</span><h1>Staff <em style="font-style:normal;color:var(--accent)">Dashboard</em></h1>
      ${msg}
      <div class="spec-strip" style="margin:24px 0 30px">
        <div><b>${s.orders}</b><span>Live orders</span></div>
        <div><b>${s.doors}</b><span>Doors in hub</span></div>
        <div><b>${s.onHold}</b><span>On hold</span></div>
      </div>
      <div class="grid grid-3">
        <a class="card" href="/portal/admin/orders"><h3>All Orders</h3><p>Every live order across all customers, with filters.</p><span class="card-link">Open</span></a>
        <a class="card" href="/portal/admin/accounts"><h3>Accounts</h3><p>Create customer/staff logins, set passwords, manage ref overrides.</p><span class="card-link">Open</span></a>
        <a class="card" href="/portal/admin/mappings"><h3>Domain Mappings</h3><p>Link email domains to customer_acc_ref values.</p><span class="card-link">Open</span></a>
      </div>
      <div class="grid grid-2" style="margin-top:22px">
        <div class="card"><h3>Sync Health</h3><p style="color:var(--slate)">${syncLine}</p><a class="card-link" href="/portal/admin/sync">View sync log</a></div>
        <div class="card"><h3>Customer Notifications</h3><p style="color:var(--slate)">${digestLine}</p><p style="color:var(--slate);font-size:13px">A once-a-day summary of packed, on-hold and new-door updates is emailed to each customer automatically.</p>${sendBtn}${broadcastBtn}</div>
      </div>`,
      { user: req.portalUser }
    )
  );
});

// Manual trigger for the daily digest (staff only). force:true bypasses the
// once-a-day guard; it still only sends where there are un-notified events.
admin.post("/digest/run", async (req, res) => {
  try {
    const r = await notify.runDigest({ force: true });
    const summary = r.skipped
      ? `Digest skipped (${r.skipped}).`
      : `Summary sent: ${r.emails} email(s) covering ${r.events} change(s).`;
    res.redirect("/portal/admin?msg=" + encodeURIComponent(summary));
  } catch (e) {
    res.redirect("/portal/admin?msg=" + encodeURIComponent("Digest failed: " + e.message));
  }
});

// Email every customer a snapshot of their current orders + production stages.
admin.post("/orders-email/run", async (req, res) => {
  try {
    const r = await notify.runOrdersBroadcast({});
    res.redirect("/portal/admin?msg=" + encodeURIComponent(
      `Order snapshot emailed to ${r.emails} customer(s); ${r.skipped} had no live orders.`
    ));
  } catch (e) {
    res.redirect("/portal/admin?msg=" + encodeURIComponent("Broadcast failed: " + e.message));
  }
});

admin.get("/orders", (req, res) => {
  const f = {
    search: (req.query.q || "").toString().trim(),
    acc_ref: (req.query.acc || "").toString().trim(),
    door_type: (req.query.type || "").toString().trim(),
    stage: (req.query.stage || "").toString().trim(),
    on_hold: req.query.hold === "1",
  };
  const orders = store.ordersForAdmin(f);
  const stageOpts = store.STAGES.map((s) => `<option value="${s}"${f.stage === s ? " selected" : ""}>${STAGE_LABELS[s]} done</option>`).join("");
  const toolbar = `<form method="get" class="toolbar">
    <input type="search" name="q" value="${esc(f.search)}" placeholder="Order no. / ref">
    <input type="text" name="acc" value="${esc(f.acc_ref)}" placeholder="customer_acc_ref">
    <input type="text" name="type" value="${esc(f.door_type)}" placeholder="Door type">
    <select name="stage"><option value="">Any stage</option>${stageOpts}</select>
    <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" name="hold" value="1"${f.on_hold ? " checked" : ""}> On hold</label>
    <button class="btn btn-dark" type="submit">Filter</button>
    <a class="card-link" href="/portal/admin/orders" style="align-self:center">Reset</a>
  </form>`;
  const body = orders.length
    ? orders.map((o) => renderOrder(o, { showRef: true })).join("")
    : '<div class="empty-state"><h3>No orders match</h3></div>';
  res.send(page("All Orders", `<a class="card-link" href="/portal/admin">&larr; Dashboard</a><h1 style="margin-top:12px">All <em style="font-style:normal;color:var(--accent)">Orders</em></h1>${toolbar}${body}`, { user: req.portalUser }));
});

function accountsBody(msg) {
  const users = auth.listUsers();
  const rows = users
    .map((u) => {
      const overrides = auth.listOverrides(u.id);
      const ovHtml = overrides.length
        ? overrides.map((o) => `<span class="pill pill-live">${esc(o.customer_acc_ref)} <form method="post" action="/portal/admin/overrides/${o.id}/delete" style="display:inline" onsubmit="return confirm('Remove override?')"><button type="submit" title="Remove override" style="background:none;border:0;color:#b00;cursor:pointer;padding:0;font:inherit">×</button></form></span>`).join(" ")
        : (u.role === "staff" ? '<span style="color:var(--slate)">all (staff)</span>' : '<span style="color:var(--slate)">by domain</span>');
      return `<tr>
        <td><b>${esc(u.email)}</b>${u.display_name ? "<br><span style='color:var(--slate);font-size:13px'>" + esc(u.display_name) + "</span>" : ""}</td>
        <td>${u.role}</td>
        <td><span class="pill ${u.is_active ? "pill-live" : "pill-draft"}">${u.is_active ? "Active" : "Disabled"}</span></td>
        <td>${ovHtml}
          <form method="post" action="/portal/admin/accounts/${u.id}/override" style="margin-top:6px;display:flex;gap:6px">
            <input type="text" name="ref" placeholder="add ref override" style="padding:5px 8px;border:1px solid var(--line);border-radius:6px;font-size:13px">
            <button class="btn btn-dark" style="padding:5px 12px;font-size:13px" type="submit">+</button>
          </form>
        </td>
        <td style="white-space:nowrap">
          <form method="post" action="/portal/admin/accounts/${u.id}/password" style="display:flex;gap:6px;margin-bottom:6px">
            <input type="text" name="password" placeholder="new password" style="padding:5px 8px;border:1px solid var(--line);border-radius:6px;font-size:13px">
            <button class="btn btn-dark" style="padding:5px 10px;font-size:13px" type="submit">Set</button>
          </form>
          <form method="post" action="/portal/admin/accounts/${u.id}/toggle"><button type="submit" style="background:none;border:0;color:${u.is_active ? "#b00" : "var(--accent)"};cursor:pointer;padding:0;font:inherit">${u.is_active ? "Disable" : "Enable"}</button></form>
        </td>
      </tr>`;
    })
    .join("");
  return `<a class="card-link" href="/portal/admin">&larr; Dashboard</a>
    <h1 style="margin-top:12px">Customer <em style="font-style:normal;color:var(--accent)">Accounts</em></h1>
    ${msg ? `<p style="background:var(--accent-soft);color:var(--accent-dark);padding:10px 16px;border-radius:8px">${esc(msg)}</p>` : ""}
    <div class="card" style="margin:20px 0">
      <h3>Create account</h3>
      <form method="post" action="/portal/admin/accounts" class="form" style="margin-top:14px">
        <div class="form-row">
          <div><label>Email</label><input type="email" name="email" required></div>
          <div><label>Display name (optional)</label><input type="text" name="display_name"></div>
        </div>
        <div class="form-row">
          <div><label>Temporary password <span style="font-weight:400;color:var(--slate);font-size:12px">(blank = auto-generate)</span></label><input type="text" name="password" placeholder="auto-generated if left blank"></div>
          <div><label>Role</label><select name="role"><option value="customer">Customer</option><option value="staff">Staff</option></select></div>
        </div>
        <div><button class="btn btn-primary" type="submit">Create account</button></div>
      </form>
    </div>
    <div class="table-scroll"><table class="admin-table">
      <tr><th>Email</th><th>Role</th><th>Status</th><th>Ref access</th><th>Actions</th></tr>${rows}
    </table></div>
    <p style="color:var(--slate);font-size:14px;margin-top:14px">Customers see orders for every <code>customer_acc_ref</code> mapped to their email domain, unless given explicit ref overrides here. Staff see everything.</p>`;
}

admin.get("/accounts", (req, res) => res.send(page("Accounts", accountsBody(req.query.msg), { user: req.portalUser })));

admin.post("/accounts", async (req, res) => {
  try {
    const provided = (req.body.password || "").trim();
    const tempPw = provided || auth.generateTempPassword();
    const role = req.body.role === "staff" ? "staff" : "customer";
    const user = await auth.createUser({ email: req.body.email, password: tempPw, role, display_name: req.body.display_name });
    let emailNote = "";
    if (role === "customer") {
      if (notify.isEnabled()) {
        try {
          await notify.sendWelcome(user, tempPw);
          emailNote = " A welcome email with these details has been sent to them.";
        } catch (err) {
          emailNote = ` <b style="color:#a12020">The welcome email failed to send (${esc(err.message)})</b> — pass the temporary password on manually.`;
        }
      } else {
        emailNote = " Email sending is off, so no welcome email was sent — pass the temporary password on manually.";
      }
    }
    const detail = (role === "customer" ? "They'll be asked to set their own password on first sign-in." : "") + emailNote;
    const notice = `<div style="background:var(--accent-soft);color:var(--accent-dark);padding:14px 18px;border-radius:8px;margin-bottom:18px">
      <b>Account created for ${esc(user.email)}.</b><br>
      Temporary password: <code style="background:#fff;border:1px solid var(--line);border-radius:5px;padding:2px 8px;font-size:15px">${esc(tempPw)}</code>
      ${detail ? `<div style="font-size:13px;margin-top:6px">${detail}</div>` : ""}
    </div>`;
    res.send(page("Accounts", notice + accountsBody(""), { user: req.portalUser }));
  } catch (e) {
    res.redirect("/portal/admin/accounts?msg=" + encodeURIComponent(e.message));
  }
});
admin.post("/accounts/:id/password", async (req, res) => {
  try { await auth.setPassword(Number(req.params.id), req.body.password); res.redirect("/portal/admin/accounts?msg=" + encodeURIComponent("Password updated.")); }
  catch (e) { res.redirect("/portal/admin/accounts?msg=" + encodeURIComponent(e.message)); }
});
admin.post("/accounts/:id/toggle", (req, res) => {
  const u = auth.getUserById(Number(req.params.id));
  if (u) auth.setActive(u.id, !u.is_active);
  res.redirect("/portal/admin/accounts");
});
admin.post("/accounts/:id/override", (req, res) => {
  try { auth.addOverride(Number(req.params.id), req.body.ref); res.redirect("/portal/admin/accounts?msg=" + encodeURIComponent("Override added.")); }
  catch (e) { res.redirect("/portal/admin/accounts?msg=" + encodeURIComponent(e.message)); }
});
admin.post("/overrides/:id/delete", (req, res) => { auth.removeOverride(Number(req.params.id)); res.redirect("/portal/admin/accounts"); });

admin.get("/mappings", (req, res) => {
  const maps = auth.listMappings();
  const rows = maps.length
    ? maps.map((m) => `<tr><td><b>${esc(m.domain)}</b></td><td>${esc(m.customer_acc_ref)}</td><td><form method="post" action="/portal/admin/mappings/${m.id}/delete"><button type="submit" style="background:none;border:0;color:#b00;cursor:pointer;padding:0;font:inherit" onclick="return confirm('Remove mapping?')">Remove</button></form></td></tr>`).join("")
    : '<tr><td colspan="3" style="color:var(--slate)">No mappings yet.</td></tr>';
  const msg = req.query.msg ? `<p style="background:var(--accent-soft);color:var(--accent-dark);padding:10px 16px;border-radius:8px">${esc(req.query.msg)}</p>` : "";
  res.send(
    page(
      "Domain Mappings",
      `<a class="card-link" href="/portal/admin">&larr; Dashboard</a>
       <h1 style="margin-top:12px">Domain <em style="font-style:normal;color:var(--accent)">Mappings</em></h1>${msg}
       <div class="card" style="margin:20px 0"><h3>Add mapping</h3>
        <form method="post" action="/portal/admin/mappings" class="form" style="margin-top:14px">
          <div class="form-row">
            <div><label>Email domain</label><input type="text" name="domain" placeholder="acme.co.uk" required></div>
            <div><label>customer_acc_ref</label><input type="text" name="ref" required></div>
          </div>
          <div><button class="btn btn-primary" type="submit">Add mapping</button></div>
        </form>
        <p style="color:var(--slate);font-size:14px;margin-top:10px">One domain can map to several refs. Free/shared domains (gmail, outlook…) are rejected — use per-account ref overrides for those.</p>
       </div>
       <div class="table-scroll"><table class="admin-table"><tr><th>Domain</th><th>customer_acc_ref</th><th></th></tr>${rows}</table></div>`,
      { user: req.portalUser }
    )
  );
});
admin.post("/mappings", (req, res) => {
  try { auth.addMapping(req.body.domain, req.body.ref); res.redirect("/portal/admin/mappings?msg=" + encodeURIComponent("Mapping added.")); }
  catch (e) { res.redirect("/portal/admin/mappings?msg=" + encodeURIComponent(e.message)); }
});
admin.post("/mappings/:id/delete", (req, res) => { auth.removeMapping(Number(req.params.id)); res.redirect("/portal/admin/mappings"); });

admin.get("/sync", (req, res) => {
  const logs = store.recentSyncs(25);
  const rows = logs.length
    ? logs.map((l) => `<tr><td>${esc(l.ran_at)}</td><td><span class="pill ${l.status === "ok" ? "pill-live" : "pill-draft"}">${esc(l.status)}</span></td><td>${l.rows_received ?? "—"}</td><td>${l.rows_upserted ?? "—"}</td><td>${l.rows_removed ?? "—"}</td><td>${esc(l.source || "")}</td><td style="color:var(--slate)">${esc(l.message || "")}</td></tr>`).join("")
    : '<tr><td colspan="7" style="color:var(--slate)">No syncs recorded yet.</td></tr>';
  res.send(
    page(
      "Sync Health",
      `<a class="card-link" href="/portal/admin">&larr; Dashboard</a>
       <h1 style="margin-top:12px">Sync <em style="font-style:normal;color:var(--accent)">Health</em></h1>
       <p style="color:var(--slate);margin:6px 0 20px">The internal push script upserts recent doors via the secured ingest endpoint. Last 25 runs:</p>
       <div class="table-scroll"><table class="admin-table"><tr><th>Ran at (UTC)</th><th>Status</th><th>Received</th><th>Upserted</th><th>Removed</th><th>Source</th><th>Message</th></tr>${rows}</table></div>`,
      { user: req.portalUser }
    )
  );
});

router.use("/admin", admin);

module.exports = router;
