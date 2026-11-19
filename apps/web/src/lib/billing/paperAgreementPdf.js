/*
 * The marketing agreement printed for a landlord to sign on paper (Wyatt,
 * 2026-11-17). It is the agreement version's own PDF with only two things filled
 * in: Exhibit A (the properties the admin picked) and, when given, the company.
 * Everything else the landlord signs or writes by hand. Only the signature and
 * date get a line to write on (Wyatt, 2026-11-17), and only where the agreement
 * does not already draw one there; name, title, email and address are left as
 * blank space.
 *
 * Where each box goes comes from the [Placeholders] typed in the uploaded PDF
 * (placeholders.js), the same places Documenso puts its boxes; they are painted
 * out first so no "[Signature]" is printed. A template whose boxes were placed by
 * hand in Documenso passes them as `templateFields` instead. With no Exhibit A box
 * at all, the list is printed on its own pages at the end.
 *
 * What does not fit in the Exhibit A box goes on "Exhibit A (continued)" pages,
 * as on a Documenso copy (fitExhibit, buildExhibitPdf).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { BOX_RULES, EXHIBIT_CONTINUED_NOTE } from "./documenso.js";
import { buildExhibitPdf, pdfSafe } from "./exhibitPdf.js";
import { preparePlaceholders } from "./placeholders.js";

const EXHIBIT_SIZE = 9;
const EXHIBIT_LEADING = 11.5;
const PAD = 2;

const matches = (kind, label) => {
  const [re, not] = BOX_RULES[kind];
  return re.test(label) && !(not && not.test(label));
};

// What a box is on paper: the Exhibit A list, the company, or a blank to write on.
export function paperBoxKind(box) {
  const label = String(box.label ?? "").trim();
  if (box.type !== "TEXT") return "blank";
  if (matches("exhibitBefore", label)) return "blank";
  if (matches("exhibit", label)) return "exhibit";
  if (matches("company", label) || matches("owner", label)) return "company";
  return "blank";
}

// Documenso's template fields ({ type, page, positionX, ..., fieldMeta.label }) as boxes.
export function boxesFromTemplate(fields = []) {
  return fields
    .filter((f) => f && f.page != null)
    .map((f) => ({
      type: f.type,
      label: String(f.fieldMeta?.label ?? ""),
      page: Number(f.page) || 1,
      positionX: Number(f.positionX) || 0,
      positionY: Number(f.positionY) || 0,
      width: Number(f.width) || 0,
      height: Number(f.height) || 0,
      fontSize: Number(f.fieldMeta?.fontSize) || null,
    }));
}

// A box in PDF points: left, top and bottom from the page's bottom edge.
function place(page, box) {
  const { width: W, height: H } = page.getSize();
  const x = (box.positionX / 100) * W;
  const w = (box.width / 100) * W;
  const h = (box.height / 100) * H;
  const top = H - (box.positionY / 100) * H;
  return { x, w, h, top, bottom: top - h };
}

function wrapLine(text, font, size, maxWidth) {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const out = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

// One property as printed lines: [{ text, bold }]. The address in bold, then its coverage.
function blockLines(block, fonts, width) {
  const [address, ...rest] = String(block).split("\n");
  return [
    ...wrapLine(address, fonts.bold, EXHIBIT_SIZE, width).map((text) => ({ text, bold: true })),
    ...rest.flatMap((r) => wrapLine(r, fonts.regular, EXHIBIT_SIZE, width).map((text) => ({ text, bold: false }))),
  ];
}

/*
 * Lay the properties out over the Exhibit A boxes in order. Returns
 * { placed: [{ ...box, lines }], rest: [block] }: what goes in each box, and what
 * is left for the continued pages. When something is left, the last box keeps two
 * lines for EXHIBIT_CONTINUED_NOTE (a blank line, then the note).
 */
export function layoutExhibit(blocks, boxes, fonts) {
  const fill = (reserve) => {
    const placed = boxes.map((b) => ({ ...b, lines: [] }));
    let i = 0;
    placed.forEach((b, n) => {
      const room = Math.max(1, Math.floor((b.area.h - PAD * 2) / EXHIBIT_LEADING)) - (n === placed.length - 1 ? reserve : 0);
      while (i < blocks.length) {
        const lines = blockLines(blocks[i], fonts, b.area.w - PAD * 2);
        const gap = b.lines.length ? 1 : 0;
        // A property never splits across boxes: one that does not fit waits for the
        // next box, or the continued pages, which take any length.
        if (b.lines.length + gap + lines.length > room) break;
        if (gap) b.lines.push({ text: "", bold: false });
        b.lines.push(...lines);
        i += 1;
      }
    });
    return { placed, rest: blocks.slice(i) };
  };
  const first = fill(0);
  if (!first.rest.length) return first;
  const { placed, rest } = fill(2);
  const last = placed[placed.length - 1];
  if (last.lines.length) last.lines.push({ text: "", bold: false });
  last.lines.push(...wrapLine(EXHIBIT_CONTINUED_NOTE, fonts.regular, EXHIBIT_SIZE, last.area.w - PAD * 2).map((text) => ({ text, bold: false })));
  return { placed, rest };
}

/*
 * Build the printable agreement. Returns { bytes, pageCount }.
 *   versionBytes    the agreement version's uploaded PDF
 *   templateFields  the Documenso template's fields, or a function that loads them:
 *                   used (and loaded) only when the PDF has no placeholders
 *   blocks          one string per property: "address\nWhole building" (coverageLine)
 *   company         printed in the Company / Owner boxes; blank when not given
 *   landlordName    for the heading of any continued pages
 */
// Whether a box already has the agreement's own line under it: a rule on its page
// that runs under its left part, from just below its baseline to a little above it.
export function hasOwnLine(box, rules = []) {
  const left = box.area.x;
  const right = box.area.x + Math.max(box.area.w, 60);
  return rules.some((r) => r.x0 < right && r.x1 > left && r.y <= box.area.top && r.y >= box.area.bottom - 14);
}

// The default for `drawLine`: a signature or a date, without a line of its own.
export const signatureAndDateLines = (box, rules = []) => (box.type === "SIGNATURE" || box.type === "DATE") && !hasOwnLine(box, rules);

// `drawLine(box, rules)`: whether a blank gets a line to write on (default: signatureAndDateLines).
export async function buildPaperAgreementPdf({ versionBytes, templateFields = null, blocks = [], company = "", landlordName = "", preparedAt = new Date(), drawLine = signatureAndDateLines }) {
  // The agreement's own drawn lines, read on the same pass as the placeholders.
  const rules = {};
  const prepared = await preparePlaceholders(versionBytes, { rules });
  // boxesFor keeps the placeholders' order: each box knows the room to its right.
  let boxes = prepared.boxes.map((b, i) => ({ ...b, roomRight: prepared.found[i]?.roomRight ?? null }));
  if (!boxes.length) {
    const fields = typeof templateFields === "function" ? await templateFields() : templateFields;
    if (fields?.length) boxes = boxesFromTemplate(fields);
  }
  const doc = await PDFDocument.load(prepared.bytes, { ignoreEncryption: true });
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const pages = doc.getPages();
  const located = boxes
    .filter((b) => pages[b.page - 1])
    .map((b) => ({ ...b, kind: paperBoxKind(b), area: place(pages[b.page - 1], b) }));

  // The placeholders' own paint-out can leave a sliver of the text at its end (the
  // width is estimated): on paper, clear each one's whole free space on its line.
  // Exhibit A boxes are skipped: their text goes there and nothing else is near.
  for (const f of prepared.found ?? []) {
    const page = pages[f.page - 1];
    if (!page || paperBoxKind({ type: f.label && /\bexhibit\s*a\b/i.test(f.label) ? "TEXT" : "", label: f.label }) === "exhibit") continue;
    const width = Math.min(Math.max(f.width, Number(f.roomRight) || 0) + 4, page.getSize().width - f.x);
    const band = { x0: f.x - 2, x1: f.x - 2 + width, y0: f.y - f.size * 0.35, y1: f.y + f.size * 1.1 };
    page.drawRectangle({ x: band.x0, y: band.y0, width, height: band.y1 - band.y0, color: rgb(1, 1, 1) });
    // The agreement's own line under a placeholder (a signature rule in a Word
    // table sits a point or two below the baseline) is put back where the white
    // covered it, so the copy never loses a line it is counted as having.
    for (const r of rules[f.page] ?? []) {
      if (r.y < band.y0 - 1 || r.y > band.y1 || r.x1 <= band.x0 || r.x0 >= band.x1) continue;
      page.drawLine({ start: { x: Math.max(r.x0, band.x0), y: r.y }, end: { x: Math.min(r.x1, band.x1), y: r.y }, thickness: 0.6, color: rgb(0.25, 0.25, 0.25) });
    }
  }

  // A line to write on along the bottom of the box, long enough to sign or date
  // by hand (but not past the page's right margin).
  const writeLine = (box) => {
    const page = pages[box.page - 1];
    const right = page.getSize().width - 54;
    const want = box.type === "INITIALS" ? Math.max(box.area.w, 70) : Math.max(box.area.w, 200);
    page.drawLine({
      start: { x: box.area.x, y: box.area.bottom + 1 },
      end: { x: Math.max(box.area.x + 40, Math.min(box.area.x + want, right)), y: box.area.bottom + 1 },
      thickness: 0.6,
      color: rgb(0.25, 0.25, 0.25),
    });
  };
  for (const box of located.filter((x) => x.kind === "blank" && drawLine(x, rules[x.page] ?? []))) writeLine(box);

  // The company, on the placeholder's own line and size, made smaller to fit its
  // place when the name is longer than the placeholder was.
  const name = pdfSafe(company);
  for (const box of located.filter((x) => x.kind === "company")) {
    // No company given: blank space for them to write it in.
    if (!name) continue;
    const base = Number(box.fontSize) || Math.min(11, box.area.h * 0.8);
    const room = Math.max(box.area.w, Number(box.roomRight) || 0, 40);
    let size = base;
    while (size > 6 && fonts.regular.widthOfTextAtSize(name, size) > room) size -= 0.25;
    // The placeholder's baseline (boxesFor centres a line 1.2 times its size in the box).
    const baseline = box.area.top - base * 0.95 - Math.max(0, (box.area.h - base * 1.2) / 2);
    pages[box.page - 1].drawText(name, { x: box.area.x + 0.5, y: baseline, size, font: fonts.regular, color: rgb(0, 0, 0) });
  }

  // Exhibit A, in reading order, then whatever does not fit on continued pages.
  const exhibitBoxes = located.filter((x) => x.kind === "exhibit").sort((a, b) => a.page - b.page || b.area.top - a.area.top);
  let extra = null;
  if (exhibitBoxes.length) {
    const { placed, rest } = layoutExhibit(blocks.length ? blocks : ["None."], exhibitBoxes, fonts);
    for (const b of placed) {
      const page = pages[b.page - 1];
      let y = b.area.top - PAD - EXHIBIT_SIZE;
      for (const line of b.lines) {
        if (line.text) page.drawText(line.text, { x: b.area.x + PAD, y, size: EXHIBIT_SIZE, font: line.bold ? fonts.bold : fonts.regular, color: rgb(0, 0, 0) });
        y -= EXHIBIT_LEADING;
      }
    }
    if (rest.length) extra = await buildExhibitPdf({ kind: "continued", heading: "EXHIBIT A (CONTINUED)", landlordName: company || landlordName, blocks: rest, preparedAt });
  } else {
    // No Exhibit A box on this version: the list on its own pages at the end.
    extra = await buildExhibitPdf({ kind: "continued", heading: "EXHIBIT A", landlordName: company || landlordName, blocks, preparedAt });
  }

  if (extra) {
    const more = await PDFDocument.load(extra.bytes);
    for (const p of await doc.copyPages(more, more.getPageIndices())) doc.addPage(p);
  }
  doc.setProducer("Proximity");
  const bytes = await doc.save();
  return { bytes, pageCount: doc.getPageCount() };
}

