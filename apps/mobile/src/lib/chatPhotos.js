// Photo attachments for chat: pick from the library, make sure each file is a type
// the server accepts, and upload through the existing presign endpoint. Sending the
// message itself is the caller's job (apiClient.chat.sendMessage), so a failed upload
// can never leave a message pointing at a missing file.
//
// The server (chat attachments presign + RPC) accepts JPEG, PNG, WebP and GIF up to
// 20 MB each, 5 per message. The presigned PUT is signed with the exact Content-Type
// and byte length given at presign time, so the bytes measured here are the bytes
// that are uploaded: each file is read into one Blob, its size is what gets presigned,
// and that same Blob is the PUT body.
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import apiClient from "./apiClient";

export const CHAT_PHOTO_MAX_FILES = 5;
export const CHAT_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
// Used only when a photo has to be re-encoded (HEIC, or over the size limit). Each
// attempt re-encodes the original; a later, smaller one is tried only if the previous
// result is still over the limit.
const CONVERT_ATTEMPTS = [
  { maxDimension: 2560, quality: 0.85 },
  { maxDimension: 1600, quality: 0.6 },
  { maxDimension: 1024, quality: 0.5 },
];

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

// Turns a picked asset into a file the server will accept. A JPEG, PNG, WebP or GIF
// within the size limit is used exactly as picked. Anything else (HEIC, an unknown
// type) or anything over 20 MB is re-encoded as a JPEG with expo-image-manipulator.
// Sizes are always measured from the file's real bytes, never from the picker's
// reported `fileSize`, and the re-encoded file is measured too. If a photo cannot be
// brought under 20 MB it is refused here, with a message the UI can show, so an
// oversize file is never staged or uploaded.
export async function prepareChatPhoto(asset, index = 0) {
  const mimeType = normalizeMime(asset.mimeType);
  if (SUPPORTED_TYPES.has(mimeType)) {
    const bytes = (await readBlob(asset.uri)).size;
    if (bytes > 0 && bytes <= CHAT_PHOTO_MAX_BYTES) {
      return {
        uri: asset.uri,
        mimeType,
        fileName: fileNameFor(asset.fileName, mimeType, index),
        width: asset.width,
        height: asset.height,
      };
    }
  }

  for (const { maxDimension, quality } of CONVERT_ATTEMPTS) {
    const longEdge = Math.max(asset.width ?? 0, asset.height ?? 0);
    const actions =
      longEdge > maxDimension
        ? [{ resize: asset.width >= asset.height ? { width: maxDimension } : { height: maxDimension } }]
        : [];
    const converted = await manipulateAsync(asset.uri, actions, {
      compress: quality,
      format: SaveFormat.JPEG,
    });
    const bytes = (await readBlob(converted.uri)).size;
    if (bytes > 0 && bytes <= CHAT_PHOTO_MAX_BYTES) {
      return {
        uri: converted.uri,
        mimeType: "image/jpeg",
        fileName: fileNameFor(asset.fileName, "image/jpeg", index),
        width: converted.width,
        height: converted.height,
      };
    }
  }

  const error = new Error("A photo is too large to send.");
  error.userFacing = true;
  throw error;
}

// Presigns and uploads the prepared photos. Resolves to the attachment list for
// apiClient.chat.sendMessage ({ key, fileName, contentType, sizeBytes } each) and
// throws, without anything having been sent, if any step fails.
export async function uploadChatPhotos(threadId, photos) {
  // One read per file; its size is both what is presigned and what is uploaded.
  const blobs = await Promise.all(photos.map((photo) => readBlob(photo.uri)));
  blobs.forEach((blob) => {
    if (!blob.size) throw new Error("One of the photos is empty.");
    if (blob.size > CHAT_PHOTO_MAX_BYTES) throw new Error("Each photo must be 20MB or smaller.");
  });

  const { presigned } = await apiClient.chat.presignAttachments(
    threadId,
    photos.map((photo, i) => ({ name: photo.fileName, type: photo.mimeType, size: blobs[i].size }))
  );
  if (!Array.isArray(presigned) || presigned.length !== photos.length) {
    throw new Error("Couldn't prepare the upload.");
  }

  await Promise.all(
    presigned.map(async (slot, i) => {
      const response = await fetch(slot.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": photos[i].mimeType },
        body: blobs[i],
      });
      if (!response.ok) throw new Error("Couldn't upload a photo. Please try again.");
    })
  );

  return presigned.map((slot) => ({
    key: slot.key,
    fileName: slot.fileName,
    contentType: slot.contentType,
    sizeBytes: slot.sizeBytes,
  }));
}
