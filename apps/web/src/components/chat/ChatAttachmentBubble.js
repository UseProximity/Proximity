"use client";

import { useState } from "react";
import ChatImageLightbox from "@/components/chat/ChatImageLightbox";
import {
  chatAttachmentUrl,
  formatFileSize,
  isChatAttachmentImage,
  isChatAttachmentPdf,
} from "@/lib/chat/attachments";

/** Optimistic sends carry a blob URL and a local- id until the row comes back. */
function isPersisted(attachment) {
  return !!attachment?.id && !String(attachment.id).startsWith("local-");
}

function attachmentSrc(attachment) {
  if (attachment?.localUrl) return attachment.localUrl;
  return isPersisted(attachment) ? chatAttachmentUrl(attachment.id) : null;
}

function attachmentDownloadHref(attachment) {
  return isPersisted(attachment)
    ? chatAttachmentUrl(attachment.id, { download: true })
    : null;
}

function DownloadIcon({ className }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12M12 16.5V3"
      />
    </svg>
  );
}

function FileIcon({ className }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
      />
    </svg>
  );
}

function AttachmentImage({ attachment, mine, onOpen }) {
  const src = attachmentSrc(attachment);
  const downloadHref = attachmentDownloadHref(attachment);

  if (!src) {
    return (
      <div
        className={`rounded-lg px-3 py-2 text-xs ${
          mine ? "bg-red-500/40 text-white" : "bg-gray-200 text-gray-600"
        }`}
      >
        {attachment.fileName || "Photo"}
      </div>
    );
  }

  return (
    <div className="relative group/att overflow-hidden rounded-lg">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="block w-full cursor-zoom-in disabled:cursor-default"
        aria-label={`View ${attachment.fileName || "photo"} full screen`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={attachment.fileName || "Attached photo"}
          className="max-h-64 w-auto max-w-full object-contain rounded-lg"
        />
      </button>
      {downloadHref ? (
        <a
          href={downloadHref}
          download={attachment.fileName || undefined}
          className={`absolute bottom-2 right-2 p-1.5 rounded-full opacity-0 group-hover/att:opacity-100 transition-opacity ${
            mine
              ? "bg-black/50 text-white hover:bg-black/70"
              : "bg-white/90 text-gray-700 hover:bg-white shadow-sm"
          }`}
          aria-label={`Download ${attachment.fileName || "photo"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <DownloadIcon className="w-3.5 h-3.5" />
        </a>
      ) : null}
    </div>
  );
}

function AttachmentFile({ attachment, mine }) {
  const href =
    attachment.id && !String(attachment.id).startsWith("local-")
      ? chatAttachmentUrl(attachment.id, { download: true })
      : null;
  const sizeLabel = formatFileSize(attachment.sizeBytes);
  const kind = isChatAttachmentPdf(attachment.contentType) ? "PDF" : "File";

  const inner = (
    <>
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
          mine ? "bg-red-500/40 text-white" : "bg-white text-gray-600"
        }`}
      >
        <FileIcon className="w-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={`text-sm font-medium truncate ${
            mine ? "text-white" : "text-gray-900"
          }`}
        >
          {attachment.fileName || kind}
        </p>
        <p
          className={`text-[11px] ${mine ? "text-red-100" : "text-gray-500"}`}
        >
          {[kind, sizeLabel].filter(Boolean).join(" · ")}
        </p>
      </div>
      {href ? (
        <DownloadIcon
          className={`w-4 h-4 flex-shrink-0 ${
            mine ? "text-red-100" : "text-gray-400"
          }`}
        />
      ) : null}
    </>
  );

  const className = `flex items-center gap-2.5 rounded-lg px-2.5 py-2 min-w-[11rem] max-w-[16rem] ${
    mine ? "bg-red-500/30 hover:bg-red-500/45" : "bg-white/80 hover:bg-white"
  } ${href ? "cursor-pointer" : "cursor-default"}`;

  if (href) {
    return (
      <a
        href={href}
        download={attachment.fileName || undefined}
        className={className}
        aria-label={`Download ${attachment.fileName || kind}`}
      >
        {inner}
      </a>
    );
  }

  return <div className={className}>{inner}</div>;
}

/**
 * Renders an attachment message: inline images + downloadable file rows,
 * optional caption under the media.
 */
export default function ChatAttachmentBubble({ message }) {
  const mine = !!message?.isMine;
  const attachments = Array.isArray(message?.metadata?.attachments)
    ? message.metadata.attachments
    : [];
  const caption =
    typeof message?.metadata?.caption === "string"
      ? message.metadata.caption.trim()
      : "";
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const lightboxImages = attachments
    .filter((att) => isChatAttachmentImage(att.contentType) || att.localUrl)
    .map((att) => ({
      src: attachmentSrc(att),
      fileName: att.fileName,
      downloadHref: attachmentDownloadHref(att),
    }))
    .filter((img) => img.src);

  return (
    <>
      <div
        className={`rounded-2xl overflow-hidden ${
          mine
            ? "bg-red-600 text-white rounded-br-sm"
            : "bg-gray-100 text-gray-800 rounded-bl-sm"
        } ${String(message?.id).startsWith("temp-") ? "opacity-70" : ""}`}
      >
        <div className="flex flex-col gap-1.5 p-1.5">
          {attachments.map((att, i) => {
            const key = att.id || `${att.fileName}-${i}`;
            if (isChatAttachmentImage(att.contentType) || att.localUrl) {
              const viewerIndex = lightboxImages.findIndex(
                (img) => img.src === attachmentSrc(att)
              );
              return (
                <AttachmentImage
                  key={key}
                  attachment={att}
                  mine={mine}
                  onOpen={
                    viewerIndex >= 0
                      ? () => setLightboxIndex(viewerIndex)
                      : undefined
                  }
                />
              );
            }
            return <AttachmentFile key={key} attachment={att} mine={mine} />;
          })}
        </div>
        {caption ? (
          <div className="px-3 pb-2 pt-0.5 text-sm leading-snug whitespace-pre-wrap break-words">
            {caption}
          </div>
        ) : null}
      </div>
      {lightboxIndex != null && lightboxImages.length > 0 ? (
        <ChatImageLightbox
          images={lightboxImages}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      ) : null}
    </>
  );
}
