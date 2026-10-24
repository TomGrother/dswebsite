/**
 * Specification pack: a visitor on /downloads asks for every document by
 * email. We record the request, email them one message of links (always the
 * current files — no attachments), and tell the sales inbox about the lead.
 *
 * Marketing consent comes ONLY from the optional, unticked-by-default box; the
 * pack itself is sent either way (receiving it is never conditional on
 * agreeing to marketing). The document list and the consent wording come from
 * content/spec-pack.json, which docs-src/build_docs.py writes alongside the
 * downloads page, so the email always matches what the page offers.
 */
const fs = require("fs");
const path = require("path");
const store = require("./db");
const notify = require("./orderhub/notify");

const MANIFEST = path.join(__dirname, "content", "spec-pack.json");
const SALES_TO = () => process.env.ENQUIRY_TO || "sales@designandsupply.co.uk";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function manifest() {
  return JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Validate and normalise a request body. Returns { ok, request } or { ok:false, error }. */
function parseRequest(body) {
  const b = body || {};
  const name = String(b.name || "").trim().slice(0, 120);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 200);
  const company = String(b.company || "").trim().slice(0, 160);
  if (!name) return { ok: false, error: "Please enter your name." };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "Please enter a valid email address." };
  const ref = String(b.df_ref || "").trim();
  // a ticked checkbox posts the literal "yes"; anything else is no consent
  const consent = b.marketing === "yes" || b.marketing === true;
  return {
    ok: true,
    request: {
      name,
      email,
      company,
      marketing_consent: consent,
      consent_text: consent ? manifest().consentText : null,
      df_ref: /^DFREF-[A-Za-z0-9_-]{1,64}$/.test(ref) ? ref : "",
    },
  };
}

function renderPackEmail(r, m = manifest()) {
  const first = r.name.split(/\s+/)[0];
  const sections = m.sections
    .map(
      (s) => `<p style="margin:22px 0 8px;font-size:12px;letter-spacing:1.2px;text-transform:uppercase;color:#0E6551;font-weight:700">${esc(s.title)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">
        ${s.docs
          .map(
            (d) => `<tr><td style="padding:7px 0;border-top:1px solid #eef1f0;font-size:14px;line-height:1.4">
            <a href="${esc(d.url)}" style="color:#0E6551;font-weight:600;text-decoration:none">${esc(d.title)}</a>
            <span style="display:block;font-size:12px;color:#8a9994">${esc(d.meta)}</span></td></tr>`
          )
          .join("")}
      </table>`
    )
    .join("");
  const body = `<p style="margin:0 0 6px;font-size:20px;color:#1a2b26;font-weight:600">Your specification pack</p>
      <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#5a6b66">Hi ${esc(first)}, thanks for your interest in Design &amp; Supply. Here are our current documents — data sheets, certificates, installation and warranty information, and our company brochure. The links always open the latest version, so this email stays useful.</p>
      ${sections}
      <p style="margin:26px 0 14px;font-size:14px;line-height:1.6;color:#1a2b26">Need drawings, a specification for your tender or help choosing a doorset? Just reply to this email, or call <a href="tel:01685350114" style="color:#0E6551">01685 350 114</a>.</p>
      ${notify.emailButton("https://designandsupply.co.uk/downloads", "View all downloads")}
      <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#8a9994;border-top:1px solid #eef1f0;padding-top:14px">You received this because you requested our specification pack at designandsupply.co.uk.${
        r.marketing_consent ? " You also asked to hear about product news and updates — reply “unsubscribe” at any time to stop." : ""
      }</p>`;
  return {
    subject: "Your Design & Supply specification pack",
    html: notify.emailShell(body, { title: "Design &amp; Supply &middot; Specification pack", preheader: "Data sheets, certificates, installation and warranty information — all current versions." }),
  };
}

function renderSalesEmail(r) {
  const row = (label, value) =>
    value ? `<tr><td style="padding:6px 14px 6px 0;font-size:13px;color:#5a6b66;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 0;font-size:14px;color:#1a2b26">${value}</td></tr>` : "";
  const consent = r.marketing_consent
    ? `<span style="color:#0E6551;font-weight:700">Yes</span> — opted in to product news`
    : `<span style="color:#a35400;font-weight:700">No</span> — do not add to marketing campaigns`;
  const body = `<p style="margin:0 0 6px;font-size:20px;color:#1a2b26;font-weight:600">Specification pack requested</p>
      <p style="margin:0 0 18px;font-size:14px;color:#5a6b66">Someone asked for the specification pack on the downloads page. It has been emailed to them; reply to this email to reach them directly.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 6px;border-collapse:separate"><tr><td bgcolor="#f4f7f6" style="background:#f4f7f6;border:1px solid #e6ebe9;border-radius:10px;padding:16px 18px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%">
          ${row("Name", esc(r.name))}
          ${row("Email", `<a href="mailto:${esc(r.email)}" style="color:#0E6551;font-weight:600">${esc(r.email)}</a>`)}
          ${row("Company", esc(r.company))}
          ${row("Marketing", consent)}
          ${row("Ref", esc(r.df_ref))}
        </table>
      </td></tr></table>`;
  return {
    subject: `Spec pack request — ${r.name}${r.company ? " (" + r.company + ")" : ""}`,
    html: notify.emailShell(body, { title: "Design &amp; Supply &middot; Website", preheader: `${r.name}${r.company ? ", " + r.company : ""} requested the specification pack` }),
  };
}

/** Express handler for POST /api/spec-pack. `send` and `post` are injectable for tests. */
function handler({ send, post } = {}) {
  return async (req, res) => {
    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // honeypot: bots fill it, people never see it
    const parsed = parseRequest(b);
    if (!parsed.ok) return res.status(400).json(parsed);
    const r = parsed.request;

    let id = null;
    try {
      id = store.saveSpecPackRequest(r);
    } catch (err) {
      console.error("[spec-pack] could not be stored:", err.message);
    }

    const sender = send || (notify.isEnabled() ? notify.sendViaResend : null);
    if (!sender) {
      console.error("[spec-pack] RESEND_API_KEY is not set — pack not emailed.", JSON.stringify(r));
      return res.json({ ok: true });
    }
    try {
      const pack = renderPackEmail(r);
      await sender(r.email, pack.subject, pack.html, { replyTo: SALES_TO() });
      if (id) store.markSpecPackEmailed(id);
    } catch (err) {
      if (id) store.markSpecPackFailed(id, err.message);
      console.error("[spec-pack] EMAIL FAILED —", err.message);
      return res.status(502).json({ ok: false, error: "Sorry — we couldn't send the pack just now. Every document is on this page to download, or email sales@designandsupply.co.uk and we'll send it over." });
    }
    try {
      const lead = renderSalesEmail(r);
      await sender(SALES_TO(), lead.subject, lead.html, { replyTo: r.email });
    } catch (err) {
      console.error("[spec-pack] sales notification failed —", err.message); // the requester still got their pack
    }
    res.json({ ok: true });
    // After responding, so DesignForce can never slow or fail the visitor's request.
    if (id && r.marketing_consent && (post || designforceEnabled())) {
      const row = store.specPackRequests().find((x) => x.id === Number(id));
      await syncRow(row, post || postToDesignForce);
    }
  };
}

// ---- DesignForce -------------------------------------------------------------
// Opted-in contacts are sent to DesignForce's marketing-contact endpoint (spec:
// docs/designforce-marketing-contacts.md). Off until both settings exist.
// Only ever called for rows with marketing_consent = 1.

const designforceEnabled = () => !!(process.env.DESIGNFORCE_MARKETING_URL && process.env.DESIGNFORCE_MARKETING_KEY);

/** The JSON body DesignForce receives for one stored request row. */
function designforcePayload(row) {
  return {
    external_id: `spec-pack-${row.id}`,
    email: row.email,
    name: row.name,
    company: row.company || null,
    source: "website-spec-pack",
    consent: {
      given: true,
      text: row.consent_text,
      given_at: new Date(String(row.created_at).replace(" ", "T") + "Z").toISOString(),
      method: "Website form opt-in, unticked by default",
      page: "https://designandsupply.co.uk/downloads",
    },
    df_ref: row.df_ref || null,
  };
}

async function postToDesignForce(payload) {
  const res = await fetch(process.env.DESIGNFORCE_MARKETING_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.DESIGNFORCE_MARKETING_KEY },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`DesignForce ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

/** Push one stored row; records success or the error. `post` is injectable for tests. */
async function syncRow(row, post = postToDesignForce) {
  if (!row || !row.marketing_consent) return false;
  try {
    await post(designforcePayload(row));
    store.markSpecPackSynced(row.id);
    return true;
  } catch (err) {
    store.markSpecPackSyncFailed(row.id, err.message);
    console.error("[spec-pack] DesignForce sync failed —", err.message);
    return false;
  }
}

/** Push every opted-in request not yet in DesignForce (retries and the one-off backfill). */
async function syncPending(post = postToDesignForce) {
  let sent = 0, failed = 0;
  for (const row of store.specPackPendingDesignForce()) (await syncRow(row, post)) ? sent++ : failed++;
  return { sent, failed };
}

/** Retry anything that failed to reach DesignForce: a minute after boot, then every 6 hours. */
function startDesignForceRetry() {
  const tick = () => { if (designforceEnabled()) syncPending().catch((e) => console.error("[spec-pack] retry:", e.message)); };
  setTimeout(tick, 60 * 1000).unref();
  setInterval(tick, 6 * 60 * 60 * 1000).unref();
}

/** CSV of all requests, for importing opted-in contacts into DesignForce. */
function toCsv(rows) {
  // public input ends up in Excel: neutralise cells that would run as formulas
  const q = (v) => {
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ["requested_at", "name", "email", "company", "marketing_consent", "consent_text", "df_ref", "emailed_at", "error", "designforce_synced_at"];
  return [head.join(",")]
    .concat(rows.map((r) => [r.created_at, r.name, r.email, r.company, r.marketing_consent ? "yes" : "no", r.consent_text, r.df_ref, r.emailed_at, r.error, r.designforce_synced_at].map(q).join(",")))
    .join("\r\n");
}

module.exports = { handler, parseRequest, renderPackEmail, renderSalesEmail, toCsv, manifest, designforceEnabled, designforcePayload, syncRow, syncPending, startDesignForceRetry };
