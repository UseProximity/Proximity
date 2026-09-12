"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import PickerList from "./PickerList";

/* The same property list, in a sheet: for phones, and for changing a side
 * that is already filled on any screen. */
export default function PropertyPicker({ open, slot, items, campus = "danforth", currentId, otherId, onChoose, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-0 h-[100dvh] max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-black/50 sm:m-auto sm:h-auto sm:max-h-[85vh] sm:w-[34rem]"
    >
      <div className="flex h-full max-h-[100dvh] flex-col bg-white sm:max-h-[85vh] sm:rounded-xl sm:border sm:border-gray-200 sm:shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-bold text-gray-900">
            {slot === 0 ? "Pick the first apartment" : "Pick the second apartment"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {open && (
          <PickerList
            items={items}
            campus={campus}
            currentId={currentId}
            otherId={otherId}
            onChoose={onChoose}
            autoFocus
            className="min-h-0 flex-1"
          />
        )}
      </div>
    </dialog>
  );
}
