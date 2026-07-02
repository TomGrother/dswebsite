/* Design & Supply — site behaviour (header/footer markup is baked in by build.js) */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
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
