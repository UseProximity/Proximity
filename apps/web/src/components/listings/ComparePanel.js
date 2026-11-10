/*
 * Compare Listings panel of the /browse page: two listings side by side, picked
 * from the grid. It lays over the map area; AvailableListings owns the selection
 * and passes it in as slots ([left, right], each a listing or null).
 *
 * Every value that a listing can vary on (several units, several lease
 * offerings) is shown as the range across all of them, never a single pick.
 * Nothing is marked as better: the comparison is neutral.
 */
"use client";

import Image from "next/image";
import { ChevronLeft, X } from "lucide-react";
import HeartIcon from "@/components/ui/HeartIcon";
import { availabilityLabel } from "@/utils/availability";
import { durationLabel } from "@/components/listings/LeaseOptions";
import {
  getCampusWalkMinutes,
  getListingHeading,
  getRentRangeLabel,
} from "@/utils/listingFormatters";

// "min-max" of a list of numbers, or just the number when they are all equal.
const span = (values, fmt = String) =>
  Math.min(...values) === Math.max(...values)
    ? fmt(values[0])
    : `${fmt(Math.min(...values))}-${fmt(Math.max(...values))}`;

function compareRows(listing) {
  const units = listing.unitTypes ?? [];
  const leases = units.flatMap((u) => u.leases ?? []);

  const price = getRentRangeLabel(leases);

  const beds = units.map((u) => u.bedrooms).filter(Number.isFinite);
  const baths = units.map((u) => u.bathrooms).filter(Number.isFinite);
  const bedText = !beds.length
    ? "N/A"
    : Math.max(...beds) === 0
    ? "Studio"
    : `${span(beds, (n) => (n === 0 ? "Studio" : n))} ${Math.max(...beds) === 1 ? "bedroom" : "bedrooms"}`;
  const bathText = !baths.length
    ? "N/A"
    : `${span(baths)} ${Math.max(...baths) === 1 ? "bathroom" : "bathrooms"}`;

  const dates = leases.map((l) => l.availableFrom).filter(Boolean).sort();
  const from = dates.length ? availabilityLabel(dates[0]).text : null;
  const to = dates.length ? availabilityLabel(dates[dates.length - 1]).text : null;

  const furnished = new Set(leases.map((l) => l.furnished).filter((f) => f != null));

  const campus = getCampusWalkMinutes(listing);
  const shuttle = listing.shuttleWalkMinutes;
  const reviews = Number(listing.numReviews) || 0;

  return [
    [
      "Price:",
      <>
        <span className="font-bold">{price}</span>
        {price !== "Contact for Pricing" && "/mo"}
      </>,
    ],
    ["Rooms:", `${bedText}\n${bathText}`],
    ["Available on:", !from ? "N/A" : from === to ? from : `${from} to ${to}`],
    [
      "Duration:",
      durationLabel(leases.flatMap((l) => l.leaseTermMonths ?? [])) ?? "N/A",
    ],
    [
      "Furnished:",
      !furnished.size ? "N/A" : furnished.size > 1 ? "Both options" : furnished.has(true) ? "Furnished" : "Unfurnished",
    ],
    ["Distance to campus:", campus != null ? `${campus} min walk` : "N/A"],
    ["Distance to shuttle:", typeof shuttle === "number" ? `${shuttle} min walk` : "N/A"],
    [
      "Rating:",
      reviews > 0 && Number(listing.rating) > 0
        ? `${Number(listing.rating).toFixed(1)} (${reviews} review${reviews === 1 ? "" : "s"})`
        : "No reviews yet",
    ],
  ];
}

function Slot({ listing, emptyText, onRemove }) {
  if (!listing) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center rounded-[20px] border border-dashed border-gray-300 px-6 text-center text-sm text-gray-500">
        {emptyText}
      </div>
    );
  }
  const { title, subtitle } = getListingHeading(listing);
  const image = listing.images?.[0];
  return (
    <div className="min-w-0 flex-1 overflow-hidden rounded-[20px] border border-[#e6e7eb] bg-white">
      <div className="relative m-2 aspect-[363/164] overflow-hidden rounded-t-[15px] bg-gray-100">
        {image ? (
          <Image src={image} alt={listing.address} fill sizes="30vw" priority className="object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400">
            No image
          </div>
        )}
        <button
          onClick={onRemove}
          aria-label="Remove from comparison"
          className="absolute left-2 top-2 rounded-full border border-white/50 bg-white/90 p-1 text-gray-600 shadow-md transition-colors hover:text-gray-900"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        {/* The heart of the grid cards, same place and same behaviour. */}
        <div className="absolute right-2 top-2 rounded-full border border-white/50 bg-white/90 p-0.5 shadow-xl backdrop-blur-md">
          <HeartIcon listingId={listing._id} size="sm" />
        </div>
      </div>
      <div className="px-4 pb-4 pt-1">
        <h3 className="truncate text-base font-bold text-black">{title}</h3>
        <p className="truncate text-xs font-medium text-[#404040]">{subtitle}</p>
        {/* New tab, so the comparison (kept only in memory) is not lost. */}
        <a
          href={`/listings/${listing._id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          View listing
        </a>
      </div>
      {compareRows(listing).map(([label, value], i) => (
        <div key={label} className={`px-6 py-4 ${i % 2 === 0 ? "bg-[#fff9f9]" : ""}`}>
          <p className="text-xs text-black">{label}</p>
          <p className="mt-1 whitespace-pre-line text-base font-medium text-[#495564]">{value}</p>
        </div>
      ))}
    </div>
  );
}

export default function ComparePanel({ slots, onRemove, onClose }) {
  const anyPicked = slots.some(Boolean);
  const emptyText = anyPicked
    ? "Pick another listing from the grid to compare"
    : "Pick a listing from the grid to compare";
  return (
    <div className="flex h-full flex-col rounded-[20px] border border-[#e6e7eb] bg-[#f9fafb]">
      <div className="relative flex shrink-0 items-center justify-center py-4">
        <button
          onClick={onClose}
          aria-label="Close compare"
          className="absolute left-4 rounded-full p-1 text-gray-500 transition-colors hover:text-gray-900"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h2 className="text-xl font-bold text-black">Compare listings</h2>
      </div>
      {/* The scroller is this outer box. The inner row is at least as tall as it
          (so empty slots fill the panel) and grows past it with the rows. */}
      <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full gap-3.5 px-3.5 pb-3.5">
          {slots.map((listing, i) => (
            <Slot
              key={i}
              listing={listing}
              emptyText={emptyText}
              onRemove={() => onRemove(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
