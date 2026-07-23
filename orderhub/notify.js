/**
 * Daily customer digest.
 *
 * Status changes are captured as door_event rows on every sync (see db.js).
 * Once a day this module gathers each customer's un-notified events and emails
 * them a single branded summary via Resend — no per-change spam, no customer
 * ever waiting on the portal.
 *
 * Config (environment):
 *   RESEND_API_KEY   required to send; if unset the feature is disabled
 *   NOTIFY_FROM      sender (default: Design & Supply <notifications@designandsupply.co.uk>)
 *   DIGEST_HOUR      earliest UK hour to send, 0-23 (default 7)
 *   PORTAL_URL       link in the email (default https://designandsupply.co.uk/portal)
 */
const store = require("./db");
const auth = require("./auth");

const FROM_DEFAULT = "Design & Supply <notifications@designandsupply.co.uk>";
const PORTAL_URL_DEFAULT = "https://designandsupply.co.uk/portal";

// Human-readable label + tone for each captured event type.
const EVENT_LABELS = {
  packed: "Packed &amp; ready for dispatch",
  on_hold: "Placed on hold",
  resumed: "Back in production",
  added: "Added to your order",
};

const isEnabled = () => !!process.env.RESEND_API_KEY;

// ---- UK-local time helpers (digest runs on a UK schedule) ------------------
function londonDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d); // YYYY-MM-DD
}
function londonHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(d)) % 24;
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---- email rendering -------------------------------------------------------
// Outlook-safe email shell. Desktop Outlook (Windows) renders with the Word
// engine, which ignores max-width and mishandles padding on <div>. So the whole
// layout is a centred, fixed-width table with an MSO "ghost table" to force the
// 600px width, background on <td>/bgcolor, and all padding on table cells.
function emailShell(bodyHtml, { title = "Design &amp; Supply &middot; Order Hub", preheader = "" } = {}) {
  return `<div style="margin:0;padding:0;background:#f4f7f6">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(preheader)}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f7f6" style="background:#f4f7f6;border-collapse:collapse">
    <tr><td align="center" style="padding:24px 12px">
      <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border:1px solid #e6ebe9;border-radius:12px;border-collapse:separate;font-family:Inter,Arial,Helvetica,sans-serif">
        <tr><td bgcolor="#0E6551" style="background:#0E6551;padding:20px 28px;border-radius:12px 12px 0 0;font-family:'Barlow Condensed',Arial,sans-serif;font-size:21px;letter-spacing:1px;text-transform:uppercase;color:#ffffff;font-weight:700">${title}</td></tr>
        <tr><td style="padding:28px;font-family:Inter,Arial,Helvetica,sans-serif">${bodyHtml}</td></tr>
        <tr><td bgcolor="#f4f7f6" style="background:#f4f7f6;border-top:1px solid #e6ebe9;padding:16px 28px;border-radius:0 0 12px 12px;font-size:12px;line-height:1.6;color:#8a9994">Design &amp; Supply Ltd &middot; 13 Pant Industrial Estate, Merthyr Tydfil, CF48 2SR<br>01685 350 114 &middot; sales@designandsupply.co.uk &middot; designandsupply.co.uk</td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td></tr>
  </table>
</div>`;
}

// A "bulletproof" call-to-action button. Desktop Outlook ignores padding on the
// <a>, so it needs a VML roundrect (rounded, correctly sized); every other
// client uses the fixed-width CSS anchor. Width is sized to the label.
function emailButton(href, label, { bg = "#0E6551" } = {}) {
  const h = esc(href);
  const w = Math.round(label.length * 8.6 + 52);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 6px"><tr><td>
      <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${h}" style="height:46px;v-text-anchor:middle;width:${w}px;" arcsize="16%" stroke="f" fillcolor="${bg}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;">${label}</center></v:roundrect><![endif]-->
      <a href="${h}" style="mso-hide:all;background-color:${bg};border-radius:8px;color:#ffffff;display:inline-block;font-family:Inter,Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;line-height:46px;text-align:center;text-decoration:none;width:${w}px;-webkit-text-size-adjust:none">${label}</a>
    </td></tr></table>`;
}

function renderDigestEmail(user, events) {
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric",
  }).format(new Date());
  const packed = events.filter((e) => e.event_type === "packed").length;
  const subject = packed
    ? `Your Design & Supply order update — ${packed} door${packed === 1 ? "" : "s"} ready`
    : "Your Design & Supply order update";

  // Group by order number for a tidy summary.
  const byOrder = new Map();
  for (const e of events) {
    const key = e.order_number || "—";
    if (!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key).push(e);
  }
  const orderBlocks = [...byOrder.entries()].map(([order, evs]) => {
    const rows = evs.map((e) => {
      const ref = e.door_ref ? `<b>${esc(e.door_ref)}</b> ` : "";
      const type = e.door_type_description ? esc(e.door_type_description) : "Doorset";
      const label = EVENT_LABELS[e.event_type] || esc(e.event_type);
      const tone = e.event_type === "on_hold" ? "#b7791f" : "#0E6551";
      return `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eef1f0;font-size:14px;color:#1a2b26">${ref}${type}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eef1f0;font-size:13px;font-weight:600;color:${tone};text-align:right;white-space:nowrap">${label}</td>
      </tr>`;
    }).join("");
    return `<div style="margin:0 0 22px">
      <div style="font-family:'Barlow Condensed',Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;font-size:15px;color:#0E6551;font-weight:700;margin-bottom:6px">Order ${esc(order)}</div>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
    </div>`;
  }).join("");

  const name = user.display_name ? esc(user.display_name.split(" ")[0]) : "there";
  const body = `<p style="margin:0 0 4px;font-size:16px;color:#1a2b26">Hello ${name},</p>
      <p style="margin:0 0 20px;font-size:14px;color:#5a6b66">Here's what changed on your orders as of ${esc(dateLabel)}.</p>
      ${orderBlocks}`;
  return { subject, html: emailShell(body, { preheader: subject }) };
}

// ---- "current orders" broadcast (portal snapshot as an email) --------------
// An on-demand email showing each customer their live orders and the production
// stage of every door — the portal view, rendered as email-safe inline HTML.
// Short labels keep the 7-stage tracker from congesting on narrow mobile screens.
const STAGE_LABELS = { program: "Program", punch: "Punch", bend: "Bend", weld: "Weld", buff: "Buff", paint: "Paint", pack: "Pack" };

function fmtDateEmail(iso) {
  if (!iso) return "—";
  const dt = new Date(String(iso).length === 10 ? iso + "T00:00:00Z" : iso);
  if (isNaN(dt)) return esc(iso);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(dt);
}
function pill(text, color, bg) {
  return `<span style="display:inline-block;font-size:11px;font-weight:700;color:${color};background:${bg};border-radius:5px;padding:2px 8px">${esc(text)}</span>`;
}
function doorBadgeEmail(door) {
  if (door.onHold) return pill("On Hold", "#8a5a12", "#fdf3e2");
  if (door.packed) return pill("Packed", "#0E6551", "#e7f3ef");
  return pill(door.statusLabel || "Active", "#0E6551", "#e7f3ef");
}
// A row of stage dots + labels, mirroring the portal tracker (done = green tick,
// current = outlined, upcoming = grey; amber when the door is on hold).
function trackerEmail(door) {
  const firstIdx = door.stages.findIndex((s) => !s.done);
  const hold = door.onHold;
  const w = (100 / door.stages.length).toFixed(2);
  const cells = door.stages.map((s, i) => {
    let bg = "#ffffff", fg = "#9aa8a3", border = "#d9e2df", inner = String(i + 1);
    if (s.done) { bg = hold ? "#b7791f" : "#0E6551"; fg = "#ffffff"; border = bg; inner = "&#10003;"; }
    else if (i === firstIdx) { fg = hold ? "#b7791f" : "#0E6551"; border = fg; }
    // Fixed-width columns (table-layout:fixed) so cells never overflow into each
    // other on mobile; short labels + tight sizing keep it readable.
    return `<td class="stg" width="${w}%" style="width:${w}%;text-align:center;vertical-align:top;padding:0 1px">
      <div class="stgdot" style="width:22px;height:22px;line-height:22px;border-radius:50%;background:${bg};color:${fg};border:2px solid ${border};font-size:11px;font-weight:700;margin:0 auto">${inner}</div>
      <div class="stglbl" style="font-size:8px;letter-spacing:0;text-transform:uppercase;color:#5a6b66;margin-top:4px;line-height:1.1">${esc(STAGE_LABELS[s.key] || s.key)}</div>
    </td>`;
  }).join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;margin:10px 0 4px"><tr>${cells}</tr></table>`;
}
function doorEmail(door) {
  const ref = door.door_ref ? `${pill(door.door_ref, "#0a4a5c", "#dff2f7")} ` : "";
  const type = esc(door.door_type_description || "Doorset");
  const scheduled = door.onHold ? "" : `<span style="color:#5a6b66">Scheduled: ${fmtDateEmail(door.date_completion)}</span> &nbsp;`;
  return `<div style="padding:12px 0;border-top:1px solid #eef1f0">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%"><tr>
      <td style="font-size:14px;color:#1a2b26"><b>Door #${esc(door.id)}</b> ${ref}${type}</td>
      <td style="text-align:right;font-size:12px;white-space:nowrap">${scheduled}${doorBadgeEmail(door)}</td>
    </tr></table>
    ${trackerEmail(door)}
  </div>`;
}
function orderEmail(o) {
  const holdNote = o.onHold
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0;border-collapse:separate"><tr><td bgcolor="#fdf3e2" style="background:#fdf3e2;border:1px solid #ebc98a;border-radius:8px;padding:10px 12px;font-size:13px;color:#8a5a12">On hold — ${o.onHold} door${o.onHold > 1 ? "s are" : " is"} paused and not currently progressing through production. Please contact us if you need an update.</td></tr></table>`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-collapse:separate"><tr><td class="ocard" style="border:1px solid #e6ebe9;border-radius:10px;padding:16px 18px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr>
      <td style="font-family:'Barlow Condensed',Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;font-size:17px;color:#0E6551;font-weight:700">Order ${esc(o.order_number || o.order_id)}</td>
      <td style="text-align:right">${pill(o.summary, o.allPacked ? "#0E6551" : "#0a4a5c", o.allPacked ? "#e7f3ef" : "#eef4f6")}</td>
    </tr></table>
    ${o.order_ref ? `<div style="font-size:12px;color:#5a6b66;margin-top:2px">Ref: ${esc(o.order_ref)}</div>` : ""}
    ${holdNote}
    ${o.doors.map(doorEmail).join("")}
  </td></tr></table>`;
}
function renderOrdersEmail(user, orders) {
  const dateLabel = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const name = user.display_name ? esc(user.display_name.split(" ")[0]) : "there";
  const subject = "Your Design & Supply orders — production status";
  // Progressive enhancement: clients that honour <style>/media queries (Apple
  // Mail, iOS Mail) shrink the tracker further on small screens.
  const responsive = `<style>@media only screen and (max-width:480px){
    .ecard{padding:16px 14px !important}
    .stgdot{width:20px !important;height:20px !important;line-height:20px !important;font-size:10px !important}
    .stglbl{font-size:7px !important}
    .ocard{padding:13px 12px !important}
  }</style>`;
  const body = `<p style="margin:0 0 4px;font-size:16px;color:#1a2b26">Hello ${name},</p>
      <p style="margin:0 0 20px;font-size:14px;color:#5a6b66">Here's where your orders stand in production as of ${esc(dateLabel)}.</p>
      ${orders.map(orderEmail).join("")}`;
  return { subject, html: responsive + emailShell(body, { preheader: subject }) };
}

/**
 * Email every active customer a snapshot of their current orders and production
 * stages (skips customers with no live orders). Unlike the digest, this is a
 * full picture, not just changes — sent on demand from the admin dashboard.
 */
async function runOrdersBroadcast({ send = sendViaResend } = {}) {
  const users = auth.listUsers().filter((u) => u.is_active && u.role === "customer");
  let emails = 0, skipped = 0;
  for (const u of users) {
    const orders = store.ordersForUser(u, {});
    if (!orders.length) { skipped++; continue; }
    const { subject, html } = renderOrdersEmail(u, orders);
    try {
      await send(u.email, subject, html);
      emails++;
    } catch (err) {
      console.error("[orders-email] send failed for", u.email, "-", err.message);
    }
  }
  return { emails, skipped };
}

// ---- password reset email --------------------------------------------------
function renderResetEmail(resetUrl) {
  const subject = "Reset your Design & Supply Order Hub password";
  const body = `<p style="margin:0 0 14px;font-size:16px;color:#1a2b26">Password reset requested</p>
      <p style="margin:0 0 20px;font-size:14px;color:#5a6b66">We received a request to reset the password for your Order Hub account. Click below to choose a new one. This link expires in 60 minutes and can be used once.</p>
      ${emailButton(resetUrl, "Reset your password")}
      <p style="margin:22px 0 0;font-size:13px;color:#8a9994">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      <p style="margin:14px 0 0;font-size:12px;color:#8a9994;border-top:1px solid #eef1f0;padding-top:14px">Trouble with the button? Paste this link into your browser:<br><span style="color:#0a4a5c;word-break:break-all">${esc(resetUrl)}</span></p>`;
  return { subject, html: emailShell(body, { preheader: subject }) };
}

async function sendPasswordReset(to, resetUrl, { send = sendViaResend } = {}) {
  const { subject, html } = renderResetEmail(resetUrl);
  return send(to, subject, html);
}

// ---- welcome / onboarding email --------------------------------------------
const PORTAL_URL = (process.env.PUBLIC_BASE_URL || "https://designandsupply.co.uk") + "/portal";

function renderWelcomeEmail(user, tempPassword) {
  const name = user.display_name ? esc(user.display_name) : "there";
  const subject = "Your Design & Supply Customer Portal login";
  const body = `<p style="margin:0 0 6px;font-size:20px;color:#1a2b26;font-weight:600">Track your orders, live</p>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.6;color:#5a6b66">Hi ${name}, we've set up a Customer Portal account for you. You can follow every doorset through our factory in real time — from programming through to packing.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-collapse:separate"><tr><td bgcolor="#f4f7f6" style="background:#f4f7f6;border:1px solid #e6ebe9;border-radius:10px;padding:16px 18px">
        <p style="margin:0 0 8px;font-size:13px;color:#5a6b66;font-weight:600">Your sign-in details</p>
        <p style="margin:0;font-size:14px;color:#1a2b26;line-height:1.9">Email: <b>${esc(user.email)}</b><br>
        Temporary password: <span style="font-family:Consolas,monospace;background:#ffffff;border:1px solid #d7ddda;border-radius:5px;padding:2px 8px">${esc(tempPassword)}</span></p>
        <p style="margin:10px 0 0;font-size:13px;color:#8a9994">For your security you'll be asked to set your own password the first time you sign in — at least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol.</p>
      </td></tr></table>
      ${emailButton(PORTAL_URL, "Sign in to your portal")}
      <p style="margin:24px 0 8px;font-size:16px;color:#1a2b26;font-weight:600">What you'll see</p>
      <ul style="margin:0 0 8px;padding-left:20px;font-size:14px;line-height:1.7;color:#5a6b66">
        <li>A live production tracker for each door: Programming &rarr; Punching &rarr; Bending &rarr; Welding &rarr; Buffing &rarr; Painting &rarr; Packing.</li>
        <li>Your door reference and type, the paint colour(s) and finish, and the scheduled completion date.</li>
        <li>Optional daily emails — a summary of changes and/or a full orders snapshot — which you can switch on or off and time to suit you under <b>Email preferences</b>.</li>
      </ul>
      <p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:#8a9994;border-top:1px solid #eef1f0;padding-top:14px">Any questions? Call 01685 350 114 or email <a href="mailto:sales@designandsupply.co.uk" style="color:#0E6551">sales@designandsupply.co.uk</a>. If this account wasn't expected, please let us know.</p>`;
  return { subject, html: emailShell(body, { title: "Design &amp; Supply &middot; Customer Portal", preheader: "Your Customer Portal login and temporary password" }) };
}

async function sendWelcome(user, tempPassword, { send = sendViaResend } = {}) {
  const { subject, html } = renderWelcomeEmail(user, tempPassword);
  return send(user.email, subject, html);
}

// ---- transport -------------------------------------------------------------
async function sendViaResend(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not set.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.NOTIFY_FROM || FROM_DEFAULT, to, subject, html }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}

// ---- per-customer digest / snapshot sends ----------------------------------
/**
 * Send the daily updates digest to ONE customer: their door_events newer than
 * their watermark. Advances the watermark and stamps last-sent for `date` (UK)
 * whether or not there was anything to send, so it runs at most once a day.
 * `send` is injectable for tests. Returns { sent, events }.
 */
async function sendDigestToUser(user, date, { send = sendViaResend } = {}) {
  const refs = store.allowedRefsForUser(user); // [] if unmapped, null for staff
  const maxId = store.maxEventId();
  let sent = false, count = 0;
  if (refs && refs.length) {
    const events = store.eventsForRefsSince(refs, user.digest_watermark || 0, maxId);
    count = events.length;
    if (count) {
      const { subject, html } = renderDigestEmail(user, events);
      await send(user.email, subject, html);
      sent = true;
    }
  }
  store.markDigestSent(user.id, date, maxId);
  return { sent, events: count };
}

/**
 * Send the full orders snapshot to ONE customer. Stamps last-sent for `date`.
 * Returns { sent, orders }.
 */
async function sendSnapshotToUser(user, date, { send = sendViaResend } = {}) {
  const orders = store.ordersForUser(user, {});
  let sent = false;
  if (orders.length) {
    const { subject, html } = renderOrdersEmail(user, orders);
    await send(user.email, subject, html);
    sent = true;
  }
  store.markSnapshotSent(user.id, date);
  return { sent, orders: orders.length };
}

// ---- digest run (admin "send now") -----------------------------------------
// Force-send the updates digest to every customer who currently wants it,
// regardless of their chosen hour. Per-user watermarks prevent duplicate
// changes, so a customer already caught up today simply gets nothing new.
async function runDigest({ send = sendViaResend } = {}) {
  const date = londonDate();
  let emails = 0, events = 0;
  for (const u of store.customersWithDigest()) {
    try {
      const r = await sendDigestToUser(u, date, { send });
      if (r.sent) emails++;
      events += r.events;
    } catch (err) {
      console.error("[digest] send failed for", u.email, "-", err.message);
    }
  }
  store.pruneOldEvents(30);
  store.recordDigestRun({ date, recipients: emails, events });
  return { emails, events, date };
}

// ---- scheduler -------------------------------------------------------------
// In-process, restart-safe. Every tick, send the digest and the orders snapshot
// to any customer whose chosen UK hour has arrived and who hasn't been sent
// today. Per-user last-sent stamps make it at-most-once-a-day and survive
// restarts (a customer whose hour passed while the app was down is caught on the
// next tick after boot).
function startDigestScheduler() {
  if (!isEnabled()) {
    console.log("[digest] RESEND_API_KEY not set — customer emails disabled.");
    return;
  }
  const CHECK_MS = 20 * 60 * 1000;
  const tick = async () => {
    try {
      const date = londonDate();
      const hour = londonHour();
      for (const u of store.customersDueForDigest(date, hour)) {
        try {
          const r = await sendDigestToUser(u, date, {});
          if (r.sent) console.log(`[digest] sent to ${u.email} — ${r.events} change(s)`);
        } catch (err) {
          console.error("[digest] send failed for", u.email, "-", err.message);
        }
      }
      for (const u of store.customersDueForSnapshot(date, hour)) {
        try {
          const r = await sendSnapshotToUser(u, date, {});
          if (r.sent) console.log(`[snapshot] sent to ${u.email} — ${r.orders} order(s)`);
        } catch (err) {
          console.error("[snapshot] send failed for", u.email, "-", err.message);
        }
      }
      store.pruneOldEvents(30); // keep the events table bounded
    } catch (err) {
      console.error("[digest] scheduler error:", err.message);
    }
  };
  setInterval(tick, CHECK_MS);
  setTimeout(tick, 15000); // first check shortly after boot
  console.log("[digest] per-customer email scheduler enabled.");
}

module.exports = { runDigest, runOrdersBroadcast, sendDigestToUser, sendSnapshotToUser, startDigestScheduler, renderDigestEmail, renderOrdersEmail, renderResetEmail, sendPasswordReset, renderWelcomeEmail, sendWelcome, isEnabled, EVENT_LABELS };
