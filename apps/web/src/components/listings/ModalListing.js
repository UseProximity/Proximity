"use client";
import React, { useEffect } from "react";

/*
 * `header` renders above the scrolling body, under the close button: a strip
 * that must stay visible and must never cover the ×. A sticky strip inside
 * the scroll area did exactly that (the owner's preview had no way to close).
 */
export default function ModalListing({ isOpen, onClose, header = null, children }) {
  // Prevent body scroll when modal is open, restoring exact scroll position on close
  useEffect(() => {
    if (!isOpen) return;
    const scrollY = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    const prevPosition = document.body.style.position;
    const prevTop = document.body.style.top;
    const prevWidth = document.body.style.width;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.position = prevPosition;
      document.body.style.top = prevTop;
      document.body.style.width = prevWidth;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start md:items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden p-4 pt-[91px] md:pt-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-gray-100 relative flex flex-col w-full max-w-6xl max-h-[calc(100dvh-107px)] md:max-h-[95vh]"
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 text-gray-400 hover:text-gray-600 hover:bg-white/80 text-2xl w-10 h-10 flex items-center justify-center rounded-full transition-all duration-200 hover:scale-110"
        >
          ×
        </button>
        {header}
        {/* No bottom padding under a Proxy chat, whose input bar is pinned to the bottom. */}
        <div className="w-full px-6 pb-6 has-[.listing-proxy-contact]:pb-0 overflow-y-auto overscroll-y-contain scrollbar-hidden flex-1" onScroll={(e) => e.stopPropagation()}>
          {children}
        </div>
      </div>
    </div>
  );
}
