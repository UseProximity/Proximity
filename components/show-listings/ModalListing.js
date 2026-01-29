"use client";
import React, { useEffect } from "react";

export default function ModalListing({ isOpen, onClose, children }) {
  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }

    // Cleanup on unmount
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden"
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
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-xl z-10 w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 hover:scale-110"
        >
          ×
        </button>
        <div className="w-full p-6">{children}</div>
      </div>
    </div>
  );
}
