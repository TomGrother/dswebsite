/**
 * Design & Supply cookie consent dialog + consent manager.
 *
 * Categories:
 *   essential — always on (session cookies, no banner choice needed)
 *   analytics — Google Analytics 4. HARD-GATED: gtag.js is not loaded at all
 *               until the visitor grants analytics consent (window.dsLoadGA is
 *               defined in the head block injected by build.js).
 *   marketing — DesignForce email tracking (df). Wired to the spec's two
 *               functions: dfTrackConsent() on every page load while consent
 *               stands, dfTrackRevoke() on refusal/withdrawal.
 *
 * First visit shows a BLOCKING modal (page dimmed, scroll locked) until the
 * visitor accepts or rejects — both equal, one click each; access is never
 * conditioned on accepting. The choice is stored in localStorage
 * ("ds_consent") and re-applied on every page load. A [data-cookie-settings]
 * link (footer) reopens the dialog so consent can be withdrawn at any time;
 * reopened with a choice already stored, Esc closes it without changes.
 */
(function () {
  "use strict";
  var KEY = "ds_consent";

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY));
      return v && v.v === 1 && typeof v.analytics === "boolean" && typeof v.marketing === "boolean" ? v : null;
    } catch (e) { return null; }
  }
  function save(analytics, marketing) {
    try { localStorage.setItem(KEY, JSON.stringify({ v: 1, analytics: !!analytics, marketing: !!marketing, ts: Date.now() })); } catch (e) {}
  }

  // Best-effort removal of GA cookies when analytics consent is withdrawn.
  function clearGaCookies() {
    try {
      var names = (document.cookie || "").split(";").map(function (c) { return c.split("=")[0].trim(); });
      var domains = ["", "; Domain=" + location.hostname, "; Domain=." + location.hostname.replace(/^www\./, "")];
      names.forEach(function (n) {
        if (n === "_ga" || n.indexOf("_ga_") === 0) {
          domains.forEach(function (d) { document.cookie = n + "=; Max-Age=0; Path=/" + d; });
        }
      });
    } catch (e) {}
  }

  function apply(c) {
    if (c.analytics) {
      if (window.dsLoadGA) window.dsLoadGA();
    } else {
      clearGaCookies();
    }
    if (c.marketing) {
      if (window.dfTrackConsent) window.dfTrackConsent();
    } else {
      if (window.dfTrackRevoke) window.dfTrackRevoke();
    }
  }

  // ---- blocking dialog ------------------------------------------------------
  var BAR_ID = "ds-consent";
  var prevOverflow = null;

  function lockScroll() {
    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
  }
  function unlockScroll() {
    document.documentElement.style.overflow = prevOverflow || "";
    prevOverflow = null;
  }
  function removeBanner() {
    var el = document.getElementById(BAR_ID);
    if (el) el.parentNode.removeChild(el);
    unlockScroll();
    document.removeEventListener("keydown", onKeydown, true);
  }

  var allowEscClose = false;
  function onKeydown(e) {
    var wrap = document.getElementById(BAR_ID);
    if (!wrap) return;
    if (e.key === "Escape" && allowEscClose) { removeBanner(); return; }
    if (e.key === "Tab") {
      // Keep keyboard focus inside the dialog while it blocks the page.
      var focusables = wrap.querySelectorAll("button, input:not([disabled]), a[href]");
      if (!focusables.length) return;
      var first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  function showBanner(existing) {
    removeBanner();
    allowEscClose = !!existing; // first-run: a choice must be made; reopened: Esc backs out
    var wrap = document.createElement("div");
    wrap.id = BAR_ID;
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-label", "Cookie choices");
    wrap.innerHTML =
      '<style>' +
      '#ds-consent{position:fixed;inset:0;z-index:99999;background:rgba(8,16,13,.6);display:flex;align-items:center;justify-content:center;padding:18px;font-family:Inter,Arial,Helvetica,sans-serif}' +
      '#ds-consent .dsc-card{width:100%;max-width:560px;background:#0e1a17;color:#dfe9e5;border:1px solid #2a3a35;border-radius:14px;box-shadow:0 18px 50px rgba(0,0,0,.45);padding:22px 24px;max-height:calc(100vh - 36px);overflow-y:auto}' +
      '#ds-consent h2{margin:0 0 8px;font-size:17px;color:#fff;font-family:inherit}' +
      '#ds-consent p{margin:0 0 14px;font-size:13.5px;line-height:1.6;color:#c3d2cc}' +
      '#ds-consent a{color:#7fc6ae;text-decoration:underline}' +
      '#ds-consent .dsc-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}' +
      '#ds-consent button{font:inherit;font-size:13.5px;font-weight:600;border-radius:8px;padding:10px 18px;cursor:pointer;border:1px solid transparent}' +
      '#ds-consent .dsc-accept{background:#0E6551;color:#fff}' +
      '#ds-consent .dsc-accept:hover{background:#17795f}' +
      '#ds-consent .dsc-plain{background:none;color:#dfe9e5;border-color:#3a4c47}' +
      '#ds-consent .dsc-plain:hover{border-color:#7fc6ae;color:#fff}' +
      '#ds-consent .dsc-manage{display:none;border-top:1px solid #2a3a35;margin-top:14px;padding-top:12px}' +
      '#ds-consent.dsc-open .dsc-manage{display:block}' +
      '#ds-consent label{display:flex;gap:9px;align-items:flex-start;font-size:13.5px;margin:0 0 9px;color:#dfe9e5}' +
      '#ds-consent label input{margin-top:3px}' +
      '#ds-consent label b{color:#fff}' +
      '#ds-consent .dsc-cat{color:#9ab0a8;font-size:12.5px;display:block}' +
      '@media (max-width:600px){#ds-consent{padding:0;align-items:flex-end}#ds-consent .dsc-card{border-radius:14px 14px 0 0;max-width:none}#ds-consent button{flex:1;min-width:120px}}' +
      '</style>' +
      '<div class="dsc-card">' +
      '<h2>Cookies on this site</h2>' +
      '<p>Essential cookies make the site work. With your permission we also use analytics cookies to understand how the site is used, and a marketing cookie that connects your visit to an email we’ve sent you, so we can follow up helpfully. See our <a href="/privacy-policy">privacy policy</a>.</p>' +
      '<div class="dsc-row">' +
      '<button type="button" class="dsc-accept" data-act="accept">Accept all</button>' +
      '<button type="button" class="dsc-plain" data-act="reject">Essential only</button>' +
      '<button type="button" class="dsc-plain" data-act="manage">Manage choices</button>' +
      '</div>' +
      '<div class="dsc-manage">' +
      '<label><input type="checkbox" checked disabled><span><b>Essential</b><span class="dsc-cat">Required for the site to function. Always on.</span></span></label>' +
      '<label><input type="checkbox" id="dsc-analytics"><span><b>Analytics</b><span class="dsc-cat">Google Analytics — anonymous usage statistics that help us improve the site.</span></span></label>' +
      '<label><input type="checkbox" id="dsc-marketing"><span><b>Marketing</b><span class="dsc-cat">Connects your visit to a Design &amp; Supply email you clicked, so our team can follow up with relevant information.</span></span></label>' +
      '<div class="dsc-row" style="margin-top:4px"><button type="button" class="dsc-accept" data-act="save">Save choices</button></div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    lockScroll();
    document.addEventListener("keydown", onKeydown, true);

    if (existing) {
      var a = document.getElementById("dsc-analytics"), m = document.getElementById("dsc-marketing");
      if (a) a.checked = !!existing.analytics;
      if (m) m.checked = !!existing.marketing;
    }
    var firstBtn = wrap.querySelector("button[data-act=accept]");
    if (firstBtn) firstBtn.focus();

    wrap.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("button[data-act]") : null;
      if (!btn) return;
      var act = btn.getAttribute("data-act");
      if (act === "manage") { wrap.classList.toggle("dsc-open"); return; }
      var analytics, marketing;
      if (act === "accept") { analytics = true; marketing = true; }
      else if (act === "reject") { analytics = false; marketing = false; }
      else { // save
        analytics = !!(document.getElementById("dsc-analytics") || {}).checked;
        marketing = !!(document.getElementById("dsc-marketing") || {}).checked;
      }
      save(analytics, marketing);
      apply({ analytics: analytics, marketing: marketing });
      removeBanner();
    });
  }

  // Reopen from the footer "Cookie settings" link (withdrawal path).
  window.dsCookieSettings = function () { showBanner(read()); };

  function init() {
    document.addEventListener("click", function (e) {
      var link = e.target.closest ? e.target.closest("[data-cookie-settings]") : null;
      if (link) { e.preventDefault(); window.dsCookieSettings(); }
    });
    var c = read();
    if (c) apply(c);          // returning visitor: re-apply on every page load (per spec)
    else showBanner(null);    // first visit: blocking dialog until they choose
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
