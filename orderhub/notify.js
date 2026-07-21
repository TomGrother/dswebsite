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
// A teaser shown in customer emails while the live portal is being rolled out.
function comingSoonBanner() {
  return `<div style="background:#e8f7fb;border:1px solid #b8e2ec;border-radius:10px;padding:14px 16px;margin:0 0 20px">
    <div style="font-family:'Barlow Condensed',Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;font-size:15px;color:#0a4a5c;font-weight:700;margin-bottom:3px">Customer Hub &mdash; coming soon</div>
    <div style="font-size:13px;color:#31606c;line-height:1.5">Soon you'll be able to log in to the Design &amp; Supply Customer Hub and watch your orders progress through production live. We'll send your login details shortly.</div>
  </div>`;
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
  const html = `<div style="background:#f4f7f6;padding:24px 0;font-family:Inter,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e6ebe9">
    <div style="background:#0E6551;padding:20px 26px">
      <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:20px;letter-spacing:1px;text-transform:uppercase;color:#fff;font-weight:700">Design &amp; Supply · Order Hub</div>
    </div>
    <div style="padding:26px">
      <p style="margin:0 0 4px;font-size:16px;color:#1a2b26">Hello ${name},</p>
      <p style="margin:0 0 20px;font-size:14px;color:#5a6b66">Here's what changed on your orders as of ${esc(dateLabel)}.</p>
      ${comingSoonBanner()}
      ${orderBlocks}
      <p style="margin:24px 0 0;font-size:12px;color:#8a9994;border-top:1px solid #eef1f0;padding-top:16px">
        Questions? Call <a href="tel:01685350114" style="color:#0E6551">01685 350 114</a> or email
        <a href="mailto:sales@designandsupply.co.uk" style="color:#0E6551">sales@designandsupply.co.uk</a>.
      </p>
    </div>
  </div>
</div>`;
  return { subject, html };
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
    ? `<div style="background:#fdf3e2;border:1px solid #ebc98a;border-radius:8px;padding:10px 12px;margin:8px 0;font-size:13px;color:#8a5a12">On hold — ${o.onHold} door${o.onHold > 1 ? "s are" : " is"} paused and not currently progressing through production. Please contact us if you need an update.</div>`
    : "";
  return `<div class="ocard" style="border:1px solid #e6ebe9;border-radius:10px;padding:16px 18px;margin:0 0 18px">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%"><tr>
      <td style="font-family:'Barlow Condensed',Arial,sans-serif;text-transform:uppercase;letter-spacing:1px;font-size:17px;color:#0E6551;font-weight:700">Order ${esc(o.order_number || o.order_id)}</td>
      <td style="text-align:right">${pill(o.summary, o.allPacked ? "#0E6551" : "#0a4a5c", o.allPacked ? "#e7f3ef" : "#eef4f6")}</td>
    </tr></table>
    ${o.order_ref ? `<div style="font-size:12px;color:#5a6b66;margin-top:2px">Ref: ${esc(o.order_ref)}</div>` : ""}
    ${holdNote}
    ${o.doors.map(doorEmail).join("")}
  </div>`;
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
  const html = `${responsive}<div style="background:#f4f7f6;padding:24px 0;font-family:Inter,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e6ebe9">
    <div style="background:#0E6551;padding:20px 26px"><div style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:20px;letter-spacing:1px;text-transform:uppercase;color:#fff;font-weight:700">Design &amp; Supply · Order Hub</div></div>
    <div class="ecard" style="padding:24px 26px">
      <p style="margin:0 0 4px;font-size:16px;color:#1a2b26">Hello ${name},</p>
      <p style="margin:0 0 20px;font-size:14px;color:#5a6b66">Here's where your orders stand in production as of ${esc(dateLabel)}.</p>
      ${comingSoonBanner()}
      ${orders.map(orderEmail).join("")}
      <p style="margin:22px 0 0;font-size:12px;color:#8a9994;border-top:1px solid #eef1f0;padding-top:14px">Questions? Call <a href="tel:01685350114" style="color:#0E6551">01685 350 114</a> or email <a href="mailto:sales@designandsupply.co.uk" style="color:#0E6551">sales@designandsupply.co.uk</a>.</p>
    </div>
  </div>
</div>`;
  return { subject, html };
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
  const html = `<div style="background:#f4f7f6;padding:24px 0;font-family:Inter,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e6ebe9">
    <div style="background:#0E6551;padding:20px 26px"><div style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:20px;letter-spacing:1px;text-transform:uppercase;color:#fff;font-weight:700">Design &amp; Supply · Order Hub</div></div>
    <div style="padding:26px">
      <p style="margin:0 0 14px;font-size:16px;color:#1a2b26">Password reset requested</p>
      <p style="margin:0 0 20px;font-size:14px;color:#5a6b66">We received a request to reset the password for your Order Hub account. Click below to choose a new one. This link expires in 60 minutes and can be used once.</p>
      <a href="${esc(resetUrl)}" style="display:inline-block;background:#0E6551;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px">Reset your password</a>
      <p style="margin:22px 0 0;font-size:13px;color:#8a9994">If you didn't request this, you can safely ignore this email — your password won't change.</p>
      <p style="margin:14px 0 0;font-size:12px;color:#8a9994;border-top:1px solid #eef1f0;padding-top:14px">Trouble with the button? Paste this link into your browser:<br><span style="color:#0a4a5c;word-break:break-all">${esc(resetUrl)}</span></p>
    </div>
  </div>
</div>`;
  return { subject, html };
}

async function sendPasswordReset(to, resetUrl, { send = sendViaResend } = {}) {
  const { subject, html } = renderResetEmail(resetUrl);
  return send(to, subject, html);
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

// ---- digest run ------------------------------------------------------------
/**
 * Gather un-notified events, email each affected customer a summary, mark the
 * events sent, and record the run. `send` is injectable for tests. `force`
 * bypasses the once-a-day guard (used by the admin "send now" button).
 * Returns { emails, events, date } or { skipped }.
 */
async function runDigest({ send = sendViaResend, force = false } = {}) {
  const date = londonDate();
  if (!force && store.wasDigestSentOn(date)) return { skipped: "already-sent-today", date };

  const maxId = store.maxUnnotifiedEventId();
  if (!maxId) {
    store.recordDigestRun({ date, recipients: 0, events: 0 });
    return { emails: 0, events: 0, date };
  }
  const events = store.unnotifiedEventsUpTo(maxId);
  const byRef = new Map();
  for (const e of events) {
    if (!byRef.has(e.customer_acc_ref)) byRef.set(e.customer_acc_ref, []);
    byRef.get(e.customer_acc_ref).push(e);
  }

  const users = auth.listUsers().filter((u) => u.is_active && u.role === "customer");
  let emails = 0;
  for (const u of users) {
    const refs = store.allowedRefsForUser(u); // null for staff (excluded above); [] if unmapped
    if (!refs || refs.length === 0) continue;
    const mine = [];
    for (const r of refs) if (byRef.has(r)) mine.push(...byRef.get(r));
    if (!mine.length) continue;
    const { subject, html } = renderDigestEmail(u, mine);
    try {
      await send(u.email, subject, html);
      emails++;
    } catch (err) {
      console.error("[digest] send failed for", u.email, "-", err.message);
    }
  }

  // Mark the whole snapshot window sent (even refs with no user yet) so events
  // never accumulate unbounded; then trim old rows.
  store.markEventsNotifiedUpTo(maxId);
  store.pruneOldEvents(30);
  store.recordDigestRun({ date, recipients: emails, events: events.length });
  return { emails, events: events.length, date };
}

// ---- scheduler -------------------------------------------------------------
// In-process, restart-safe: check periodically and send once per UK day after
// DIGEST_HOUR. If the app was down at the target hour it sends on next boot.
function startDigestScheduler() {
  if (!isEnabled()) {
    console.log("[digest] RESEND_API_KEY not set — daily summaries disabled.");
    return;
  }
  const startHour = parseInt(process.env.DIGEST_HOUR || "7", 10);
  const CHECK_MS = 30 * 60 * 1000;
  const tick = async () => {
    try {
      if (londonHour() >= startHour && !store.wasDigestSentOn(londonDate())) {
        const r = await runDigest({});
        console.log("[digest] ", JSON.stringify(r));
      }
    } catch (err) {
      console.error("[digest] scheduler error:", err.message);
    }
  };
  setInterval(tick, CHECK_MS);
  setTimeout(tick, 15000); // first check shortly after boot
  console.log(`[digest] daily summaries enabled (from ${londonHour() >= startHour ? "today" : startHour + ":00"} UK).`);
}

module.exports = { runDigest, runOrdersBroadcast, startDigestScheduler, renderDigestEmail, renderOrdersEmail, renderResetEmail, sendPasswordReset, isEnabled, EVENT_LABELS };
