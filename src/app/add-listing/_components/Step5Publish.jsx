"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export default function Step8Publish({ state, onBack }) {
  const { listingId } = state;
  const [listing, setListing] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!listingId) return;
    fetch(`/api/listing/${listingId}`).then((r) => r.json()).then(setListing);
  }, [listingId]);

  const aiSuggestedCount = Object.values(state.fieldStates).filter((f) => f.state === "ai_suggested").length;

  const publish = async () => {
    setPublishing(true);
    try {
      // Mark listing as available (remove draft status)
      const res = await fetch(`/api/landlord/listings/${listingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unavailable: false }),
      });
      if (!res.ok) throw new Error("Failed to publish listing");
      setPublished(true);
      toast.success("Listing published!");
      setTimeout(() => router.push("/dashboard/landlord"), 1500);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPublishing(false);
    }
  };

  if (published) {
    return (
      <div className="py-16 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">Listing published!</h2>
        <p className="text-sm text-gray-500">Redirecting to your dashboard…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-1">Ready to publish?</h2>
        <p className="text-sm text-gray-500">Your listing is currently hidden from students. Publish it to make it visible on the browse page.</p>
      </div>

      {/* Summary card */}
      {listing && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 space-y-2">
          <p className="font-semibold text-gray-900">{listing.title || listing.address}</p>
          {listing.address && listing.title && <p className="text-sm text-gray-600">{listing.address}</p>}
          <div className="flex flex-wrap gap-3 text-sm text-gray-600 pt-1">
            {listing.unitTypes?.length > 0 && (
              <span>{listing.unitTypes.length} lease offer{listing.unitTypes.length !== 1 ? "s" : ""}</span>
            )}
            {listing.images?.length > 0 && (
              <span>{listing.images.length} photo{listing.images.length !== 1 ? "s" : ""}</span>
            )}
            <span>{listing.homeType || "—"}</span>
          </div>
        </div>
      )}

      {/* Warnings */}
      {aiSuggestedCount > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 flex items-start gap-3">
          <span className="text-yellow-500 text-lg">⚠️</span>
          <div>
            <p className="text-sm font-medium text-yellow-800">{aiSuggestedCount} AI-suggested field{aiSuggestedCount !== 1 ? "s" : ""} not yet confirmed</p>
            <p className="text-xs text-yellow-700 mt-0.5">You can publish now and confirm them later, or go back to step 5 to review.</p>
          </div>
        </div>
      )}

      {!listing?.unitTypes?.length && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
          <p className="text-sm font-medium text-orange-800">No lease offers added yet. Go back to step 6 to add at least one.</p>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">← Back</button>
        <div className="flex gap-3">
          <button
            onClick={() => router.push("/dashboard/landlord")}
            className="px-5 py-2 border border-gray-300 text-gray-700 rounded-md font-medium hover:bg-gray-50 text-sm transition"
          >
            Save as draft
          </button>
          <button
            onClick={publish}
            disabled={publishing || !listing?.unitTypes?.length}
            className="px-6 py-2 bg-red-600 text-white rounded-md font-medium hover:bg-red-700 disabled:opacity-50 text-sm transition"
          >
            {publishing ? "Publishing…" : "Publish listing"}
          </button>
        </div>
      </div>
    </div>
  );
}
