"use client";
import React, { useEffect } from "react";

export default function ModalListing({ isOpen, onClose, children }) {
  // Prevent body scroll when modal is open, restoring exact scroll position on close
  useEffect(() => {
    if (!isOpen) return;
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    return () => {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden"
      onClick={onClose}
    >
      <div
        className="bg-white shadow-2xl border border-gray-100 relative w-full max-w-6xl h-screen overflow-y-auto"
        onClick={(e) => {
          // Prevent click from bubbling to the overlay
          e.stopPropagation();
        }}
        onWheel={(e) => {
          // Prevent wheel events from bubbling up to parent elements (like the map)
          e.stopPropagation();
        }}
        onTouchMove={(e) => {
          // Prevent touch scrolling from affecting the background
          e.stopPropagation();
        }}
        onScroll={(e) => {
          // Prevent scroll events from bubbling up
          e.stopPropagation();
        }}
      >
        <button
          onClick={onClose}
          className="absolute top-[calc(env(safe-area-inset-top)+3.25rem)] right-[calc(env(safe-area-inset-right)+1.25rem)] sm:top-3 sm:right-3 text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-2xl z-10 w-10 h-10 flex items-center justify-center rounded-full transition-all duration-200 hover:scale-110"
        >
          ×
        </button>
        <div className="w-full p-6 pt-[calc(env(safe-area-inset-top)+4rem)] sm:pt-6">
          {children}
        </div>
      </div>
    </div>
  );
}
