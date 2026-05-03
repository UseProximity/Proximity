"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import HeartIcon from "@/components/ui/HeartIcon";
import { getRentRangeLabel } from "@/utils/listingFormatters";
import { trackEvent } from "@/utils/analytics";

// Visual dot-scale: more dots = farther, color goes green → yellow → red
// Campus thresholds: <10=1, <15=2, <20=3, <30=4, ≥30=5
// Shuttle thresholds: ≤2=1, ≤5=2, ≤10=3, ≤15=4, >15=5
function WalkScale({ minutes, label }) {
  const isCampus = label === "campus";
  const filled = isCampus
    ? minutes < 12 ? 1 : minutes < 20 ? 2 : minutes < 30 ? 3 : minutes < 45 ? 4 : 5
    : minutes <= 2 ? 1 : minutes <= 5 ? 2 : minutes <= 10 ? 3 : minutes <= 15 ? 4 : 5;
  const color = filled <= 1 ? "#22c55e" : filled <= 2 ? "#84cc16" : filled <= 3 ? "#eab308" : filled <= 4 ? "#f97316" : "#ef4444";
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-gray-400 leading-none capitalize">{label}</span>
      <div className="flex gap-0.5">
        {[1,2,3,4,5].map((d) => (
          <span
            key={d}
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: d <= filled ? color : "#e5e7eb" }}
          />
        ))}
      </div>
    </div>
  );
}

export function ListingCard({ listing, session, onCardClick, isSelected = false }) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const imgWrapperRef = useRef(null);
  const imageUrl = listing.images?.[0];

  // onLoad doesn't fire for cached images — check .complete on mount
  useEffect(() => {
    if (!imgWrapperRef.current) return;
    const img = imgWrapperRef.current.querySelector("img");
    if (img?.complete && img.naturalWidth > 0) setImageLoaded(true);
  }, []);
  const imageCount = listing.images?.length || 0;
  const addressBeforeComma = listing.address.split(",")[0].trim();
  const title = listing.title || addressBeforeComma;
  const cityStateZip = (listing.title && listing.title !== addressBeforeComma)
    ? listing.address
    : listing.address.replace(/^[^,]+,\s*/, "");
  const bedValues = listing.unitTypes
    .map((u) => u.bedrooms)
    .filter(Number.isFinite);
  const bathValues = listing.unitTypes
    .map((u) => u.bathrooms)
    .filter(Number.isFinite);
  const bedLabel =
    bedValues.length === 0
      ? "N/A"
      : Math.min(...bedValues) === Math.max(...bedValues)
      ? String(Math.min(...bedValues))
      : `${Math.min(...bedValues)}-${Math.max(...bedValues)}`;
  const bathLabel =
    bathValues.length === 0
      ? "N/A"
      : Math.min(...bathValues) === Math.max(...bathValues)
      ? String(Math.min(...bathValues))
      : `${Math.min(...bathValues)}-${Math.max(...bathValues)}`;

  return (
    <div
      className={`relative group bg-white rounded-2xl shadow-lg transition-colors duration-200 overflow-hidden border flex flex-col cursor-pointer ${isSelected ? "border-red-200" : "border-gray-100 hover:border-red-200"}`}
      onClick={() => {
        onCardClick(listing._id);
        setTimeout(() => trackEvent("listing_click", { listingId: listing._id, address: listing.address }), 0);
      }}
    >
      <div
        ref={imgWrapperRef}
        className="relative aspect-video bg-gray-100"
      >
        {imageUrl ? (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-600" />
              </div>
            )}
            <Image
              src={imageUrl}
              alt={listing.address}
              fill
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              className={`object-cover${listing.unavailable ? " opacity-50 grayscale" : ""}`}
              onLoad={() => setImageLoaded(true)}
            />
          </>
        ) : (
          <div className="absolute inset-0 bg-gray-100 flex items-center justify-center text-gray-400">
            No image
          </div>
        )}
        {listing.unavailable && (
          <div className="absolute top-3 left-3 bg-gray-800/80 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
            Unavailable
          </div>
        )}
        {imageCount > 1 && !listing.unavailable && (
          <div className="absolute bottom-3 right-3 bg-black/70 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
            See all {imageCount} photos
          </div>
        )}
      </div>
      <div className="p-3 bg-[#fafafa] flex flex-col flex-1">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <h3 className="font-bold text-sm text-gray-900 leading-snug truncate">
              {title}
            </h3>
            {cityStateZip && (
              <p className="text-xs text-gray-500 font-normal mt-0.5 truncate">
                {cityStateZip}
              </p>
            )}
          </div>
          <span className={`font-bold text-sm whitespace-nowrap flex-shrink-0 ${listing.unavailable ? "text-gray-400" : "text-[#3C4142]"}`}>
            {getRentRangeLabel(listing.unitTypes)}
            {getRentRangeLabel(listing.unitTypes) !== "Contact for Pricing" && (
              <span className="text-xs font-normal">/mo</span>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between mt-auto pt-2 min-w-0">
          <span className="text-gray-500 text-xs truncate flex-1">
            {bedLabel} bed{" | "}
            {bathLabel} bath
            {listing.leaseType ? ` | ${listing.leaseType}` : ""}
          </span>
          {listing.owner?.name && (
            <span className="text-gray-400 text-xs truncate ml-2 max-w-[40%]">
              {listing.owner.name}
            </span>
          )}
        </div>
        {(() => {
          const pwm = listing.placeWalkMinutes;
          const campusMin = pwm && typeof pwm === "object"
            ? (() => {
                const vals = Object.entries(pwm)
                  .filter(([k]) => !k.toLowerCase().includes("grocery"))
                  .map(([, v]) => v)
                  .filter(Number.isFinite);
                return vals.length > 0 ? Math.min(...vals) : null;
              })()
            : typeof pwm === "number" ? pwm : null;
          const shuttleMin = typeof listing.shuttleWalkMinutes === "number" ? listing.shuttleWalkMinutes : null;
          if (campusMin == null && shuttleMin == null) return null;
          return (
            <div className="flex items-center gap-3 mt-1.5">
              {campusMin != null && Number.isFinite(campusMin) && (
                <WalkScale minutes={campusMin} label="campus" />
              )}
              {shuttleMin != null && (
                <WalkScale minutes={shuttleMin} label="shuttle" />
              )}
            </div>
          );
        })()}
      </div>
      <div className={`absolute bottom-0 left-0 h-0.5 bg-red-600 transition-[width] duration-300 group-hover:w-full ${isSelected ? "w-full" : "w-0"}`} />
      <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md rounded-full p-1 shadow-xl border border-white/50">
        <HeartIcon listingId={listing._id} />
      </div>
    </div>
  );
}

export default function MapPopupCard({
  listing,
  session,
  onClose,
  onCardClick,
}) {
  return (
    <div className="relative drop-shadow-2xl">
      <button
        onClick={onClose}
        className="absolute -top-3 -right-3 z-10 bg-white rounded-full shadow-lg p-1.5 border border-gray-200 hover:bg-gray-50 transition-colors"
        aria-label="Close"
      >
        <svg
          className="w-3.5 h-3.5 text-gray-600"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
      <ListingCard
        listing={listing}
        session={session}
        onCardClick={onCardClick}
      />
    </div>
  );
}
