/*
 * Checks on a signed agreement file before it is stored. Pure, so it can be
 * tested without a bucket. The file arrives through our own route (not straight
 * from the browser), and a Vercel function accepts only about 4.5 MB of body, so
 * the limit sits just under that.
 */
import { BillingError } from "./errors.js";

export const MAX_SIGNED_PDF_BYTES = 4 * 1024 * 1024;

// Every PDF starts with "%PDF-". The file's own name and declared type are not trusted.
export function validateSignedPdf(bytes) {
  const size = bytes?.length ?? 0;
  if (size === 0) throw new BillingError("empty_file", "That file is empty.");
  if (size > MAX_SIGNED_PDF_BYTES) {
    throw new BillingError("file_too_large", "The signed PDF must be 4 MB or smaller.", 413);
  }
  const magic = String.fromCharCode(...Array.from(bytes.subarray(0, 5)));
  if (magic !== "%PDF-") throw new BillingError("not_a_pdf", "The signed agreement must be a PDF file.", 415);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Where a landlord's signed agreement is kept. Built only from a validated user id and a
// fresh random id, so nothing the admin typed can steer the storage path.
export function signedAgreementKey(userId, randomId) {
  if (!UUID.test(userId) || !UUID.test(randomId)) throw new BillingError("bad_key", "Could not store that file.", 500);
  return `billing/agreements/${userId}/${randomId}.pdf`;
}
