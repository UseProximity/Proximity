/*
 * Checks on a file a landlord (or an admin) attaches to a change request: their
 * marked-up copy of the agreement. Pure, so it can be tested without a bucket;
 * storing it is changeRequestFiles.js.
 *
 * Only PDF and Word files, 4 MB or smaller (a Vercel function accepts about 4.5 MB
 * of body). The type is decided by the file's first bytes, never by the name or the
 * type the browser declared, and the stored name is cleaned so it is safe in a
 * download header. These files are kept privately and never sent to Documenso.
 */
import { BillingError } from "./errors.js";

export const MAX_CHANGE_FILE_BYTES = 4 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CHANGE_FILE_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
};

const startsWith = (bytes, sig) => sig.every((b, i) => bytes[i] === b);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // a .docx is a zip
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // a .doc is an OLE compound file

const extensionOf = (name) => {
  const m = /\.([a-z0-9]{1,5})$/i.exec(String(name ?? ""));
  return m ? m[1].toLowerCase() : "";
};

/*
 * The file's real type from its bytes. A zip only counts as Word when it is named
 * .docx (a zip on its own could be anything) and holds the Word part names.
 */
export function detectChangeFileType(bytes, name) {
  if (!bytes?.length) return null;
  if (startsWith(bytes, PDF)) return "pdf";
  if (startsWith(bytes, OLE) && extensionOf(name) === "doc") return "doc";
  if (startsWith(bytes, ZIP) && extensionOf(name) === "docx") {
    const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 64 * 1024))).toString("latin1");
    if (head.includes("word/") || head.includes("[Content_Types].xml")) return "docx";
  }
  return null;
}

// A name safe to store and to put in a download header: letters, digits, dot,
// dash, underscore and space only, at most 100 characters, ending in the real type.
export function cleanChangeFileName(name, ext) {
  const base = String(name ?? "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[^\w .-]+/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/^[\s.-]+|[\s.-]+$/g, "")
    .slice(0, 90);
  return `${base || "attachment"}.${ext}`;
}

// Validates an attachment. Returns { ext, contentType, fileName, size }.
export function validateChangeFile({ bytes, name }) {
  const size = bytes?.length ?? 0;
  if (size === 0) throw new BillingError("empty_file", "That file is empty.");
  if (size > MAX_CHANGE_FILE_BYTES) throw new BillingError("file_too_large", "Attach a file of 4 MB or smaller.", 413);
  const ext = detectChangeFileType(bytes, name);
  if (!ext) throw new BillingError("bad_file_type", "Attach a PDF or a Word document (.pdf, .docx or .doc).", 415);
  return { ext, contentType: CHANGE_FILE_TYPES[ext], fileName: cleanChangeFileName(name, ext), size };
}

// Where an attachment is kept: under the landlord the request belongs to. Built only
// from validated ids and the detected type, so nothing typed can steer the path.
export function changeFileKey(userId, randomId, ext) {
  if (!UUID.test(userId) || !UUID.test(randomId) || !CHANGE_FILE_TYPES[ext]) {
    throw new BillingError("bad_key", "Could not store that file.", 500);
  }
  return `billing/agreement-change-requests/${userId}/${randomId}.${ext}`;
}
