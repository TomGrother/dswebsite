/* Design & Supply — site behaviour (header/footer markup is baked in by build.js) */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var yr = document.getElementById("year");
    if (yr) yr.textContent = new Date().getFullYear();

    // Doors-manufactured ticker (home page). Baseline figure that grows by 100
    // each week, computed from a fixed anchor date so every visitor sees the
    // same, ever-increasing number. Animates a short count-up on load.
    var doors = document.getElementById("doors-made");
    if (doors) {
      var BASE = 150124;
      var ANCHOR = Date.UTC(2026, 6, 21); // 21 Jul 2026 baseline
      var WEEK = 604800000; // 7 days in ms
      var weeks = Math.floor((Date.now() - ANCHOR) / WEEK);
      if (weeks < 0) weeks = 0;
      var target = BASE + weeks * 100;
      var fmt = function (n) { return n.toLocaleString("en-GB"); };
      var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce || !window.requestAnimationFrame) {
        doors.textContent = fmt(target);
      } else {
        var from = Math.max(BASE - 100, target - 240), t0 = null, dur = 1400;
        var step = function (ts) {
          if (t0 === null) t0 = ts;
          var p = Math.min((ts - t0) / dur, 1);
          var eased = 1 - Math.pow(1 - p, 3);
          doors.textContent = fmt(Math.round(from + (target - from) * eased));
          if (p < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
    }

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

    // Reveal on scroll.
    // threshold must stay 0: a percentage threshold can never be met by an
    // element taller than the viewport (e.g. a long article body), which would
    // leave it stuck at opacity 0. rootMargin gives the same "reveal slightly
    // after it enters" feel without that failure mode.
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) { en.target.classList.add("visible"); io.unobserve(en.target); }
        });
      }, { threshold: 0, rootMargin: "0px 0px -8% 0px" });
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
            message: field("message"),
            company: field("company")
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
