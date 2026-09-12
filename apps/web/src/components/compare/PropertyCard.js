"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Star, MapPin, RefreshCw, MessageCircle } from "lucide-react";
import HeartIcon from "@/components/ui/HeartIcon";
import { displayName, shortAddress, selectableUnits, unitLabel, offerLabel, money } from "@/lib/compare/model";
import PickerList from "./PickerList";

/*
 * One side of the comparison. Empty: the list of every property, right in the
 * column, so both sides offer the same panel to pick from (a sheet on phones).
 * Filled: a plain bordered card with the photo, price, unit choice and actions.
 */
export default function PropertyCard({ side, slot, basis, campus, picker, otherId, delay = 0, onPick, onChoose, onUnit, onLease }) {
  const enter = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, transition: { duration: 0.12 } },
    transition: { duration: 0.35, ease: "easeOut", delay },
  };

  if (!side) {
    return (
      <motion.div {...enter} className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <p className="text-sm font-semibold text-gray-900">{slot === 0 ? "First apartment" : "Second apartment"}</p>
          <p className="text-xs text-gray-500">Pick one from the list.</p>
        </div>
        {/* Wide screens: the list lives here. Phones: a button that opens it as a sheet. */}
        <PickerList
          items={picker}
          campus={campus}
          otherId={otherId}
          onChoose={onChoose}
          className="hidden h-[560px] md:flex"
        />
        <button
          type="button"
          onClick={onPick}
          className="m-4 flex min-h-11 items-center justify-center rounded-lg bg-red-600 text-sm font-semibold text-white md:hidden"
        >
          Choose an apartment
        </button>
      </motion.div>
    );
  }

  const { listing, unit, lease, rentBasis } = side;
  const units = selectableUnits(listing);
  const image = listing.images?.[0] ?? null;
  const rent = rentBasis ? (basis === "unit" ? rentBasis.unitRent : rentBasis.perPerson) : null;
  const hasRating = listing.numReviews > 0 && listing.rating > 0;

  return (
    <motion.article {...enter} className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white" aria-label={displayName(listing)}>
      <div className="relative aspect-video bg-gray-100">
        {image ? (
          <Image src={image} alt={displayName(listing)} fill sizes="(max-width: 768px) 50vw, 40vw" className="object-cover" priority />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">No photo yet</div>
        )}
        <button
          type="button"
          onClick={onPick}
          className="absolute left-2.5 top-2.5 inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2.4} />
          Change
        </button>
        <span className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white shadow-sm [&_button]:p-0 [&_svg]:h-[18px] [&_svg]:w-[18px]">
          <HeartIcon listingId={listing._id} />
        </span>
      </div>

      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <h2 className="line-clamp-2 text-base font-bold leading-tight text-gray-900 sm:text-lg">{displayName(listing)}</h2>
        <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{shortAddress(listing)}</span>
        </p>

        <div className="mt-3 flex items-end justify-between gap-2">
          <p className="leading-none">
            {rent != null ? (
              <>
                <span className="text-2xl font-bold text-gray-900">{money(rent)}</span>
                <span className="ml-1 text-xs text-gray-500">/ {basis === "unit" ? "apt" : "person"} / mo</span>
              </>
            ) : (
              <span className="text-base font-semibold text-gray-500">Contact for price</span>
            )}
          </p>
          {hasRating && (
            <span className="flex items-center gap-1 text-xs font-semibold text-gray-700">
              <Star className="h-3.5 w-3.5 fill-red-500 text-red-500" />
              {listing.rating.toFixed(1)}
              <span className="font-normal text-gray-400">({listing.numReviews})</span>
            </span>
          )}
        </div>
        {rentBasis && lease?.rentIsPerPerson == null && rentBasis.beds > 1 && (
          <p className="mt-1 text-[11px] text-gray-400">Per-person figure estimated from the listing.</p>
        )}

        <div className="mt-3 w-full space-y-2">
          {units.length > 1 ? (
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">Unit</span>
              <select
                value={unit?.id ?? ""}
                onChange={(e) => onUnit(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-red-400"
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {unitLabel(u)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            unit && <p className="text-sm text-gray-700">{unitLabel(unit)}</p>
          )}
          {(unit?.leases?.length ?? 0) > 1 && (
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-gray-400">Offer</span>
              <select
                value={lease?.id ?? ""}
                onChange={(e) => onLease(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-red-400"
              >
                {unit.leases.map((l) => (
                  <option key={l.id} value={l.id}>
                    {offerLabel(l)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="mt-auto grid w-full grid-cols-1 gap-2 pt-4 sm:grid-cols-2">
          <Link
            href={`/listings/${listing._id}?tab=contact`}
            className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-red-600 text-sm font-semibold text-white hover:bg-red-700"
          >
            <MessageCircle className="h-4 w-4" />
            Contact
          </Link>
          <Link
            href={`/listings/${listing._id}`}
            className="flex min-h-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-800 hover:bg-gray-50"
          >
            View listing
          </Link>
        </div>
      </div>
    </motion.article>
  );
}
