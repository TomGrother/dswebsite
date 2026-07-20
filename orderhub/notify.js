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
  const portalUrl = process.env.PORTAL_URL || PORTAL_URL_DEFAULT;
  const html = `<div style="background:#f4f7f6;padding:24px 0;font-family:Inter,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e6ebe9">
    <div style="background:#0E6551;padding:20px 26px">
      <div style="font-family:'Barlow Condensed',Arial,sans-serif;font-size:20px;letter-spacing:1px;text-transform:uppercase;color:#fff;font-weight:700">Design &amp; Supply · Order Hub</div>
    </div>
    <div style="padding:26px">
      <p style="margin:0 0 4px;font-size:16px;color:#1a2b26">Hello ${name},</p>
      <p style="margin:0 0 22px;font-size:14px;color:#5a6b66">Here's what changed on your orders as of ${esc(dateLabel)}.</p>
      ${orderBlocks}
      <a href="${esc(portalUrl)}" style="display:inline-block;background:#0E6551;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;margin-top:4px">View your orders</a>
      <p style="margin:24px 0 0;font-size:12px;color:#8a9994;border-top:1px solid #eef1f0;padding-top:16px">
        You're receiving this because you have an account on the Design &amp; Supply Order Hub.
        Questions? Call <a href="tel:01685350114" style="color:#0E6551">01685 350 114</a> or email
        <a href="mailto:sales@designandsupply.co.uk" style="color:#0E6551">sales@designandsupply.co.uk</a>.
      </p>
    </div>
  </div>
</div>`;
  return { subject, html };
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

module.exports = { runDigest, startDigestScheduler, renderDigestEmail, isEnabled, EVENT_LABELS };
