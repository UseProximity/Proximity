"use client";

import { useState, useRef } from "react";

/**
 * Drag-and-drop image grid.
 *
 * Props:
 *   images     string[]              — ordered list of image URLs
 *   onReorder  (newUrls: string[]) => void  — called after a successful drag
 *   onRemove   (url: string) => void        — called when × is clicked
 *   saving     boolean               — shows a saving indicator
 */
export default function DraggableImageGrid({ images, onReorder, onRemove, saving }) {
  const dragIdx = useRef(null);
  const [dragOver, setDragOver] = useState(null);

  if (!images?.length) return null;

  const handleDragStart = (i) => { dragIdx.current = i; };

  const handleDragOver = (e, i) => {
    e.preventDefault();
    if (dragIdx.current !== null && dragIdx.current !== i) setDragOver(i);
  };

  const handleDrop = (e, dropIdx) => {
    e.preventDefault();
    const from = dragIdx.current;
    if (from === null || from === dropIdx) { dragIdx.current = null; setDragOver(null); return; }
    const next = [...images];
    const [moved] = next.splice(from, 1);
    next.splice(dropIdx, 0, moved);
    dragIdx.current = null;
    setDragOver(null);
    onReorder(next);
  };

  const handleDragEnd = () => { dragIdx.current = null; setDragOver(null); };

  return (
    <div>
      {saving && (
        <p className="text-xs text-gray-400 mb-2 flex items-center gap-1.5">
          <span className="w-3 h-3 border border-gray-300 border-t-gray-500 rounded-full animate-spin" />
          Saving order…
        </p>
      )}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {images.map((url, i) => (
          <div
            key={url}
            draggable
            onDragStart={() => handleDragStart(i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDrop={(e) => handleDrop(e, i)}
            onDragEnd={handleDragEnd}
            className={`relative aspect-square rounded-lg overflow-hidden border-2 cursor-grab active:cursor-grabbing group transition
              ${dragOver === i ? "border-red-400 scale-105" : "border-gray-200"}`}
          >
            <img src={url} alt="" className="w-full h-full object-cover pointer-events-none" />

            {/* Drag handle */}
            <div className="absolute top-1 left-1 bg-black/50 rounded p-0.5 opacity-0 group-hover:opacity-100 transition">
              <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 6h2v2H8zm0 4h2v2H8zm0 4h2v2H8zm6-8h2v2h-2zm0 4h2v2h-2zm0 4h2v2h-2z" />
              </svg>
            </div>

            {/* Position badge */}
            <div className="absolute bottom-1 left-1 bg-black/50 rounded px-1.5 py-0.5 text-white text-[10px] font-medium">
              {i + 1}
            </div>

            {/* Remove */}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(url)}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400 mt-2">Drag to reorder · First image is the cover photo</p>
    </div>
  );
}
