/*
 * Shared allowlist / limits for chat attachments (presign API + client).
 * DB RPC enforces the same rules server-side on send.
 */
export const CHAT_ATTACHMENT_ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export const CHAT_ATTACHMENT_MAX_FILES = 5;
export const CHAT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024; // 20MB

export const CHAT_ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf";

export function isChatAttachmentImage(contentType) {
  return typeof contentType === "string" && contentType.startsWith("image/");
}

export function isChatAttachmentPdf(contentType) {
  return contentType === "application/pdf";
}

export function sanitizeChatAttachmentFileName(name) {
  return (name || "upload").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 100);
}

export function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Inbox / optimistic preview when there is no caption. */
export function attachmentPreviewBody(files) {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) return "Sent a file";
  const images = list.filter((f) =>
    isChatAttachmentImage(f.contentType || f.type)
  ).length;
  const pdfs = list.filter((f) =>
    isChatAttachmentPdf(f.contentType || f.type)
  ).length;
  if (list.length === 1 && images === 1) return "Sent a photo";
  if (list.length === 1 && pdfs === 1) return "Sent a PDF";
  if (images === list.length) return `Sent ${list.length} photos`;
  if (pdfs === list.length) return `Sent ${list.length} PDFs`;
  return `Sent ${list.length} files`;
}

export function chatAttachmentUrl(attachmentId, { download = false } = {}) {
  if (!attachmentId) return "";
  const base = `/api/chat/attachments/${attachmentId}`;
  return download ? `${base}?download=1` : base;
}

/**
 * Canvas-compress large images (and convert HEIC) before chat upload.
 * Browser-only — do not import from server routes.
 */
export function compressChatImage(file) {
  return new Promise((resolve) => {
    if (!file || typeof window === "undefined") {
      resolve(file);
      return;
    }
    const mustConvert = file.type === "image/heic";
    if (!mustConvert && (!file.type?.startsWith("image/") || file.size < 1 * 1024 * 1024)) {
      resolve(file);
      return;
    }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 1600;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob || (!mustConvert && blob.size >= file.size)) {
            resolve(file);
            return;
          }
          resolve(
            new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
              type: "image/jpeg",
            })
          );
        },
        "image/jpeg",
        0.72
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}
