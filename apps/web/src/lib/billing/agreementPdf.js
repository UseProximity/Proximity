/*
 * Checks on a signed agreement file before it is stored. Pure, so it can be
 * tested without a bucket. The file arrives through our own route (not straight
 * from the browser), and a Vercel function accepts only about 4.5 MB of body, so
 * the limit sits just under that.
 */
import { BillingError } from "./errors.js";

export const MAX_SIGNED_PDF_BYTES = 4 * 1024 * 1024;

// Every PDF starts with "%PDF-". The file's own name and declared type are not trusted.
// `what` names the file in the messages ("signed agreement", "agreement").
export function validateSignedPdf(bytes, what = "signed agreement") {
  const size = bytes?.length ?? 0;
  if (size === 0) throw new BillingError("empty_file", "That file is empty.");
  if (size > MAX_SIGNED_PDF_BYTES) {
    throw new BillingError("file_too_large", `The ${what} PDF must be 4 MB or smaller.`, 413);
  }
  const magic = String.fromCharCode(...Array.from(bytes.subarray(0, 5)));
  if (magic !== "%PDF-") throw new BillingError("not_a_pdf", `The ${what} must be a PDF file.`, 415);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Where a landlord's signed agreement is kept. Built only from a validated user id and a
// fresh random id, so nothing the admin typed can steer the storage path.
export function signedAgreementKey(userId, randomId) {
  if (!UUID.test(userId) || !UUID.test(randomId)) throw new BillingError("bad_key", "Could not store that file.", 500);
  return `billing/agreements/${userId}/${randomId}.pdf`;
}

// Where an uploaded agreement version (the unsigned document) is kept.
export function agreementVersionKey(randomId) {
  if (!UUID.test(randomId)) throw new BillingError("bad_key", "Could not store that file.", 500);
  return `billing/agreement-versions/${randomId}.pdf`;
}

/*
 * One PDF from several, in order: a signed document is kept as Documenso returns
 * it, one file per part (the agreement, its Exhibit A pages), and shown to people
 * as a single document (Wyatt, 2026-11-06). Each part keeps its own signing
 * certificate page.
 */
export async function mergePdfs(parts) {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const bytes of parts) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}

/*
 * One PDF from a signed document's parts, the document first and Documenso's
 * certificate pages last: `parts` are [{ bytes, bodyPages }], bodyPages being how
 * many pages the part had before signing (null when unknown: the whole part is
 * treated as document). Exhibit A therefore follows the agreement directly.
 */
export async function mergeSignedParts(parts) {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  const certificates = [];
  for (const { bytes, bodyPages } of parts) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const all = src.getPageIndices();
    const cut = bodyPages && bodyPages > 0 && bodyPages < all.length ? bodyPages : all.length;
    (await out.copyPages(src, all.slice(0, cut))).forEach((p) => out.addPage(p));
    if (cut < all.length) certificates.push(...(await out.copyPages(src, all.slice(cut))));
  }
  certificates.forEach((p) => out.addPage(p));
  return out.save();
}

// How many pages a PDF has, or null if it cannot be read.
export async function pageCount(bytes) {
  try {
    const { PDFDocument } = await import("pdf-lib");
    return (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
  } catch {
    return null;
  }
}
