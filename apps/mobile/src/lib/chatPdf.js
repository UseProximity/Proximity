// PDF attachments for chat. Picking and uploading follow the photo path
// (lib/chatPhotos.js): the same presign endpoint, the same exact Content-Type and byte
// size on the presigned PUT, the same 20 MB and five-file limits, and the same
// attachment metadata the web client sends. A PDF is never re-encoded (web does not
// touch PDFs either); it is only checked, so an empty or non-PDF file is refused here
// instead of being uploaded.
//
// Opening a PDF: the attachment route needs the bearer token, so a browser cannot open
// it directly. The file is downloaded with the token as a header into the cache, then
// handed to the system share sheet (expo-sharing), where the user can open it in a PDF
// viewer or save it to Files.
import { File, FileMode, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import apiClient from "./apiClient";
import { CHAT_PHOTO_MAX_BYTES } from "./chatPhotos";

export const PDF_MIME_TYPE = "application/pdf";
const PDF_MAGIC = "%PDF-";
// The PDF header may follow a little leading data; readers accept it anywhere in the
// first 1024 bytes, so the check looks that far and no further.
const PDF_HEADER_WINDOW = 1024;

function userFacing(message) {
  const error = new Error(message);
  error.userFacing = true;
  return error;
}

function pdfFileName(original, index) {
  const base = (original ?? "").trim().replace(/\.pdf$/i, "") || `document-${index + 1}`;
  return `${base}.pdf`;
}

// Real size and signature of the file, read through a handle so at most the first
// 1024 bytes are loaded. Works for file:// and, on Android, content:// URIs.
function inspect(file) {
  const handle = file.open(FileMode.ReadOnly);
  try {
    const size = handle.size ?? file.info().size ?? 0;
    const head = size > 0 ? handle.readBytes(Math.min(PDF_HEADER_WINDOW, size)) : new Uint8Array();
    // Latin-1 text of the window; built in slices so a large spread never hits an
    // argument-count limit.
    let text = "";
    for (let i = 0; i < head.length; i += 256) {
      text += String.fromCharCode(...head.subarray(i, i + 256));
    }
    return { size, isPdf: text.includes(PDF_MAGIC) };
  } finally {
    handle.close();
  }
}

// Checks one picked file and returns the prepared attachment
// ({ uri, mimeType, fileName, sizeBytes }), copied into the cache first so it stays
// readable after the picker's temporary access ends (Android content:// URIs).
async function preparePdf(picked, index) {
  let file = picked;
  try {
    const copy = new File(Paths.cache, `chat-upload-${Date.now()}-${index}.pdf`);
    await picked.copy(copy);
    file = copy;
  } catch {
    // Use the picked file as it is.
  }

  const { size, isPdf } = inspect(file);
  if (!size || !isPdf) throw userFacing("That file isn't a valid PDF.");
  if (size > CHAT_PHOTO_MAX_BYTES) throw userFacing("Each file must be 20MB or smaller.");

  return {
    uri: file.uri,
    mimeType: PDF_MIME_TYPE,
    fileName: pdfFileName(picked.name, index),
    sizeBytes: size,
  };
}

// Opens the system document picker for PDFs. Resolves to { status: "cancelled" } or
// { status: "ok", pdfs, errors } where `errors` holds the messages for files that were
// refused (empty, not a PDF, too large).
export async function pickChatPdfs({ limit }) {
  const picked = await File.pickFileAsync({ mimeTypes: [PDF_MIME_TYPE], multipleFiles: true });
  if (picked.canceled) return { status: "cancelled" };

  const results = await Promise.allSettled(
    picked.result.slice(0, limit).map((file, i) => preparePdf(file, i))
  );
  return {
    status: "ok",
    pdfs: results.filter((r) => r.status === "fulfilled").map((r) => r.value),
    errors: results
      .filter((r) => r.status === "rejected")
      .map((r) => (r.reason?.userFacing ? r.reason.message : "Couldn't read that file.")),
    skipped: Math.max(0, picked.result.length - limit),
  };
}

function cacheNameFor(attachment) {
  const safe = pdfFileName(attachment.fileName, 0).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);
  return `chat-${attachment.id}-${safe}`;
}

// Downloads through the authenticated attachment route. An expired access token comes
// back as a 401: renew it with one cheap authenticated call (the same approach the photo
// loader uses), then try once more.
async function downloadChatPdf(attachment) {
  const destination = new File(Paths.cache, cacheNameFor(attachment));
  const attempt = async () => {
    const { uri, headers } = await apiClient.chat.getAttachmentSource(attachment.id, { download: true });
    return File.downloadFileAsync(uri, destination, { headers, idempotent: true });
  };
  try {
    return await attempt();
  } catch (error) {
    if (!/\b401\b/.test(String(error?.message))) throw error;
    await apiClient.chat.getRealtimeToken().catch(() => {});
    return attempt();
  }
}

export async function openChatPdf(attachment) {
  if (!attachment?.id) throw userFacing("This PDF isn't available yet.");
  if (!(await Sharing.isAvailableAsync())) {
    throw userFacing("Opening files isn't supported on this device.");
  }
  const file = await downloadChatPdf(attachment);
  await Sharing.shareAsync(file.uri, {
    mimeType: PDF_MIME_TYPE,
    UTI: "com.adobe.pdf",
    dialogTitle: attachment.fileName || "PDF",
  });
}
