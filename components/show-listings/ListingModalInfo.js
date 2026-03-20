"use client";

import { useState } from "react";
import Link from "next/link";
import ReviewsSection from "@/components/ReviewsSection";
import {
  getAreaRangeLabel,
  getRentRangeLabel,
  getUnitValuesLabel,
} from "@/utils/listingFormatters";

// Static Data
const leaseTypeMap = {
  sublease: "Sub-Lease",
  nine: "9 Month Lease",
  twelve: "12 Month Lease",
  academic: "Academic Year",
};

export default function ListingModalInfo({ HeartIcon, session, listing }) {
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const images = Array.isArray(listing?.images)
    ? listing.images.filter(Boolean)
    : [];
  const coverImage = images[0];
  const hasGallery = images.length > 1;

  return (
    <>
      <div className="bg-gray-100 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 py-8">
          {/* Image + Gallery */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div
              className={`relative md:col-span-2 ${
                hasGallery ? "cursor-pointer" : ""
              }`}
              onClick={() => {
                if (hasGallery) {
                  setIsGalleryOpen(true);
                }
              }}
              role={hasGallery ? "button" : undefined}
              tabIndex={hasGallery ? 0 : undefined}
              onKeyDown={(e) => {
                if (!hasGallery) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setIsGalleryOpen(true);
                }
              }}
            >
              {coverImage ? (
                <img
                  src={coverImage}
                  alt={listing.address}
                  className="rounded-xl w-full h-[400px] object-cover shadow"
                />
              ) : (
                <div className="rounded-xl w-full h-[400px] bg-gray-200 shadow flex items-center justify-center text-gray-500">
                  No images available
                </div>
              )}
              <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-red-600 transition-[width] duration-300 group-hover:w-full" />
              {hasGallery && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsGalleryOpen(true);
                  }}
                  className="absolute bottom-3 right-3 bg-white/90 backdrop-blur-md rounded-full px-3 py-1.5 text-xs font-semibold text-gray-800 shadow-lg border border-white/60"
                >
                  See all {images.length} photos
                </button>
              )}
              <div
                className="absolute top-3 right-3 bg-white/90 backdrop-blur-md rounded-full p-2 shadow-xl border border-white/50"
                onClick={(e) => e.stopPropagation()}
              >
                <HeartIcon
                  session={session}
                  listingId={listing._id}
                  initial={
                    Boolean(session?.user) &&
                    Boolean(
                      session?.user?.favorites?.some(
                        (f) => String((f && f._id) || f) === String(listing._id)
                      ) ||
                        session?.user?.favoritesIds?.includes(
                          String(listing._id)
                        )
                    )
                  }
                />
              </div>
            </div>
            <div className="flex flex-col justify-center gap-3 bg-white p-6 rounded-xl shadow-md">
              <div className="flex justify-between items-center">
                <div className="text-3xl font-bold text-gray-900">
                  {getRentRangeLabel(listing.unitTypes)}
                </div>
              </div>
              <div className="text-gray-700">{listing.address}</div>
              <div className="text-sm text-gray-500">
                Listed by <strong>{listing.owner.name}</strong>
              </div>

              {/*Landlord profile and Rating Thing */}
              <Link href={`/landlord/${encodeURIComponent(listing.owner._id)}`}>
                <div className="flex items-center gap-2 mt-1">
                  <img
                    src={listing.owner.image}
                    alt={listing.owner.name}
                    className="w-8 h-8 rounded-full object-cover"
                  />
                  <div>
                    {listing.owner.numReviews === 0 ? (
                      <p className="text-gray-500 text-sm italic">
                        No ratings yet
                      </p>
                    ) : (
                      <div className="text-yellow-500 text-lg">
                        {"★".repeat(listing.owner.rating)}
                        <span className="text-gray-300">
                          {"★".repeat(5 - listing.owner.rating)}
                        </span>
                      </div>
                    )}
                    <p className="text-xs text-gray-500">Landlord Rating</p>
                  </div>
                </div>
              </Link>

              {/*<ConditionalButtons listing={listing} />*/}
            </div>
          </div>

          {/* Specs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-2xl font-semibold">
                {getUnitValuesLabel(listing.unitTypes, "bedrooms")}
              </div>
              <div className="text-sm text-gray-500">Beds</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-2xl font-semibold">
                {getUnitValuesLabel(listing.unitTypes, "bathrooms")}
              </div>
              <div className="text-sm text-gray-500">Baths</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-2xl font-semibold">
                {getAreaRangeLabel(listing.unitTypes)}
              </div>
              <div className="text-sm text-gray-500">Sq Ft</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow text-center">
              <div className="text-lg font-semibold">
                {leaseTypeMap[listing.leaseType] || listing.leaseType}
              </div>
              <div className="text-sm text-gray-500">Lease Type</div>
            </div>
          </div>

          {/* Description */}
          <div className="bg-white p-6 rounded-lg shadow-md mb-8">
            <h2 className="text-xl font-semibold mb-4">Property Overview</h2>
            <p className="text-gray-700 leading-relaxed">
              {listing.description}
            </p>
          </div>

          <ReviewsSection
            reviews={listing.reviews}
            session={session}
            reviewedId={listing._id}
          />
        </div>
      </div>
      {isGalleryOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm overflow-y-auto"
          onClick={() => setIsGalleryOpen(false)}
        >
          <div
            className="max-w-6xl mx-auto px-6 py-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6 text-white">
              <div className="text-lg font-semibold">
                Photos ({images.length})
              </div>
              <button
                type="button"
                onClick={() => setIsGalleryOpen(false)}
                className="text-white/80 hover:text-white text-2xl"
                aria-label="Close photo gallery"
              >
                ×
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {images.map((src, index) => (
                <img
                  key={`${src}-${index}`}
                  src={src}
                  alt={`Listing photo ${index + 1}`}
                  className="w-full h-64 object-cover rounded-lg shadow"
                  loading="lazy"
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
