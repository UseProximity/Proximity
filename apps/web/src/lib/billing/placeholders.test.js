/*
 * Run with: npm test (from apps/web).
 *
 * [Placeholders] in an uploaded agreement PDF become labelled Documenso boxes in
 * their place, the placeholder text painted out (placeholders.js).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { boxTypeOf, findPlaceholders, preparePlaceholders } from "./placeholders.js";

async function agreementPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const p1 = doc.addPage([612, 792]);
  p1.drawText("This Agreement is entered into on [Date] between Proximity and", { x: 72, y: 700, size: 12, font });
  p1.drawText("Owner/Landlord: [Owner]", { x: 72, y: 680, size: 12, font });
  const p2 = doc.addPage([612, 792]);
  p2.drawText("Name  [Name]", { x: 72, y: 600, size: 12, font });
  // Split into two pieces, as an export can do.
  p2.drawText("[Address", { x: 300, y: 560, size: 12, font });
  p2.drawText(" 1]", { x: 300 + font.widthOfTextAtSize("[Address", 12), y: 560, size: 12, font });
  p2.drawText("By (signature) [Signature]", { x: 72, y: 520, size: 12, font });
  const p3 = doc.addPage([612, 792]);
  p3.drawText("EXHIBIT A", { x: 270, y: 720, size: 12, font });
  p3.drawText("[Exhibit A]", { x: 72, y: 690, size: 12, font });
  p3.drawText("[Initials]", { x: 450, y: 80, size: 12, font });
  // A drafting note in brackets is not a placeholder: it stays as typed.
  p1.drawText("within [NUMBER] days after it ends", { x: 72, y: 640, size: 12, font });
  return doc.save();
}

describe("placeholders in an agreement PDF", () => {
  it("finds every placeholder, on its page and line, even split in two", async () => {
    const found = await findPlaceholders(await agreementPdf());
    assert.deepEqual(
      found.map((f) => `${f.page}:${f.label}`).sort(),
      ["1:Date", "1:NUMBER", "1:Owner", "2:Address 1", "2:Name", "2:Signature", "3:Exhibit A", "3:Initials"].sort()
    );
    const owner = found.find((f) => f.label === "Owner");
    assert.equal(Math.round(owner.y), 680);
    assert.ok(owner.x > 72 + 60, "after the words before it on the line");
  });

  it("makes the right kind of box for each, filled ones read-only, Exhibit A down to the box below", async () => {
    const { boxes, bytes } = await preparePlaceholders(await agreementPdf());
    assert.equal(boxes.some((b) => b.label === "NUMBER"), false, "an unknown [bracket] is left alone");
    const by = Object.fromEntries(boxes.map((b) => [b.label, b]));
    assert.equal(by.Signature.type, "SIGNATURE");
    assert.equal(by.Initials.type, "INITIALS");
    assert.equal(by.Date.type, "DATE");
    assert.equal(by.Owner.type, "TEXT");
    assert.equal(by.Owner.readOnly, true);
    assert.equal(by["Address 1"].readOnly, true);
    assert.equal(by["Exhibit A"].exhibit, true);
    // Exhibit A starts at its placeholder and stops above the initials box.
    const ex = by["Exhibit A"];
    assert.ok(ex.height > 50, "most of the page");
    assert.ok(ex.positionY + ex.height < by.Initials.positionY, "above the initials");
    // The placeholders are painted over in white (the text stays underneath, hidden).
    const original = await agreementPdf();
    assert.ok(bytes.length > original.length, "white boxes drawn over the placeholders");
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 3);
  });

  it("tells box types apart by the placeholder's words", () => {
    assert.equal(boxTypeOf("Owner Signature"), "SIGNATURE");
    assert.equal(boxTypeOf("Initial"), "INITIALS");
    assert.equal(boxTypeOf("Date"), "DATE");
    assert.equal(boxTypeOf("Effective Date"), "TEXT", "only a bare [Date] is the signing date");
    assert.equal(boxTypeOf("Company"), "TEXT");
  });

  it("leaves a PDF without placeholders as it is", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    const bytes = await doc.save();
    const r = await preparePlaceholders(bytes);
    assert.equal(r.boxes.length, 0);
    assert.equal(r.bytes, bytes);
  });
});
