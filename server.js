const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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
