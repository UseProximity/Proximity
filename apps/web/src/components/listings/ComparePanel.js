/*
 * Compare Listings panel of the /browse page: two listings side by side, picked
 * from the grid. It lays over the map area; AvailableListings owns the selection
 * and passes it in as slots ([left, right], each a listing or null).
 *
 * A listing with several units gets a selector, and its unit rows show the
 * selected unit only. Within that unit, a value that differs between its lease
 * offerings is shown as the range across them, never a single pick. Nothing is
 * marked as better: the comparison is neutral.
 */
"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronLeft, X } from "lucide-react";
import { buildUnitTabs } from "@proximity/shared";
import HeartIcon from "@/components/ui/HeartIcon";
import { availabilityLabel } from "@/utils/availability";
import { durationLabel } from "@/components/listings/LeaseOptions";
import {
  getCampusWalkMinutes,
  getListingHeading,
  getRentRangeLabel,
} from "@/utils/listingFormatters";

// The listing's units in the order of the listing page (the landlord's order,
// then beds, then baths), each with its label.
function unitTabs(listing) {
  const units = listing.unitTypes ?? [];
  const tabs = buildUnitTabs(units);
  // A listing with no available unit (greyed out in the grid) still shows its units.
  return tabs.length ? tabs : buildUnitTabs(units.map((u) => ({ ...u, available: true })));
}

// The unit rows are the selected unit's; the building rows are the listing's.
function compareRows(listing, unit) {
  const leases = unit?.leases ?? [];

  const price = getRentRangeLabel(leases);

  const bedText =
    unit?.bedrooms == null
      ? "N/A"
      : unit.bedrooms === 0
      ? "Studio"
      : `${unit.bedrooms} ${unit.bedrooms === 1 ? "bedroom" : "bedrooms"}`;
  const bathText =
    unit?.bathrooms == null
      ? "N/A"
      : `${unit.bathrooms} ${unit.bathrooms === 1 ? "bathroom" : "bathrooms"}`;

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

// `tabs` are the listing's units; `reserve` is set when either listing has several,
// so both cards keep the selector's height and their rows line up.
function Slot({ listing, tabs, reserve, emptyText, onRemove }) {
  // Which unit this card shows. The slot is keyed by listing, so a removed or
  // replaced listing starts again on its first unit.
  const [picked, setPicked] = useState(0);
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
      {reserve && (
        <div className="h-14 px-4 pt-1">
          {tabs.length > 1 && (
            <>
              <p className="text-xs text-black">{tabs.length} units</p>
              <div className="scrollbar-hidden mt-1 flex gap-1.5 overflow-x-auto">
                {tabs.map((tab, i) => (
                  <button
                    key={tab.unit.id ?? i}
                    onClick={() => setPicked(i)}
                    aria-pressed={i === picked}
                    className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      i === picked
                        ? "bg-gray-200 text-gray-700 border-gray-300"
                        : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {compareRows(listing, tabs[picked]?.unit).map(([label, value], i) => (
        <div key={label} className={`px-6 py-4 ${i % 2 === 0 ? "bg-[#fff9f9]" : ""}`}>
          <p className="text-xs text-black">{label}</p>
          <p className="mt-1 whitespace-pre-line text-base font-medium text-[#495564]">{value}</p>
        </div>
      ))}
    </div>
  );
}

export default function ComparePanel({ slots, onRemove, onClose }) {
  const tabs = slots.map((l) => l && unitTabs(l));
  const reserve = tabs.some((t) => t?.length > 1);
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
              key={`${i}-${listing?._id}`}
              listing={listing}
              tabs={tabs[i]}
              reserve={reserve}
              emptyText={emptyText}
              onRemove={() => onRemove(i)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
