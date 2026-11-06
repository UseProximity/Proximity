/*
 * Placeholders in an uploaded agreement PDF become Documenso boxes (Wyatt,
 * 2026-11-06). The admin types [Owner], [Name], [Title], [Company], [Email],
 * [Address 1], [Address 2], [Date], [Signature], [Initials] and [Exhibit A]
 * (on an amendment also [Exhibit A before]) in the document, exports it to PDF
 * and uploads it. We find each placeholder's place on the page, paint it out in
 * white (Documenso boxes have no background, so the text would show through)
 * and put the matching box exactly there, labelled so it is filled for each
 * landlord (BOX_RULES in documenso.js). Nothing to drag or label by hand.
 *
 *   findPlaceholders(bytes)    every [Text] on every page, with its position
 *   boxesFor(found)            the Documenso box for each, in percent coordinates
 *   preparePlaceholders(bytes) { bytes: the PDF with placeholders painted out, boxes, found }
 *
 * Only text a PDF really contains is found: a scanned or flattened PDF has none,
 * and its boxes are placed by hand in Documenso as before.
 */
import { PDFDocument, rgb } from "pdf-lib";
import { BOX_RULES } from "./documenso.js";

// [Owner], [Address 1], [Exhibit A before]: a letter first, up to 40 characters.
const PLACEHOLDER = /\[([A-Za-z][A-Za-z0-9 ._'/-]{0,39})\]/g;

/*
 * Every placeholder in the PDF: [{ label, page (1-based), x, y (baseline), width,
 * size (font size), pageWidth, pageHeight }], in PDF points from the bottom left.
 * Text on one line is joined first, so a placeholder split into pieces by the
 * export ("[Owner" + " Name]") is still found.
 */
export async function findPlaceholders(bytes) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // pdf.js runs its "worker" in this process when it is handed the module. Loading
  // it here also makes the deploy include the file: on Vercel pdf.js's own lookup
  // of pdf.worker.mjs found nothing ("Setting up fake worker failed", 2026-11-07).
  if (!globalThis.pdfjsWorker) globalThis.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const doc = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const out = [];
  try {
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const { width: pageWidth, height: pageHeight } = page.getViewport({ scale: 1 });
      const { items } = await page.getTextContent();
      // Characters by line (same baseline), each spread evenly across its piece's width.
      const lines = new Map();
      for (const item of items) {
        const str = item.str ?? "";
        if (!str) continue;
        const [a, b, , , x, y] = item.transform;
        const size = Math.hypot(a, b) || item.height || 10;
        const key = Math.round(y);
        const line = lines.get(key) ?? { y, chars: [] };
        const step = (item.width || 0) / str.length;
        [...str].forEach((ch, i) => line.chars.push({ ch, x0: x + step * i, x1: x + step * (i + 1), size }));
        lines.set(key, line);
      }
      // The top of each line of real text, so an Exhibit A box can stop above the next one.
      const lineTops = [...lines.values()]
        .filter((l) => l.chars.some((c) => c.ch.trim()))
        .map((l) => ({ y: l.y, top: l.y + Math.max(...l.chars.map((c) => c.size)) * 0.95 }));
      for (const { y, chars } of lines.values()) {
        chars.sort((m, n) => m.x0 - n.x0);
        const text = chars.map((c) => c.ch).join("");
        for (const m of text.matchAll(PLACEHOLDER)) {
          const first = chars[m.index];
          const last = chars[m.index + m[0].length - 1];
          const size = Math.max(...chars.slice(m.index, m.index + m[0].length).map((c) => c.size));
          // The nearest text below this line (another placeholder, a paragraph, the page number).
          const below = lineTops.filter((l) => l.y < y - 1).map((l) => l.top);
          const textBelowTop = below.length ? Math.max(...below) : null;
          out.push({ label: m[1].trim(), page: p, x: first.x0, y, width: last.x1 - first.x0, size, pageWidth, pageHeight, textBelowTop });
        }
      }
    }
  } finally {
    await doc.destroy();
  }
  return out;
}

// A placeholder we turn into a box: Signature, Initials, Date, or a Text box we fill.
export function isKnownPlaceholder(label) {
  return boxTypeOf(label) !== "TEXT" || filledByUs(label);
}

// What kind of Documenso box a placeholder becomes.
export function boxTypeOf(label) {
  if (/\bsignature\b/i.test(label)) return "SIGNATURE";
  if (/\binitials?\b/i.test(label)) return "INITIALS";
  if (/^date$/i.test(label.trim())) return "DATE";
  return "TEXT";
}

const isExhibit = (label) => BOX_RULES.exhibit[0].test(label) || BOX_RULES.exhibitBefore[0].test(label);
// A Text box we fill for each landlord (read-only); any other placeholder is left for them to type.
const filledByUs = (label) => Object.values(BOX_RULES).some(([re, not]) => re.test(label) && !(not && not.test(label)));

/*
 * The Documenso box for each placeholder, in Documenso's percent coordinates
 * (from the top left). A box is at least as wide as useful for its kind; an
 * Exhibit A box runs from its placeholder down to the next placeholder below it
 * on the page, or near the bottom of the page.
 */
export function boxesFor(found) {
  return found.map((f) => {
    const W = f.pageWidth;
    const H = f.pageHeight;
    const type = boxTypeOf(f.label);
    const textTop = f.y + f.size * 0.95;
    let left = f.x;
    let top;
    let width;
    let height;
    if (type === "SIGNATURE") {
      // Sits on the signature line: its bottom just under the placeholder's baseline.
      width = Math.max(f.width, 160);
      height = Math.max(f.size * 2.4, 24);
      top = f.y + height - f.size * 0.35;
    } else if (type === "INITIALS") {
      width = Math.max(f.width, 70);
      height = Math.max(f.size * 2, 20);
      top = f.y + height - f.size * 0.35;
    } else if (isExhibit(f.label)) {
      // Down to just above the next thing below it on the page: a box made from a
      // placeholder (a signature or initials box reaches above its line), or any
      // other text, like a paragraph at the bottom of the page (Wyatt, 2026-11-07).
      // With nothing below, an inch above the bottom of the page.
      const below = found
        .filter((o) => o.page === f.page && o !== f && o.y < f.y)
        .map((o) => o.y + o.size * 1.2 + (boxTypeOf(o.label) === "TEXT" || boxTypeOf(o.label) === "DATE" ? 0 : 26));
      if (f.textBelowTop != null) below.push(f.textBelowTop);
      const floor = below.length ? Math.max(...below) + 6 : 72;
      top = textTop + 2;
      height = Math.max(top - floor, 60);
      width = left < W / 3 ? W - 2 * left : W - left - 54;
    } else {
      // One line high, so boxes on lines close together do not overlap.
      width = Math.max(f.width, type === "DATE" ? 90 : 60);
      height = Math.max(f.size * 1.25, 11);
      top = f.y + f.size * 0.95 + (height - f.size * 1.2) / 2;
    }
    left = Math.min(Math.max(left, 0), W - 10);
    width = Math.min(width, W - left);
    top = Math.min(Math.max(top, height), H);
    const pct = (v, of) => Math.round((v / of) * 100 * 1000) / 1000;
    const exhibit = type === "TEXT" && isExhibit(f.label);
    return {
      type,
      label: f.label,
      page: f.page,
      positionX: pct(left, W),
      positionY: pct(H - top, H),
      width: pct(width, W),
      height: pct(height, H),
      fontSize: Math.min(Math.max(Math.round(f.size), 8), 14),
      readOnly: type === "TEXT" && filledByUs(f.label),
      exhibit,
    };
  });
}

/*
 * The PDF with every placeholder painted out in white, and the boxes to add.
 * Returns { bytes, boxes, found } (the original bytes when there are none).
 */
export async function preparePlaceholders(bytes) {
  let found;
  try {
    // Only the placeholders we know become boxes; any other [bracketed] text, like
    // a drafting note, stays exactly as typed.
    found = (await findPlaceholders(bytes)).filter((f) => isKnownPlaceholder(f.label));
  } catch (err) {
    // An unreadable PDF keeps today's way: boxes placed by hand.
    console.error("billing: could not read placeholders", err?.message);
    return { bytes, boxes: [], found: [] };
  }
  if (!found.length) return { bytes, boxes: [], found };
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  for (const f of found) {
    const page = pages[f.page - 1];
    if (!page) continue;
    page.drawRectangle({
      x: f.x - 1.5,
      y: f.y - f.size * 0.3,
      width: f.width + 3,
      height: f.size * 1.3,
      color: rgb(1, 1, 1),
    });
  }
  return { bytes: await doc.save(), boxes: boxesFor(found), found };
}
