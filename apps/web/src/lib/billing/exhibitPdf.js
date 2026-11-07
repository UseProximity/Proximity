/*
 * The Exhibit A pages we generate and attach to a landlord's Documenso copy (Wyatt,
 * 2026-11-04). The legal wording is the uploaded PDF (the agreement, or the
 * amendment template) and is never touched; these pages only list properties.
 *
 *   master     "Exhibit A: Covered Properties", every property the agreement
 *              covers, the end of the marketing agreement. It never changes.
 *   amendment  the pages of an Exhibit A amendment, its own document each time
 *              properties are added (Wyatt, 2026-11-06): Exhibit A before and
 *              after, the added properties marked
 *
 * Every page has an initials box in the same place (INITIALS_BOX, in Documenso's
 * percent coordinates), so the landlord initials each page. Nothing is drawn under it.
 *
 * Entries are { listingId, address, units: [label] }, frozen when the document is
 * made (landlord_agreements.exhibit, agreement_amendments.*_exhibit).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE = { width: 612, height: 792 }; // US Letter, points
const MARGIN = 60;
// Content stops above this line, leaving the footer and initials box clear.
const CONTENT_BOTTOM = 110;

// Where Documenso puts the initials box on every exhibit page (percent of the page).
export const INITIALS_BOX = { positionX: 70, positionY: 89, width: 20, height: 5.5 };

// Standard PDF fonts only draw Latin-1. Accents are folded and anything else replaced.
export function pdfSafe(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "?")
    .trim();
}

function wrap(text, font, size, maxWidth) {
  const words = pdfSafe(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

// 11/05/2026 in St. Louis time, the format every agreement date uses.
export const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Chicago" });


/*
 * Build the exhibit. Returns { bytes, pageCount }.
 *   kind          master | amendment
 *   landlordName  who the agreement is with (company name if they gave one)
 *   entries       master: the covered properties; amendment: covered after it
 *   previous      amendment: covered before it
 *   agreementSignedAt  amendment: when the agreement it changes was signed
 */
export async function buildExhibitPdf({ kind = "master", landlordName, entries = [], previous = [], agreementSignedAt = null, preparedAt = new Date() }) {
  const amendment = kind === "amendment";
  const doc = await PDFDocument.create();
  doc.setTitle(amendment ? "Amendment to Exhibit A" : "Exhibit A: Covered Properties");
  doc.setProducer("Proximity");
  doc.setCreator("Proximity");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = PAGE.width - MARGIN * 2;

  let page;
  let y;
  const pages = [];
  const newPage = () => {
    page = doc.addPage([PAGE.width, PAGE.height]);
    pages.push(page);
    y = PAGE.height - MARGIN;
  };
  const text = (str, { size = 11, f = font, x = MARGIN, color = rgb(0, 0, 0), gap = 4 } = {}) => {
    for (const line of wrap(str, f, size, width - (x - MARGIN))) {
      if (y - size < CONTENT_BOTTOM) newPage();
      page.drawText(line, { x, y: y - size, size, font: f, color });
      y -= size + gap;
    }
  };
  const space = (h) => {
    y -= h;
  };

  newPage();
  text(amendment ? "AMENDMENT TO EXHIBIT A" : "EXHIBIT A", { size: 16, f: bold, gap: 6 });
  text("Covered Properties", { size: 12, f: bold });
  space(6);
  text(`Landlord: ${landlordName || "Landlord"}`);
  if (amendment && agreementSignedAt) text(`Marketing agreement signed: ${fmtDate(agreementSignedAt)}`);
  text(`Prepared: ${fmtDate(preparedAt)}`);
  space(14);

  const list = (items, { added = new Set() } = {}) => {
    if (!items.length) {
      text("None.", { color: rgb(0.35, 0.35, 0.35) });
      return;
    }
    items.forEach((e, i) => {
      if (y - 30 < CONTENT_BOTTOM) newPage();
      const isNew = added.has(e.listingId);
      text(`${i + 1}. ${e.address}${isNew ? "  (added by this amendment)" : ""}`, { f: isNew ? bold : font });
      if (e.units?.length) text(`Units: ${e.units.join(", ")}`, { size: 9.5, x: MARGIN + 16, color: rgb(0.3, 0.3, 0.3) });
      space(4);
    });
  };

  if (amendment) {
    const before = new Set(previous.map((e) => e.listingId));
    const added = new Set(entries.filter((e) => !before.has(e.listingId)).map((e) => e.listingId));
    text("Exhibit A before this amendment", { size: 12, f: bold, gap: 8 });
    list(previous);
    space(12);
    text("Exhibit A after this amendment", { size: 12, f: bold, gap: 8 });
    list(entries, { added });
  } else {
    list(entries);
  }

  // Footer on every page: page numbers and the initials box Documenso fills.
  const box = {
    x: (INITIALS_BOX.positionX / 100) * PAGE.width,
    width: (INITIALS_BOX.width / 100) * PAGE.width,
    top: PAGE.height - (INITIALS_BOX.positionY / 100) * PAGE.height,
    height: (INITIALS_BOX.height / 100) * PAGE.height,
  };
  pages.forEach((p, i) => {
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: MARGIN, y: box.top - box.height / 2 - 4, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    p.drawText("Landlord initials", { x: box.x - 80, y: box.top - box.height / 2 - 4, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
    p.drawRectangle({
      x: box.x,
      y: box.top - box.height,
      width: box.width,
      height: box.height,
      borderColor: rgb(0.75, 0.75, 0.75),
      borderWidth: 0.75,
    });
  });

  return { bytes: await doc.save(), pageCount: pages.length };
}
