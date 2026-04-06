"use client";

import Image from "next/image";
import HeartIcon from "@/components/HeartIcon";
import { getRentRangeLabel } from "@/utils/listingFormatters";

export function ListingCard({ listing, session, onCardClick }) {
  const imageUrl = listing.images?.[0];
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
      className="relative group bg-white rounded-2xl shadow-lg transition-colors duration-200 overflow-hidden border border-gray-100 hover:border-red-200 flex flex-col cursor-pointer"
      onClick={() => onCardClick(listing._id)}
    >
      <div className="relative aspect-video">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={listing.address}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className={`object-cover${listing.unavailable ? " opacity-50 grayscale" : ""}`}
          />
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
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-bold text-sm text-gray-900 leading-snug">
              {title}
            </h3>
            {cityStateZip && (
              <p className="text-xs text-gray-500 font-normal mt-0.5">
                {cityStateZip}
              </p>
            )}
          </div>
          <span className={`font-bold text-sm whitespace-nowrap flex-shrink-0 ${listing.unavailable ? "text-gray-400" : "text-red-500"}`}>
            {getRentRangeLabel(listing.unitTypes)}
            {getRentRangeLabel(listing.unitTypes) !== "Contact for Pricing" && (
              <span className="text-xs font-normal">/mo</span>
            )}
          </span>
        </div>
        <div className="flex items-center justify-between mt-auto pt-2">
          <span className="text-gray-500 text-xs">
            {bedLabel} bed{" | "}
            {bathLabel} bath
            {listing.leaseType ? ` | ${listing.leaseType}` : ""}
          </span>
          {listing.owner?.name && (
            <span className="text-gray-400 text-xs truncate ml-2">
              {listing.owner.name}
            </span>
          )}
        </div>
      </div>
      <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-red-600 transition-[width] duration-300 group-hover:w-full" />
      <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-md rounded-full p-2 shadow-xl border border-white/50">
        <HeartIcon
          session={session}
          listingId={listing._id}
          initial={
            Boolean(session?.user) &&
            Boolean(
              session?.user?.favorites?.some(
                (f) => String((f && f._id) || f) === String(listing._id)
              ) || session?.user?.favoritesIds?.includes(String(listing._id))
            )
          }
        />
      </div>
    </div>
  );
}

export default function MapPopupCard({
  listing,
  session,
  routeActive,
  onRouteToggle,
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
      {onRouteToggle && (
        <button
          onClick={onRouteToggle}
          className={`w-full mt-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors duration-200 shadow ${
            routeActive
              ? "bg-red-600 text-white hover:bg-red-700"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          {routeActive ? "Hide Route to Campus" : "📍 Show Route to Campus"}
        </button>
      )}
    </div>
  );
}
