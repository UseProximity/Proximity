"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Fullscreen viewer for chat photos. Rendered in a portal so the message row's
 * swipe transform can't trap the fixed overlay. Arrow keys / chevrons move
 * between the images of the same message; Esc or a backdrop click closes.
 */
export default function ChatImageLightbox({ images, index, onClose, onNavigate }) {
  const [mounted, setMounted] = useState(false);
  const total = images?.length ?? 0;
  const current = total > 0 ? images[Math.min(Math.max(index, 0), total - 1)] : null;

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const go = useCallback(
    (delta) => {
      if (total < 2) return;
      onNavigate((index + delta + total) % total);
    },
    [index, total, onNavigate]
  );

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, go]);

  // The transcript scrolls under the overlay otherwise.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!mounted || !current) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] bg-black/95 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={current.fileName || "Photo"}
    >
      <button
        type="button"
        className="absolute top-4 right-4 z-10 text-white/80 hover:text-white text-4xl leading-none"
        onClick={onClose}
        aria-label="Close photo"
      >
        ×
      </button>

      {current.downloadHref ? (
        <a
          href={current.downloadHref}
          download={current.fileName || undefined}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-4 left-4 z-10 inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-medium text-white"
        >
          <svg
            className="w-4 h-4"
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
          Download
        </a>
      ) : null}

      {total > 1 ? (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(-1);
            }}
            className="absolute left-2 sm:left-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Previous photo"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              go(1);
            }}
            className="absolute right-2 sm:right-4 z-10 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Next photo"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
          <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-white/70 tabular-nums select-none">
            {index + 1} / {total}
          </p>
        </>
      ) : null}

      <div
        className="relative max-w-[92vw] max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.src}
          alt={current.fileName || "Photo"}
          className="object-contain max-w-[92vw] max-h-[88vh] rounded-lg shadow-2xl"
        />
      </div>
    </div>,
    document.body
  );
}
