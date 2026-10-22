// Photo attachments for chat: pick from the library, make sure each file is a type
// the server accepts, and upload through the existing presign endpoint. Sending the
// message itself is the caller's job (apiClient.chat.sendMessage), so a failed upload
// can never leave a message pointing at a missing file.
//
// Image preparation follows web's compressChatImage() (apps/web/src/lib/chat/attachments.js),
// which is what the server's attachment scanner is built around (it only scans files up
// to 4 MiB): an image under 1 MiB is sent as it is; one of 1 MiB or more is re-encoded as
// a JPEG at quality 0.72 with its long edge capped at 1600px, and kept only if that is
// smaller than the original; HEIC is always converted.
//
// The server (chat attachments presign + RPC) accepts JPEG, PNG, WebP and GIF up to
// 20 MB each, 5 per message. The presigned PUT is signed with the exact Content-Type
// and byte length given at presign time, so the bytes measured here are the bytes
// that are uploaded: each file is read into one Blob, its size is what gets presigned,
// and that same Blob is the PUT body.
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import apiClient from "./apiClient";
import { userFacingError } from "./apiError";
import { ERROR_MESSAGES } from "./errorMessages";

export const CHAT_PHOTO_MAX_FILES = 5;
export const CHAT_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// Web's rules, from compressChatImage(): the size at which an image is re-encoded, and
// the settings it is re-encoded with.
const COMPRESS_THRESHOLD_BYTES = 1024 * 1024;
const WEB_ENCODE = { maxDimension: 1600, quality: 0.72 };
// Safeguard only, not part of web's rules: reached when the web settings still leave a
// file over 20 MB, which an ordinary photo never does.
const FALLBACK_ENCODE = { maxDimension: 1024, quality: 0.5 };

function normalizeMime(mime) {
  const value = (mime ?? "").toLowerCase();
  return value === "image/jpg" ? "image/jpeg" : value;
}

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function fileNameFor(original, mimeType, index) {
  const base = (original ?? "").replace(/\.[^.]+$/, "").trim() || `photo-${index + 1}`;
  return `${base}.${EXTENSIONS[mimeType]}`;
}

async function readBlob(uri) {
  const response = await fetch(uri);
  return response.blob();
}

// Opens the photo library. Resolves to { status: "denied" }, { status: "cancelled" }
// or { status: "ok", assets }.
export async function pickChatPhotos({ limit }) {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { status: "denied" };

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images",
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, limit),
    quality: 1,
  });
  if (result.canceled) return { status: "cancelled" };
  return { status: "ok", assets: result.assets.slice(0, limit) };
}

// Re-encodes the original as a JPEG with its long edge capped at `maxDimension`, as
// web's canvas does (the other edge keeps the aspect ratio). Resolves to the result
// with its real dimensions and its measured byte size.
async function encodeJpeg(asset, { maxDimension, quality }) {
  const longEdge = Math.max(asset.width ?? 0, asset.height ?? 0);
  const actions =
    longEdge > maxDimension
      ? [{ resize: asset.width >= asset.height ? { width: maxDimension } : { height: maxDimension } }]
      : [];
  const out = await manipulateAsync(asset.uri, actions, {
    compress: quality,
    format: SaveFormat.JPEG,
  });
  return { uri: out.uri, width: out.width, height: out.height, bytes: (await readBlob(out.uri)).size };
}

// Turns a picked asset into a file the server will accept, following the web rules
// described at the top of this file. Sizes always come from the file's real bytes,
// never from the picker's reported `fileSize`, and a re-encoded file is measured too.
// A photo that cannot be brought to 20 MB or less is refused with a message the UI can
// show, so an oversize file is never staged or uploaded.
export async function prepareChatPhoto(asset, index = 0) {
  const mimeType = normalizeMime(asset.mimeType);
  // HEIC, and any type the server would refuse, must become a JPEG whatever its size.
  const mustConvert = !SUPPORTED_TYPES.has(mimeType);
  const originalBytes = (await readBlob(asset.uri)).size;
  const original = {
    uri: asset.uri,
    mimeType,
    fileName: fileNameFor(asset.fileName, mimeType, index),
    width: asset.width,
    height: asset.height,
  };
  const originalFits = originalBytes > 0 && originalBytes <= CHAT_PHOTO_MAX_BYTES;

  // Under 1 MiB and already an accepted type: sent as it is.
  if (!mustConvert && originalBytes > 0 && originalBytes < COMPRESS_THRESHOLD_BYTES) {
    return original;
  }

  const asJpeg = (encoded) => ({
    uri: encoded.uri,
    mimeType: "image/jpeg",
    fileName: fileNameFor(asset.fileName, "image/jpeg", index),
    width: encoded.width,
    height: encoded.height,
  });
  const fits = (bytes) => bytes > 0 && bytes <= CHAT_PHOTO_MAX_BYTES;

  const web = await encodeJpeg(asset, WEB_ENCODE);
  if (mustConvert) {
    if (fits(web.bytes)) return asJpeg(web);
  } else if (web.bytes > 0 && web.bytes < originalBytes) {
    // Smaller than the original: use it (it is also within 20 MB, being smaller than
    // a file that is itself usually far below that).
    if (fits(web.bytes)) return asJpeg(web);
  } else if (originalFits) {
    // Web's rule: a re-encode that is not smaller is discarded and the original kept.
    return original;
  }

  const fallback = await encodeJpeg(asset, FALLBACK_ENCODE);
  if (fits(fallback.bytes)) return asJpeg(fallback);

  throw userFacingError(ERROR_MESSAGES.CHAT.PHOTO_TOO_LARGE);
}

// Presigns and uploads prepared attachments (photos from prepareChatPhoto, PDFs from
// lib/chatPdf.js: each is { uri, mimeType, fileName }). Resolves to the attachment list for
// apiClient.chat.sendMessage ({ key, fileName, contentType, sizeBytes } each) and
// throws, without anything having been sent, if any step fails.
export async function uploadChatAttachments(threadId, photos) {
  // One read per file; its size is both what is presigned and what is uploaded.
  const blobs = await Promise.all(photos.map((photo) => readBlob(photo.uri)));
  blobs.forEach((blob) => {
    if (!blob.size) throw userFacingError(ERROR_MESSAGES.CHAT.FILE_EMPTY);
    if (blob.size > CHAT_PHOTO_MAX_BYTES) throw userFacingError(ERROR_MESSAGES.CHAT.FILE_TOO_LARGE);
  });

  const { presigned } = await apiClient.chat.presignAttachments(
    threadId,
    photos.map((photo, i) => ({ name: photo.fileName, type: photo.mimeType, size: blobs[i].size }))
  );
  if (!Array.isArray(presigned) || presigned.length !== photos.length) {
    throw userFacingError(ERROR_MESSAGES.CHAT.UPLOAD_PREPARE);
  }

  await Promise.all(
    presigned.map(async (slot, i) => {
      const response = await fetch(slot.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": photos[i].mimeType },
        body: blobs[i],
      });
      if (!response.ok) throw userFacingError(ERROR_MESSAGES.CHAT.UPLOAD_FILE);
    })
  );

  return presigned.map((slot) => ({
    key: slot.key,
    fileName: slot.fileName,
    contentType: slot.contentType,
    sizeBytes: slot.sizeBytes,
  }));
}
