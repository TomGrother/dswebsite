/* Design & Supply — shared header/footer + behaviour */
(function () {
  "use strict";

  var HEADER = '\
<div class="topbar">\
  <div class="container">\
    <div class="topbar-links">\
      <a href="tel:01685350114">01685 350 114</a>\
      <a href="mailto:sales@designandsupply.co.uk">sales@designandsupply.co.uk</a>\
    </div>\
    <span class="topbar-note">Open to trade &amp; public &nbsp;·&nbsp; We price match any genuine like-for-like UK manufacturer quote</span>\
  </div>\
</div>\
<div class="site-header" id="siteHeader">\
  <div class="container header-inner">\
    <a class="logo" href="index.html">\
      <img src="images/logo.png" alt="Design &amp; Supply — Door Specialists">\
    </a>\
    <button class="nav-toggle" id="navToggle" aria-label="Toggle menu" aria-expanded="false"><span></span><span></span><span></span></button>\
    <ul class="nav" id="nav">\
      <li data-nav="home"><a class="nav-link" href="index.html">Home</a></li>\
      <li data-nav="about"><a class="nav-link" href="about.html">About Us</a>\
        <ul class="dropdown">\
          <li><a href="about.html">Our Story</a></li>\
          <li><a href="team.html">Meet the Directors</a></li>\
          <li><a href="team.html#sales">Meet the Sales Team</a></li>\
          <li><a href="team.html#technical">Meet the Technical Team</a></li>\
        </ul>\
      </li>\
      <li data-nav="products"><a class="nav-link" href="products.html">Products</a>\
        <ul class="dropdown" style="min-width:280px">\
          <li><div class="dd-label">Steel Doors</div>\
            <a href="steel-doors.html">Steel Doors Overview</a>\
            <a href="security-doors.html">Security Rated Doors</a>\
            <a href="fire-doors.html">Fire Rated Doors</a>\
            <a href="thermal-doors.html">Thermal Rated Doors</a>\
            <a href="flood-doors.html">Flood Defence Doors</a>\
            <a href="acoustic-doors.html">Acoustic Rated Doors</a>\
            <a href="stock-doors.html">Stock Doors</a>\
            <a href="streamline-doors.html">Streamline Doors</a>\
          </li>\
          <li><div class="dd-label">Slimline Architectural</div>\
            <a href="slimline.html">Slimline Overview</a>\
            <a href="slimline-security.html">Slimline Security Rated</a>\
            <a href="slimline-fire.html">Slimline Fire Rated</a>\
            <a href="slimline-non-rated.html">Slimline Non-Rated</a>\
          </li>\
        </ul>\
      </li>\
      <li data-nav="case-studies"><a class="nav-link" href="case-studies.html">Case Studies</a></li>\
      <li data-nav="news"><a class="nav-link" href="news.html">News</a></li>\
      <li data-nav="downloads"><a class="nav-link" href="downloads.html">Downloads</a></li>\
      <li data-nav="careers"><a class="nav-link" href="careers.html">Careers</a></li>\
      <li data-nav="shop"><a class="nav-link" href="shop.html">Shop</a></li>\
      <li data-nav="contact"><a class="nav-link" href="contact.html">Contact</a></li>\
    </ul>\
    <div class="header-cta"><a class="btn btn-primary" href="contact.html">Get a Free Quote</a></div>\
  </div>\
</div>';

  var ICON_IG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>';
  var ICON_FB = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 21v-7h2.4l.4-3h-2.8V9.1c0-.9.3-1.5 1.6-1.5h1.3V4.9c-.3 0-1.1-.1-2-.1-2 0-3.4 1.2-3.4 3.5V11H8.5v3H11v7h2.5z"/></svg>';
  var ICON_YT = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 12s0-3.3-.4-4.8c-.2-.8-.9-1.5-1.7-1.7C18.4 5 12 5 12 5s-6.4 0-7.9.5c-.8.2-1.5.9-1.7 1.7C2 8.7 2 12 2 12s0 3.3.4 4.8c.2.8.9 1.5 1.7 1.7 1.5.5 7.9.5 7.9.5s6.4 0 7.9-.5c-.8-.2 1.5-.9 1.7-1.7.4-1.5.4-4.8.4-4.8zM10 15.5v-7l6 3.5-6 3.5z"/></svg>';
  var ICON_LI = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.5 8.5H3.7V21h2.8V8.5zM5.1 3.5a1.7 1.7 0 100 3.4 1.7 1.7 0 000-3.4zM21 13.4c0-3.2-1.7-4.7-4-4.7-1.8 0-2.7 1-3.1 1.7V8.5H11V21h2.9v-6.7c0-1.5.7-2.4 2-2.4s1.9.9 1.9 2.4V21H21v-7.6z"/></svg>';

  var FOOTER = '\
<div class="container footer-main">\
  <div class="footer-about">\
    <div class="footer-logo">\
      <img src="images/logo-white.png" alt="Design &amp; Supply — Door Specialists">\
    </div>\
    <p>UK manufacturer of security-rated, fire-rated and bespoke architectural steel doors for 36+ years. Designed, fabricated and installed nationwide from Merthyr Tydfil, South Wales.</p>\
    <div class="socials">\
      <a href="https://www.instagram.com/" aria-label="Instagram">' + ICON_IG + '</a>\
      <a href="https://www.facebook.com/" aria-label="Facebook">' + ICON_FB + '</a>\
      <a href="https://www.youtube.com/" aria-label="YouTube">' + ICON_YT + '</a>\
      <a href="https://www.linkedin.com/" aria-label="LinkedIn">' + ICON_LI + '</a>\
    </div>\
  </div>\
  <div>\
    <h4>Steel Doors</h4>\
    <ul>\
      <li><a href="security-doors.html">Security Rated</a></li>\
      <li><a href="fire-doors.html">Fire Rated</a></li>\
      <li><a href="thermal-doors.html">Thermal Rated</a></li>\
      <li><a href="flood-doors.html">Flood Defence</a></li>\
      <li><a href="acoustic-doors.html">Acoustic Rated</a></li>\
      <li><a href="stock-doors.html">Stock Doors</a></li>\
      <li><a href="streamline-doors.html">Streamline Doors</a></li>\
    </ul>\
  </div>\
  <div>\
    <h4>Company</h4>\
    <ul>\
      <li><a href="about.html">About Us</a></li>\
      <li><a href="team.html">Meet the Team</a></li>\
      <li><a href="slimline.html">Slimline Range</a></li>\
      <li><a href="case-studies.html">Case Studies</a></li>\
      <li><a href="news.html">News</a></li>\
      <li><a href="downloads.html">Downloads</a></li>\
      <li><a href="careers.html">Careers</a></li>\
      <li><a href="shop.html">Shop</a></li>\
    </ul>\
  </div>\
  <div>\
    <h4>Contact</h4>\
    <ul>\
      <li>Design &amp; Supply Ltd.<br>13 Pant Ind. Est., Merthyr Tydfil,<br>Mid Glamorgan, CF48 2SR</li>\
      <li><a href="tel:01685350114">01685 350 114</a></li>\
      <li><a href="mailto:sales@designandsupply.co.uk">sales@designandsupply.co.uk</a></li>\
      <li style="color:var(--accent);font-weight:600">Open to trade &amp; public</li>\
    </ul>\
  </div>\
</div>\
<div class="container footer-bottom">\
  <span>&copy; Design &amp; Supply Limited (Company No. 02897610) <span id="year"></span></span>\
  <ul>\
    <li><a href="https://designandsupply.co.uk/wp-content/uploads/2024/01/Modern_Slavery_Statement.pdf">Modern Slavery Statement</a></li>\
    <li><a href="terms.html">Terms &amp; Conditions</a></li>\
    <li><a href="refund-policy.html">Refund Policy</a></li>\
  </ul>\
</div>';

  document.addEventListener("DOMContentLoaded", function () {
    var headerMount = document.getElementById("header");
    var footerMount = document.getElementById("footer");
    if (headerMount) headerMount.innerHTML = HEADER;
    if (footerMount) { footerMount.className = "site-footer"; footerMount.innerHTML = FOOTER; }

    var yr = document.getElementById("year");
    if (yr) yr.textContent = new Date().getFullYear();

    // Active nav item
    var page = document.body.getAttribute("data-page");
    if (page) {
      var active = document.querySelector('[data-nav="' + page + '"]');
      if (active) active.classList.add("active");
    }

    // Mobile nav
    var toggle = document.getElementById("navToggle");
    if (toggle) {
      toggle.addEventListener("click", function () {
        var open = document.body.classList.toggle("nav-open");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }

    // On mobile, tapping a parent item with a dropdown expands it first
    document.querySelectorAll(".nav > li").forEach(function (li) {
      var dd = li.querySelector(".dropdown");
      var link = li.querySelector("a.nav-link");
      if (!dd || !link) return;
      link.addEventListener("click", function (e) {
        if (window.innerWidth <= 1120 && !li.classList.contains("open")) {
          e.preventDefault();
          li.classList.add("open");
        }
      });
    });

    // Header shadow on scroll
    var header = document.getElementById("siteHeader");
    var onScroll = function () {
      if (header) header.classList.toggle("scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    // Reveal on scroll
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add("visible"); io.unobserve(en.target); }
        });
      }, { threshold: 0.12 });
      document.querySelectorAll(".reveal").forEach(function (el) { io.observe(el); });
    } else {
      document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("visible"); });
    }

    // Contact form — posts to the Express endpoint (see server.js)
    var form = document.getElementById("contactForm");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var msg = document.getElementById("formMessage");
        var field = function (id) { var el = document.getElementById(id); return el ? el.value : ""; };
        var show = function (text) {
          if (msg) { msg.style.display = "block"; msg.textContent = text; }
        };
        fetch("/api/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: field("name"),
            email: field("email"),
            phone: field("phone"),
            subject: field("subject"),
            message: field("message")
          })
        }).then(function (r) {
          if (!r.ok) throw new Error("bad status");
          show("Thank you — your enquiry has been received. Our team will be in touch shortly.");
          form.reset();
        }).catch(function () {
          show("Sorry, something went wrong sending your enquiry. Please email sales@designandsupply.co.uk or call 01685 350 114.");
        });
      });
    }
  });
})();
