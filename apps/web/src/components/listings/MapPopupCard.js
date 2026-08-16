"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { Star } from "lucide-react";
import HeartIcon from "@/components/ui/HeartIcon";
import { formatAvailableFrom, getRentRangeLabel } from "@/utils/listingFormatters";
import { NON_CAMPUS_WALK_PLACES } from "@/utils/washuPlaces";
import { trackEvent, getListingSource } from "@/utils/analytics";

// Modifier/middle clicks fall through to the browser (open in new tab);
// plain clicks are cancelled so the existing JS handlers keep control.
function suppressPlainClick(e) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
}

function WalkScale({ minutes, label }) {
  const isCampus = label === "campus";
  const filled = isCampus
    ? minutes < 12 ? 1 : minutes < 20 ? 2 : minutes < 30 ? 3 : minutes < 45 ? 4 : 5
    : minutes <= 2 ? 1 : minutes <= 5 ? 2 : minutes <= 10 ? 3 : minutes <= 15 ? 4 : 5;
  const color = filled <= 1 ? "#22c55e" : filled <= 2 ? "#84cc16" : filled <= 3 ? "#eab308" : filled <= 4 ? "#f97316" : "#ef4444";
  return (
    <div className="flex items-center gap-1">
      <svg viewBox="0 0 24 24" fill="currentColor" style={{ color }} className="w-3 h-3 flex-shrink-0">
        <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"/>
      </svg>
      <span style={{ color }} className="text-[10px] tabular-nums tracking-tighter leading-none">
        {minutes} min
      </span>
      <span className="text-[10px] text-gray-400 leading-none capitalize">{label}</span>
    </div>
  );
}

export function ListingCard({ listing, session, onCardClick, isSelected = false, compact = false }) {
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

  // Only legit, non-deleted reviews count toward rating (see buildListing), and
  // rating comes back as 0 when there are none — so numReviews is the gate.
  const numReviews = Number(listing.numReviews) || 0;
  const rating = Number(listing.rating);
  const hasRating = numReviews > 0 && Number.isFinite(rating) && rating > 0;

  // Full cards stack this under the rent (above the landlord name); the compact
  // variant has neither a city line nor a landlord name, so it rides inline on
  // the bed/bath row instead of adding a line its sibling cards don't have.
  const ratingBadge = hasRating ? (
    <span
      className="flex items-center gap-0.5 text-xs whitespace-nowrap flex-shrink-0"
      title={`${rating.toFixed(1)} out of 5 from ${numReviews} review${numReviews === 1 ? "" : "s"}`}
    >
      <Star className="h-3 w-3 fill-red-400 text-red-400 flex-shrink-0" />
      <span className="font-semibold text-gray-700 tabular-nums">
        {rating.toFixed(1)}
      </span>
      <span className="text-gray-400 tabular-nums">({numReviews})</span>
    </span>
  ) : null;

  return (
    <div
      className={`relative group bg-white rounded-2xl shadow-lg transition-colors duration-200 overflow-hidden border flex flex-col cursor-pointer ${isSelected ? "border-red-200" : "border-gray-100 hover:border-red-200"}`}
      onClick={() => {
        // Server-rendered grids (the /washu landing pages) render this card
        // without a handler — they can't pass one, being server components.
        // Cancelling the plain click and then calling nothing left those cards
        // dead: the overlay anchor below only navigates when we let it.
        if (!onCardClick) return;
        onCardClick(listing._id);
        setTimeout(() => {
          const source = getListingSource(listing._id);
          trackEvent("Listing Opened", { listingId: listing._id, address: listing.address, ...(source ? { source } : {}) });
        }, 0);
      }}
    >
      {/* Crawlable link to the listing page. With a handler, plain clicks are
          cancelled and bubble to the card's onClick above so panel/analytics
          behavior is unchanged; cmd/ctrl/middle-click opens a new tab. With no
          handler this is the only navigation there is, so let it through and
          let the destination page record the view. */}
      <a
        href={`/listings/${listing._id}`}
        aria-label={title}
        className="absolute inset-0 z-[1]"
        onClick={onCardClick ? suppressPlainClick : undefined}
      />
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
        {/* PMS-synced listing: availability is live from the property's system.
            Pre-leased listings surface their move-in date instead of hiding. */}
        {!listing.unavailable && (listing.verifiedLive || formatAvailableFrom(listing.availableFrom)) && (
          <div className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
            {listing.verifiedLive && (
              <div className="bg-red-600 text-white text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white" />
                </span>
                <span className="uppercase tracking-wide">Live</span>
              </div>
            )}
            {formatAvailableFrom(listing.availableFrom) && (
              <div className="bg-white/90 text-gray-900 text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm">
                {formatAvailableFrom(listing.availableFrom)}
              </div>
            )}
          </div>
        )}
        {imageCount > 1 && !listing.unavailable && (
          // In the compact (matchmaking row) variant, hide on desktop where the card is small.
          <div className={`absolute bottom-3 right-3 bg-black/70 text-white text-xs font-semibold px-2.5 py-1 rounded-full ${compact ? "md:hidden" : ""}`}>
            See all {imageCount} photos
          </div>
        )}
      </div>
      <div className="p-3 bg-[#fafafa] flex flex-col flex-1">
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <h3 className={`font-bold text-gray-900 leading-snug truncate ${compact ? "text-sm md:text-xs" : "text-sm"}`}>
              {title}
            </h3>
            {cityStateZip && !compact && (
              <p className="text-xs text-gray-500 font-normal mt-0.5 truncate">
                {cityStateZip}
              </p>
            )}
          </div>
          {/* gap-1 matches the pt-1 on the row below, so the rating sits
              evenly spaced between the rent and the landlord name. */}
          <div className="flex flex-col items-end flex-shrink-0 gap-1">
            <span className={`font-bold whitespace-nowrap ${compact ? "text-sm md:text-xs" : "text-sm"} ${listing.unavailable ? "text-gray-400" : "text-[#3C4142]"}`}>
              {getRentRangeLabel(listing.unitTypes)}
              {getRentRangeLabel(listing.unitTypes) !== "Contact for Pricing" && (
                <span className="text-xs font-normal">/mo</span>
              )}
            </span>
            {!compact && ratingBadge}
          </div>
        </div>
        {/* pt-1 only where the rating stacks above — it offsets the extra line
            that column adds, so the bed/bath row keeps its usual spacing. */}
        <div className={`flex items-center justify-between mt-auto min-w-0 gap-2 ${hasRating && !compact ? "pt-1" : "pt-2"}`}>
          <span className="text-gray-500 text-xs truncate flex-1">
            {bedLabel} bed{" | "}
            {bathLabel} bath
            {listing.leaseType ? ` | ${listing.leaseType}` : ""}
          </span>
          {compact && ratingBadge}
          {listing.owner?.name && !compact && (
            <span className="text-gray-400 text-xs truncate max-w-[40%]">
              {listing.owner.name}
            </span>
          )}
        </div>
        {(() => {
          const pwm = listing.placeWalkMinutes;
          const campusMin = pwm && typeof pwm === "object"
            ? (() => {
                const vals = Object.entries(pwm)
                  .filter(([k]) => !NON_CAMPUS_WALK_PLACES.includes(k))
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
      {!compact && (
        <div className="absolute top-3 right-3 z-[2] bg-white/90 backdrop-blur-md rounded-full p-1 shadow-xl border border-white/50 hidden md:block">
          <HeartIcon listingId={listing._id} />
        </div>
      )}
    </div>
  );
}

export function MobileMapPopup({ listing, onClose, onViewListing }) {
  const addressBeforeComma = listing.address.split(",")[0].trim();
  const title = listing.title || addressBeforeComma;
  return (
    <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 px-4 py-3 relative">
      <button
        onClick={onClose}
        className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 p-0.5"
        aria-label="Close"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      <p className="font-semibold text-sm text-gray-900 pr-7 truncate">{title}</p>
      <p className="text-xs text-gray-400 mt-0.5 truncate">{listing.address}</p>
      <div className="flex items-center justify-between mt-3">
        <span className="font-bold text-sm text-gray-900">
          {getRentRangeLabel(listing.unitTypes)}
          {getRentRangeLabel(listing.unitTypes) !== "Contact for Pricing" && (
            <span className="text-xs font-normal text-gray-500">/mo</span>
          )}
        </span>
        <a
          href={`/listings/${listing._id}`}
          onClick={(e) => {
            suppressPlainClick(e);
            if (e.defaultPrevented) onViewListing();
          }}
          className="inline-block px-4 py-1.5 bg-[#E8000B] hover:bg-red-700 text-white text-xs font-semibold rounded-full transition-colors"
        >
          View listing →
        </a>
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
