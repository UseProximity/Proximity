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
    <div className="fixed inset-0 z-[60] flex items-start md:items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden p-4 pt-[91px] md:pt-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl border border-gray-100 flex flex-col w-full max-w-xl sm:max-w-2xl lg:max-w-3xl max-h-[calc(100dvh-107px)] md:max-h-[95vh] mx-auto" onClick={(e) => e.stopPropagation()}>
        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-6 pb-6">{children}</div>
      </div>
    </div>
  );
}
