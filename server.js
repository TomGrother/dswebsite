const express = require("express");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const path = require("path");
const store = require("./db");
const content = require("./content");
const adminRouter = require("./admin");
const portalRouter = require("./orderhub/portal");
const ingestRouter = require("./orderhub/ingest");

const app = express();
app.set("trust proxy", 1); // Railway sits behind a proxy; needed for correct client IPs and req.protocol
app.disable("x-powered-by");
const PORT = process.env.PORT || 3000;
const PRODUCTION_HOST = "designandsupply.co.uk";

// Throttle abuse-prone endpoints (brute force on login, contact-form spam).
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: "Too many attempts. Please wait a few minutes and try again." });
const contactLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false, message: { ok: false, error: "Too many enquiries from this device. Please try again shortly." } });

// All indexable pages ("" = homepage) — used for the sitemap
const PAGES = [
  { slug: "", priority: "1.0" },
  { slug: "products", priority: "0.9" },
  { slug: "steel-doors", priority: "0.9" },
  { slug: "security-doors", priority: "0.9" },
  { slug: "security-doors-sr1", priority: "0.8" },
  { slug: "security-doors-sr2", priority: "0.8" },
  { slug: "security-doors-sr3", priority: "0.8" },
  { slug: "security-doors-sr4", priority: "0.8" },
  { slug: "fire-doors", priority: "0.9" },
  { slug: "thermal-doors", priority: "0.8" },
  { slug: "flood-doors", priority: "0.8" },
  { slug: "acoustic-doors", priority: "0.8" },
  { slug: "stock-doors", priority: "0.8" },
  { slug: "streamline-doors", priority: "0.8" },
  { slug: "slimline", priority: "0.9" },
  { slug: "slimline-security", priority: "0.8" },
  { slug: "slimline-fire", priority: "0.8" },
  { slug: "slimline-non-rated", priority: "0.8" },
  { slug: "about", priority: "0.7" },
  { slug: "team", priority: "0.5" },
  { slug: "case-studies", priority: "0.7" },
  { slug: "news", priority: "0.6" },
  { slug: "downloads", priority: "0.7" },
  { slug: "contact", priority: "0.8" },
  { slug: "terms", priority: "0.2" },
  { slug: "refund-policy", priority: "0.2" },
  { slug: "privacy-policy", priority: "0.2" },
];

// 301 redirects from the old website's URL structure (preserves link equity at go-live)
const LEGACY_REDIRECTS = {
  // Careers page retired post-launch; send old links/index entries to About.
  "/careers": "/about",
  "/products-steel-doors": "/steel-doors",
  "/general-purpose": "/stock-doors",
  "/slimline-architectural-products": "/slimline",
  "/slimline-security-rated": "/slimline-security",
  "/slimline-fire-rated": "/slimline-fire",
  "/meet-the-team": "/team",
  "/meet-the-sales-team": "/team",
  "/meet-the-technical-team": "/team",
  // The shop is now an internal pricing tool, so old public shop URLs go to
  // the stock doors page instead.
  "/product/design-and-supply-shop": "/stock-doors",
  "/terms-conditions": "/terms",
  // Old WordPress permalink for the T&Cs (nested slug) -> new /terms page.
  "/general-payment-terms-conditions/general-payment-terms-conditions": "/terms",
  "/cart": "/stock-doors",
  "/my-account": "/stock-doors",
};

app.use(compression());
app.use(express.json({ limit: "4mb" })); // 4mb headroom for the ingest snapshot payload
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.use(cookieParser());

// Security headers via helmet. CSP is intentionally left off here — the site
// uses some inline styles/scripts, so a Content-Security-Policy needs its own
// dedicated pass. Everything else (HSTS, nosniff, frameguard, etc.) is on.
app.use(
  helmet({
    contentSecurityPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // Allow images/assets to be embedded cross-origin (social cards, search).
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 15552000, includeSubDomains: true }, // 180 days
  })
);

app.use((req, res, next) => {
  // Keep staging/preview domains out of search results; only the production
  // domain is indexable.
  if (!req.hostname || !req.hostname.endsWith(PRODUCTION_HOST)) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
  }

  // Canonical host: send www -> the bare apex (matches our canonical tags),
  // preserving the path and query string and upgrading to https.
  if (req.hostname === "www." + PRODUCTION_HOST) {
    return res.redirect(301, "https://" + PRODUCTION_HOST + req.originalUrl);
  }

  // Canonicalise URLs: strip trailing slashes and .html extensions
  const p = req.path;
  if (p.length > 1 && p.endsWith("/")) {
    return res.redirect(301, p.slice(0, -1));
  }
  if (LEGACY_REDIRECTS[p]) {
    return res.redirect(301, LEGACY_REDIRECTS[p]);
  }
  if (p === "/index.html" || p === "/index") {
    return res.redirect(301, "/");
  }
  if (p.endsWith(".html")) {
    return res.redirect(301, p.slice(0, -5));
  }
  // Old WordPress upload URLs -> local /files copies (preserves inbound
  // links to data sheets after go-live)
  if (p.startsWith("/wp-content/uploads/") && p.endsWith(".pdf")) {
    const name = p.split("/").pop();
    return res.redirect(301, "/files/" + name);
  }
  // The old site published case studies under /case_studies/<slug> (underscore)
  if (p === "/case_studies" || p.startsWith("/case_studies/")) {
    return res.redirect(301, p.replace("/case_studies", "/case-studies"));
  }
  next();
});

app.get("/robots.txt", (req, res) => {
  const host = `${req.protocol}://${req.get("host")}`;
  const isProduction = req.hostname && req.hostname.endsWith(PRODUCTION_HOST);
  res.type("text/plain");
  if (isProduction) {
    res.send(`User-agent: *\nAllow: /\nDisallow: /shop\n\nSitemap: ${host}/sitemap.xml\n`);
  } else {
    res.send("User-agent: *\nDisallow: /\n");
  }
});

app.get("/sitemap.xml", (req, res) => {
  const host = `${req.protocol}://${req.get("host")}`;
  const entries = PAGES.map(
    (p) =>
      `  <url><loc>${host}/${p.slug}</loc><changefreq>monthly</changefreq><priority>${p.priority}</priority></url>`
  );
  // Published articles and case studies are part of the sitemap too
  for (const post of [...store.published("news"), ...store.published("case-study")]) {
    const slug = (post.type === "news" ? "news/" : "case-studies/") + post.slug;
    const lastmod = (post.updated_at || post.published_at || "").slice(0, 10);
    entries.push(
      `  <url><loc>${host}/${slug}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}<changefreq>yearly</changefreq><priority>0.6</priority></url>`
    );
  }
  res.type("application/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</urlset>\n`);
});

// Admin (password-gated inside the router) and dynamic content pages.
// These come before express.static so /news and /case-studies render from the DB.
app.post("/admin/login", loginLimiter);
app.use("/admin", (req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  next();
}, adminRouter);
app.use(content.router);

// Order Hub — private customer/staff portal (noindex, no-store) + secured
// ingest endpoint for the internal SQL Server sync.
app.use(["/portal", "/api/ingest"], (req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.post("/portal/login", loginLimiter);
app.post("/portal/forgot", loginLimiter); // throttle reset requests (anti email-bomb)
app.use("/portal", portalRouter);
app.use("/api/ingest", ingestRouter);

// The shop is an internal pricing tool: it stays hosted but is unlinked,
// never indexed, and password-gated whenever SHOP_PASSWORD is set.
app.use("/shop", (req, res, next) => {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Cache-Control", "no-store");
  const expected = process.env.SHOP_PASSWORD;
  if (!expected) return next();

  const [scheme, encoded] = (req.headers.authorization || "").split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const supplied = decoded.slice(decoded.indexOf(":") + 1);
    if (supplied === expected) return next();
  }
  res.setHeader("WWW-Authenticate", 'Basic realm="Design & Supply internal", charset="UTF-8"');
  res.status(401).send("Authentication required.");
});

app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      } else if (/\.(png|jpg|jpeg|webp|svg|ico|css|js)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=604800");
      }
    },
  })
);

// Contact form endpoint — enquiries show up in the Railway deploy logs.
// Swap the console.log for an email service or database when ready.
app.post("/api/contact", contactLimiter, (req, res) => {
  const { name, email, phone, subject, message, company } = req.body || {};
  // Honeypot: "company" is an invisible field. Bots fill it; humans never do.
  if (company) {
    return res.json({ ok: true }); // silently accept and drop
  }
  if (!name || !email || !message) {
    return res.status(400).json({ ok: false, error: "Name, email and message are required." });
  }
  console.log(
    "=== NEW ENQUIRY ===",
    JSON.stringify({ at: new Date().toISOString(), name, email, phone, subject, message })
  );
  res.json({ ok: true });
});

// Branded 404
const notFoundPage = (() => {
  try {
    return fs.readFileSync(path.join(__dirname, "public", "404.html"), "utf8");
  } catch {
    return '<!doctype html><meta charset="utf-8"><title>Page not found</title><p style="font-family:sans-serif;padding:40px">Page not found — <a href="/">back to Design &amp; Supply</a></p>';
  }
})();
app.use((req, res) => {
  res.status(404).type("html").send(notFoundPage);
});

// A fresh database (new Railway volume) imports the migrated content on boot.
try {
  require("./seed").seedIfEmpty();
} catch (err) {
  console.error("Content seed skipped:", err.message);
}

// Create the initial Order Hub staff admin from env, if configured and absent.
require("./orderhub/seed")
  .ensureAdminFromEnv()
  .catch((err) => console.error("Order Hub admin bootstrap skipped:", err.message));

// Start the once-a-day customer digest scheduler (no-op if RESEND_API_KEY unset).
try {
  require("./orderhub/notify").startDigestScheduler();
} catch (err) {
  console.error("Order Hub digest scheduler skipped:", err.message);
}

app.listen(PORT, () => {
  console.log(`Design & Supply site running on port ${PORT}`);
});
