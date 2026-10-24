/**
 * Company brochure: brochure/brochure.html (210 x 210 mm pages) -> PDF via
 * headless Microsoft Edge, which ships with Windows — no npm dependency.
 *
 *   node brochure/build-brochure.js            -> brochure/Design-and-Supply-Company-Brochure.pdf
 *   node brochure/build-brochure.js --preview  -> also renders PNG previews (needs py -3 + pymupdf)
 *
 * The PDF is committed (like the other generated documents), so production
 * never runs this.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const SRC = path.join(__dirname, "brochure.html");
// Review copy lives here; copy it to public/files only once it is approved for the website.
const OUT = path.join(__dirname, "Design-and-Supply-Company-Brochure.pdf");

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) throw new Error("Microsoft Edge not found.");

const src = process.argv.includes("--src") ? path.resolve(process.argv[process.argv.indexOf("--src") + 1]) : SRC;
const out = process.argv.includes("--out") ? path.resolve(process.argv[process.argv.indexOf("--out") + 1]) : OUT;

// A private profile stops the call handing off to an Edge window the user
// already has open (which returns before the PDF is written).
const profile = fs.mkdtempSync(path.join(require("os").tmpdir(), "ds-brochure-edge-"));
if (fs.existsSync(out)) fs.unlinkSync(out);
execFileSync(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  `--user-data-dir=${profile}`,
  "--no-pdf-header-footer",
  "--run-all-compositor-stages-before-draw",
  "--virtual-time-budget=15000",
  `--print-to-pdf=${out}`,
  pathToFileURL(src).href,
], { stdio: "ignore" });
const deadline = Date.now() + 60000;
while (!fs.existsSync(out) || fs.statSync(out).size === 0) {
  if (Date.now() > deadline) throw new Error("Edge did not produce " + out);
  execFileSync("node", ["-e", "setTimeout(()=>{},250)"]);
}
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}

console.log("built", path.relative(process.cwd(), out), Math.round(fs.statSync(out).size / 1024) + " KB");

if (process.argv.includes("--preview")) {
  execFileSync("py", ["-3", path.join(__dirname, "preview.py"), out, path.join(__dirname, "preview")], { stdio: "inherit" });
}
