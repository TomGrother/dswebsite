/**
 * Order Hub web routes: customer order views + staff admin area.
 * Server-rendered HTML reusing the marketing site's design system (style.css).
 */
const express = require("express");
const store = require("./db");
const auth = require("./auth");

const router = express.Router();

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
const STAGE_LABELS = { punch: "Punch", bend: "Bend", weld: "Weld", buff: "Buff", paint: "Paint", pack: "Pack" };

function page(title, body, opts = {}) {
  const user = opts.user;
  const staff = user && user.role === "staff";
  const tabs = user
    ? `<div class="portal-tabs"><a href="/portal">My Orders</a>${staff ? '<a href="/portal/admin">Admin</a>' : ""}</div>`
    : "";
  const right = user
    ? `<div><span style="color:#9ab0a8">${esc(user.display_name || user.email)}</span> &nbsp;&nbsp; <a href="/portal/logout">Log out</a></div>`
    : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} | Design &amp; Supply Order Hub</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<link rel="icon" href="/images/favicon.png">
</head><body>
<div class="portal-bar"><div class="container">
  <div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap">
    <a href="/portal" style="font-family:var(--font-display);font-size:19px;letter-spacing:1px;text-transform:uppercase">Design &amp; Supply · Order Hub</a>
    ${tabs}
  </div>
  ${right}
</div></div>
<section class="section" style="padding:40px 0"><div class="container">${body}</div></section>
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

function renderDoorRow(door, opts = {}) {
  const refLine = opts.showRef ? ` &nbsp;·&nbsp; Acc: ${esc(door.customer_acc_ref)}` : "";
  return `<div class="door-row">
    <div class="door-row-top">
      <b>${esc(door.door_type_description || "Doorset")}</b>
      <span class="door-row-meta">Scheduled: ${fmtDate(door.date_completion)}${refLine} &nbsp;·&nbsp; ${doorBadge(door)}</span>
    </div>
    ${renderTracker(door)}
  </div>`;
}

function renderOrder(o, opts = {}) {
  const badges = [];
  if (o.onHold) badges.push(`<span class="badge badge-hold">${o.onHold} On Hold</span>`);
  badges.push(`<span class="badge ${o.allPacked ? "badge-packed" : "badge-active"}">${esc(o.summary)}</span>`);
  const sub = [o.order_ref ? `Ref: ${esc(o.order_ref)}` : "", opts.showRef ? `Acc: ${esc(o.doors[0].customer_acc_ref)}` : ""]
    .filter(Boolean).join(" · ");
  return `<div class="order-card">
    <div class="order-head">
      <div><h3>Order ${esc(o.order_number || o.order_id)}</h3><span class="order-sub">${sub}</span></div>
      <div class="order-summary">${badges.join("")}</div>
    </div>
    ${o.doors.map((d) => renderDoorRow(d, opts)).join("")}
  </div>`;
}

// ---- login / logout --------------------------------------------------------
router.get("/login", (req, res) => {
  if (auth.currentUser(req)) return res.redirect("/portal");
  const bad = req.query.bad ? '<p style="color:#b00;margin-bottom:14px">Incorrect email or password.</p>' : "";
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
        ${bad}${disabled}
        <form method="post" action="/portal/login" class="form">
          <input type="hidden" name="next" value="${next}">
          <div><label for="email">Email</label><input type="email" id="email" name="email" required autofocus autocomplete="username"></div>
          <div><label for="password">Password</label><input type="password" id="password" name="password" required autocomplete="current-password"></div>
          <div><button class="btn btn-primary" type="submit">Sign in</button></div>
        </form>
        <p style="color:var(--slate);font-size:14px;margin-top:22px">No account? Contact us on <a href="tel:01685350114">01685 350 114</a> or <a href="mailto:sales@designandsupply.co.uk">sales@designandsupply.co.uk</a>.</p>
      </div>`
    )
  );
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

// ---- admin (staff only) ----------------------------------------------------
const admin = express.Router();
admin.use(auth.requireStaff);

admin.get("/", (req, res) => {
  const s = store.stats();
  const last = store.lastSync();
  const syncLine = last
    ? `${last.status === "ok" ? "✓" : "⚠"} ${esc(last.ran_at)} — received ${last.rows_received ?? "?"}, upserted ${last.rows_upserted ?? "?"}, removed ${last.rows_removed ?? "?"}${last.message ? " — " + esc(last.message) : ""}`
    : "No sync has run yet.";
  res.send(
    page(
      "Admin",
      `<span class="kicker">Order Hub Admin</span><h1>Staff <em style="font-style:normal;color:var(--accent)">Dashboard</em></h1>
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
      <div class="card" style="margin-top:22px"><h3>Sync Health</h3><p style="color:var(--slate)">${syncLine}</p><a class="card-link" href="/portal/admin/sync">View sync log</a></div>`,
      { user: req.portalUser }
    )
  );
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
        ? overrides.map((o) => `<span class="pill pill-live">${esc(o.customer_acc_ref)} <a href="/portal/admin/overrides/${o.id}/delete" onclick="return confirm('Remove override?')" style="color:#b00">×</a></span>`).join(" ")
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
          <div><label>Initial password</label><input type="text" name="password" required minlength="8" placeholder="min 8 characters"></div>
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
    await auth.createUser({ email: req.body.email, password: req.body.password, role: req.body.role, display_name: req.body.display_name });
    res.redirect("/portal/admin/accounts?msg=" + encodeURIComponent("Account created."));
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
