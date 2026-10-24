/**
 * Company brochure: brochure/brochure.html (210 x 210 mm pages) -> PDF via
 * headless Microsoft Edge, which ships with Windows — no npm dependency.
 *
 *   node brochure/build-brochure.js            -> public/files/Design-and-Supply-Company-Brochure.pdf
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
const OUT = path.join(__dirname, "..", "public", "files", "Design-and-Supply-Company-Brochure.pdf");

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].find((p) => fs.existsSync(p));
if (!EDGE) throw new Error("Microsoft Edge not found.");

const src = process.argv.includes("--src") ? path.resolve(process.argv[process.argv.indexOf("--src") + 1]) : SRC;
const out = process.argv.includes("--out") ? path.resolve(process.argv[process.argv.indexOf("--out") + 1]) : OUT;

// A private profile stops the call handing off to an Edge window the user
// already has open (which returns before the PDF is written). Edge prints to
// a temp file that is then copied over the target, so OneDrive sees a modify
// rather than a delete + create (which produces its "Name clash" copies).
const work = fs.mkdtempSync(path.join(require("os").tmpdir(), "ds-brochure-"));
const tmp = path.join(work, "out.pdf");
execFileSync(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  `--user-data-dir=${path.join(work, "profile")}`,
  "--no-pdf-header-footer",
  "--run-all-compositor-stages-before-draw",
  "--virtual-time-budget=15000",
  `--print-to-pdf=${tmp}`,
  pathToFileURL(src).href,
], { stdio: "ignore" });
const deadline = Date.now() + 60000;
let last = -1, stable = 0;
while (stable < 2) {
  if (Date.now() > deadline) throw new Error("Edge did not produce " + out);
  execFileSync("node", ["-e", "setTimeout(()=>{},400)"]);
  const size = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
  stable = size > 0 && size === last ? stable + 1 : 0;
  last = size;
}
fs.copyFileSync(tmp, out);
try { fs.rmSync(work, { recursive: true, force: true }); } catch {}

console.log("built", path.relative(process.cwd(), out), Math.round(fs.statSync(out).size / 1024) + " KB");

if (process.argv.includes("--preview")) {
  execFileSync("py", ["-3", path.join(__dirname, "preview.py"), out, path.join(__dirname, "preview")], { stdio: "inherit" });
}
