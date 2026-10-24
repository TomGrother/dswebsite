// Step 2b: OCR the rendered code columns with tesseract.js (the copy bundled
// with Desktop\PdfEditor, which also carries the English model offline).
//   node ocr_tesseract.js <workdir>
// Writes <workdir>/ocr_tesseract.json: [{ page, lines: [{ text, y, h, conf }] }]
const fs = require("fs");
const path = require("path");
const PDFED = "C:/Users/DSLaptop3/Desktop/PdfEditor";
const { createWorker } = require(path.join(PDFED, "node_modules", "tesseract.js"));

(async () => {
  const work = process.argv[2];
  const worker = await createWorker("eng", 1, {
    langPath: path.join(PDFED, "vendor", "tessdata"),
    gzip: true,
    cachePath: work,
    logger: () => {},
  });
  await worker.setParameters({ tessedit_pageseg_mode: "6" }); // a single uniform block of text
  const out = [];
  const files = fs.readdirSync(work).filter((f) => /^p\d+\.png$/.test(f)).sort();
  for (const f of files) {
    const { data } = await worker.recognize(path.join(work, f));
    out.push({
      page: Number(f.slice(1, 3)),
      lines: data.lines.map((l) => ({ text: l.text.trim(), y: l.bbox.y0, h: l.bbox.y1 - l.bbox.y0, conf: Math.round(l.confidence) })),
    });
  }
  await worker.terminate();
  fs.writeFileSync(path.join(work, "ocr_tesseract.json"), JSON.stringify(out, null, 1));
  console.log("tesseract ocr:", out.length, "pages");
})();
