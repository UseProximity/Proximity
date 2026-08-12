"use client";

import { Camera, X } from "lucide-react";
import DraggableImageGrid from "@/components/ui/DraggableImageGrid";
import { StepFrame } from "@/components/listings/wizard/wizardShared";

/*
 * Screen 5: photos. Deliberately low-pressure — phone photos are fine, the
 * Street View shot covers a bare listing, and more can be added post-publish.
 */
export default function StepPhotos({ w }) {
  const showStreetView =
    w.streetView.available && !w.streetViewDeleted;

  return (
    <StepFrame
      title="Add some photos"
      subtitle="Phone photos are fine. You can add or swap photos anytime after publishing."
    >
      {w.importInfo?.photosLoading && (
        <p className="mb-3 flex items-center gap-2 text-sm text-gray-600">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-200 border-t-red-500" />
          Bringing over photos from your website…
        </p>
      )}

      {showStreetView && (
        <div className="mb-4 flex flex-wrap gap-2.5">
          <div className="relative h-24 w-24 flex-shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={w.streetView.url}
              alt="Street View of the property"
              className="h-full w-full rounded-lg border border-gray-200 object-cover"
            />
            <button
              type="button"
              onClick={() => w.setStreetViewDeleted(true)}
              aria-label="Remove Street View photo"
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white shadow hover:bg-red-700"
            >
              <X className="h-3 w-3" />
            </button>
            <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-black/50 py-0.5 text-center text-[9px] text-white">
              Street View
            </div>
          </div>
        </div>
      )}

      {/* Numbered, drag-to-reorder grid — order here is the listing's photo
          order, first photo is the cover. */}
      {w.stagedPreviews.length > 0 && (
        <div className="mb-4">
          <DraggableImageGrid
            images={w.stagedPreviews}
            onReorder={w.reorderStagedPhotos}
            onRemove={w.removeStagedByUrl}
            saving={false}
          />
        </div>
      )}

      <label
        className="flex h-32 w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 transition-colors hover:border-red-400 hover:bg-red-50"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          w.handleImageFiles(e.dataTransfer.files);
        }}
      >
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => w.handleImageFiles(e.target.files)}
        />
        <Camera className="mb-1 h-6 w-6 text-gray-400" />
        <span className="text-sm font-medium text-gray-500">
          Drop photos here or tap to browse
        </span>
      </label>

      {w.streetViewLoading && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
          <span className="h-3 w-3 animate-spin rounded-full border border-gray-300 border-t-red-500" />
          Looking for a Street View photo…
        </p>
      )}
    </StepFrame>
  );
}
