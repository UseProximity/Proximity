"use client";
import React, { useEffect } from "react";

export default function Modal({ isOpen, onClose, children }) {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden p-2">
      <div className="bg-white rounded-xl shadow-2xl border border-gray-100 relative w-full max-w-2xl sm:max-w-3xl lg:max-w-4xl max-h-[95vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-xl z-10 w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 hover:scale-110"
        >
          ×
        </button>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
