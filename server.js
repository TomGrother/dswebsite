const express = require("express");
const compression = require("compression");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const PRODUCTION_HOST = "designandsupply.co.uk";

// All indexable pages ("" = homepage) — used for the sitemap
const PAGES = [
  { slug: "", priority: "1.0" },
  { slug: "products", priority: "0.9" },
  { slug: "steel-doors", priority: "0.9" },
  { slug: "security-doors", priority: "0.9" },
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
  { slug: "shop", priority: "0.9" },
  { slug: "about", priority: "0.7" },
  { slug: "team", priority: "0.5" },
  { slug: "case-studies", priority: "0.7" },
  { slug: "news", priority: "0.6" },
  { slug: "downloads", priority: "0.7" },
  { slug: "careers", priority: "0.5" },
  { slug: "contact", priority: "0.8" },
  { slug: "terms", priority: "0.2" },
  { slug: "refund-policy", priority: "0.2" },
];

// 301 redirects from the old website's URL structure (preserves link equity at go-live)
const LEGACY_REDIRECTS = {
  "/products-steel-doors": "/steel-doors",
  "/general-purpose": "/stock-doors",
  "/slimline-architectural-products": "/slimline",
  "/slimline-security-rated": "/slimline-security",
  "/slimline-fire-rated": "/slimline-fire",
  "/meet-the-team": "/team",
  "/meet-the-sales-team": "/team",
  "/meet-the-technical-team": "/team",
  "/product/design-and-supply-shop": "/shop",
  "/terms-conditions": "/terms",
  "/cart": "/shop",
  "/my-account": "/shop",
};

app.use(compression());
app.use(express.json());

app.use((req, res, next) => {
  // Basic security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // Keep staging/preview domains out of search results; only the production
  // domain is indexable.
  if (!req.hostname || !req.hostname.endsWith(PRODUCTION_HOST)) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
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
  next();
});

app.get("/robots.txt", (req, res) => {
  const host = `${req.protocol}://${req.get("host")}`;
  const isProduction = req.hostname && req.hostname.endsWith(PRODUCTION_HOST);
  res.type("text/plain");
  if (isProduction) {
    res.send(`User-agent: *\nAllow: /\n\nSitemap: ${host}/sitemap.xml\n`);
  } else {
    res.send("User-agent: *\nDisallow: /\n");
  }
});

app.get("/sitemap.xml", (req, res) => {
  const host = `${req.protocol}://${req.get("host")}`;
  const urls = PAGES.map(
    (p) =>
      `  <url><loc>${host}/${p.slug}</loc><changefreq>monthly</changefreq><priority>${p.priority}</priority></url>`
  ).join("\n");
  res.type("application/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
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
app.post("/api/contact", (req, res) => {
  const { name, email, phone, subject, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ ok: false, error: "Name, email and message are required." });
  }
  console.log(
    "=== NEW ENQUIRY ===",
    JSON.stringify({ at: new Date().toISOString(), name, email, phone, subject, message })
  );
  res.json({ ok: true });
});

app.use((req, res) => {
  res
    .status(404)
    .send(
      '<!doctype html><meta charset="utf-8"><title>Page not found</title>' +
        '<p style="font-family:sans-serif;padding:40px">Page not found — <a href="/">back to Design &amp; Supply</a></p>'
    );
});

app.listen(PORT, () => {
  console.log(`Design & Supply site running on port ${PORT}`);
});
