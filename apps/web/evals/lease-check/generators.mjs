/*
 * Document generators for the Lease Check eval harness.
 *
 * Everything here is SYNTHETIC and generated with known ground truth, so the runner
 * can assert against facts we control (rent type, tenant count, which clauses are
 * present, injected PII, the address). Two families:
 *   - makePdf(lines): a minimal single-page text PDF (crisp, machine-readable text).
 *   - makeLeaseImage(lines, opts): an SVG page rasterized to PNG via sharp, with
 *     optional degradation (blur, downscale, rotate, jpeg-crush, crop) to mimic a
 *     phone photo or bad scan.
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";

// fileURLToPath decodes %20 etc. — the repo path contains spaces.
const WEB = fileURLToPath(new URL("../../", import.meta.url)); // apps/web/
const require = createRequire(WEB + "package.json");
const sharp = require("sharp");

// ---- Text PDF (crisp) ------------------------------------------------------
export function makePdf(lines) {
  const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  let stream = "BT /F1 10 Tf 12 TL 50 770 Td\n";
  for (const line of lines) stream += `(${esc(line)}) Tj T*\n`;
  stream += "ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return { kind: "pdf", mediaType: "application/pdf", base64: Buffer.from(pdf, "latin1").toString("base64") };
}

// ---- Lease page as an image (with optional degradation) --------------------
function svgPage(lines) {
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const W = 1000;
  const H = 1300;
  let text = "";
  let y = 60;
  for (const line of lines) {
    text += `<text x="60" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="22" fill="#111">${esc(line)}</text>`;
    y += 34;
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fdfdfb"/>${text}</svg>`
  );
}

/*
 * degrade options (any combination):
 *   blur:      gaussian sigma (e.g. 2.5) — soft/out-of-focus photo
 *   shrink:    downscale factor 0-1 then upscale back — loses fine detail (low-res scan)
 *   rotate:    degrees — a crooked phone photo
 *   jpegQ:     jpeg quality 1-100 — compression artifacts
 *   cropTop:   0-1 fraction of the page height to KEEP from the top — simulates a page
 *              cut off at the bottom (content below the cut is gone)
 */
export async function makeLeaseImage(lines, opts = {}) {
  let img = sharp(svgPage(lines));
  const meta = { width: 1000, height: 1300 };

  if (opts.cropTop && opts.cropTop < 1) {
    const keep = Math.max(1, Math.round(meta.height * opts.cropTop));
    img = sharp(await img.png().toBuffer()).extract({ left: 0, top: 0, width: meta.width, height: keep });
  }
  if (opts.shrink && opts.shrink < 1) {
    const w = Math.max(50, Math.round(meta.width * opts.shrink));
    img = sharp(await img.png().toBuffer()).resize(w).resize(meta.width);
  }
  if (opts.blur) img = img.blur(opts.blur);
  if (opts.rotate) img = img.rotate(opts.rotate, { background: "#e8e8e0" });

  const q = opts.jpegQ ?? 72;
  const base64 = (await img.jpeg({ quality: q }).toBuffer()).toString("base64");
  return { kind: "image", mediaType: "image/jpeg", base64 };
}
