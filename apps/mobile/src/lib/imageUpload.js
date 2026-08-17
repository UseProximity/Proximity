// Reusable image-picker + compression + presigned-upload pipeline for Add
// Listing's Photos step. Mirrors web's AddListingWizard.js: pick/stage
// images locally, then (once the listing exists) presign -> PUT to R2 ->
// confirm. Compression matches web's compressImage() — resize to a 1920px
// long edge and re-encode as JPEG q0.85, but only for images >=1MB (smaller
// files pass through untouched) — since /api/upload and r2.js do no
// server-side size/type validation (apps/web/src/lib/r2.js), mobile has to
// self-police size here.
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import apiClient from "./apiClient";

const COMPRESS_THRESHOLD_BYTES = 1024 * 1024; // 1MB, matches web's compressImage()
const MAX_DIMENSION = 1920;

// Requests library permission (if not already granted) and opens the native
// picker. Returns a plain array of { uri, fileName, mimeType, fileSize,
// width, height } — [] if the user cancels or denies permission.
export async function pickImages({ selectionLimit = 10 } = {}) {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return [];

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images",
    allowsMultipleSelection: true,
    selectionLimit,
    quality: 1,
  });
  if (result.canceled) return [];

  return result.assets.map((a) => ({
    uri: a.uri,
    fileName: a.fileName ?? "photo.jpg",
    mimeType: a.mimeType ?? "image/jpeg",
    fileSize: a.fileSize ?? null,
    width: a.width,
    height: a.height,
  }));
}

// Resizes to a 1920px long edge and re-encodes as JPEG q0.85 — only when the
// original is >=1MB (or its size is unknown), matching web's threshold.
// Returns the same asset shape with uri/mimeType/fileName/dimensions updated
// to the compressed result.
export async function compressImage(asset) {
  if (asset.fileSize != null && asset.fileSize < COMPRESS_THRESHOLD_BYTES) {
    return asset;
  }

  const longEdge = Math.max(asset.width ?? 0, asset.height ?? 0);
  const resize =
    longEdge > MAX_DIMENSION
      ? asset.width >= asset.height
        ? { width: MAX_DIMENSION }
        : { height: MAX_DIMENSION }
      : null;

  const result = await manipulateAsync(asset.uri, resize ? [{ resize }] : [], {
    compress: 0.85,
    format: SaveFormat.JPEG,
  });

  return {
    ...asset,
    uri: result.uri,
    mimeType: "image/jpeg",
    fileName: asset.fileName.replace(/\.[^.]+$/, ".jpg"),
    width: result.width,
    height: result.height,
    // manipulateAsync doesn't report the recompressed file's byte size.
    fileSize: null,
  };
}

// Uploads already-picked/compressed images to a listing via the presigned
// flow: presign -> raw PUT to R2 -> confirm. Mirrors
// AddListingWizard.js/publish()'s upload block. A single image's failure
// doesn't throw — it's collected so the caller can surface a non-blocking
// warning; the listing exists either way, matching web.
export async function uploadImages(listingId, images) {
  if (!images.length) return { uploadedUrls: [], failedCount: 0 };

  const { presigned } = await apiClient.uploads.presignUpload(
    listingId,
    images.map((img) => ({ name: img.fileName, type: img.mimeType }))
  );

  const results = await Promise.allSettled(
    images.map(async (img, i) => {
      const res = await fetch(img.uri);
      const blob = await res.blob();
      await apiClient.uploads.uploadToPresignedUrl(presigned[i].uploadUrl, blob, img.mimeType);
      return presigned[i].publicUrl;
    })
  );

  const uploadedUrls = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const failedCount = results.length - uploadedUrls.length;

  if (uploadedUrls.length) {
    await apiClient.uploads.confirmUpload(listingId, uploadedUrls);
  }

  return { uploadedUrls, failedCount };
}
