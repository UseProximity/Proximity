/*
 * The Exhibit A pages we generate and attach to a landlord's Documenso copy (Wyatt,
 * 2026-11-04). The legal wording of the agreement is the uploaded PDF and is never
 * touched; these pages only list the covered properties.
 *
 *   master   "Exhibit A: Covered Properties", every property the agreement covers,
 *            the second document in the agreement's envelope
 *   updated  the same list, recreated when properties are added later: every
 *            property covered once it is signed, old and new in one plain list
 *            (Wyatt, 2026-11-05). It is the only document in its envelope, so it
 *            ends with a signature box (Documenso needs one) and the signer's name
 *
 * Every page has an initials box in the same place (INITIALS_BOX, in Documenso's
 * percent coordinates), so the landlord initials each page. Nothing is drawn under it.
 *
 * Entries are { listingId, address, units: [label] }, frozen when the document is
 * made (landlord_agreements.exhibit, agreement_amendments.proposed_exhibit).
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

const SIGNATURE_HEIGHT = 40; // points

/*
 * Build the exhibit. Returns { bytes, pageCount, signatureBox }.
 *   kind          master | updated
 *   landlordName  who the agreement is with (company name if they gave one)
 *   entries       every covered property
 *   signer        updated: { name, title } printed under the signature box
 *   agreementSignedAt  updated: when the agreement it belongs to was signed
 * signatureBox is where Documenso's signature box goes on the last page (percent
 * coordinates), null for a master exhibit.
 */
export async function buildExhibitPdf({ kind = "master", landlordName, entries = [], signer = null, agreementSignedAt = null, preparedAt = new Date() }) {
  const updated = kind === "updated";
  const doc = await PDFDocument.create();
  doc.setTitle(updated ? "Exhibit A: Covered Properties (updated)" : "Exhibit A: Covered Properties");
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
  text("EXHIBIT A", { size: 16, f: bold, gap: 6 });
  text("Covered Properties", { size: 12, f: bold });
  space(6);
  text(`Landlord: ${landlordName || "Landlord"}`);
  if (updated && agreementSignedAt) text(`Commission agreement signed: ${fmtDate(agreementSignedAt)}`);
  text(`${updated ? "Updated" : "Prepared"}: ${fmtDate(preparedAt)}`);
  space(14);

  if (!entries.length) text("None.", { color: rgb(0.35, 0.35, 0.35) });
  entries.forEach((e, i) => {
    if (y - 30 < CONTENT_BOTTOM) newPage();
    text(`${i + 1}. ${e.address}`);
    if (e.units?.length) text(`Units: ${e.units.join(", ")}`, { size: 9.5, x: MARGIN + 16, color: rgb(0.3, 0.3, 0.3) });
    space(4);
  });

  // The signature block of an updated exhibit: the box Documenso fills, then who signs.
  let signatureBox = null;
  if (updated) {
    const needed = SIGNATURE_HEIGHT + 60;
    if (y - needed < CONTENT_BOTTOM) newPage();
    space(16);
    text("Signature", { size: 9, color: rgb(0.3, 0.3, 0.3), gap: 2 });
    const top = y;
    const boxWidth = 220;
    page.drawLine({ start: { x: MARGIN, y: top - SIGNATURE_HEIGHT }, end: { x: MARGIN + boxWidth, y: top - SIGNATURE_HEIGHT }, thickness: 0.75, color: rgb(0.6, 0.6, 0.6) });
    signatureBox = {
      positionX: (MARGIN / PAGE.width) * 100,
      positionY: ((PAGE.height - top) / PAGE.height) * 100,
      width: (boxWidth / PAGE.width) * 100,
      height: (SIGNATURE_HEIGHT / PAGE.height) * 100,
    };
    y = top - SIGNATURE_HEIGHT - 6;
    if (signer?.name) text(`${signer.name}${signer.title ? `, ${signer.title}` : ""}`, { size: 10 });
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

  return { bytes: await doc.save(), pageCount: pages.length, signatureBox };
}
