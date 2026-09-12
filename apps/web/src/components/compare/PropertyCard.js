"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Plus, X, Star, MapPin, ChevronDown, ArrowUpRight } from "lucide-react";
import HeartIcon from "@/components/ui/HeartIcon";
import { displayName, shortAddress, selectableUnits, unitLabel, offerLabel, money } from "@/lib/compare/model";

const enter = {
  initial: { opacity: 0, y: 14, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, transition: { duration: 0.14 } },
  transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
};

export default function PropertyCard({ side, slot, basis, onPick, onRemove, onUnit, onLease }) {
  if (!side) {
    return (
      <motion.button
        type="button"
        onClick={onPick}
        {...enter}
        className="group flex h-full min-h-[320px] w-full flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/60 p-6 text-center transition-colors hover:border-red-300 hover:bg-red-50/40 md:min-h-[520px]"
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-gray-200 transition-transform group-hover:scale-105">
          <Plus className="h-6 w-6 text-gray-700" />
        </span>
        <span className="text-base font-semibold text-gray-900">Add an apartment</span>
        <span className="text-sm text-gray-500">{slot === 0 ? "Pick your first option." : "Pick something to weigh it against."}</span>
      </motion.button>
    );
  }

  const { listing, unit, lease, rentBasis } = side;
  const units = selectableUnits(listing);
  const image = listing.images?.[0] ?? null;
  const rent = rentBasis ? (basis === "unit" ? rentBasis.unitRent : rentBasis.perPerson) : null;
  const hasRating = listing.numReviews > 0 && listing.rating > 0;

  return (
    <motion.article
      {...enter}
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-lg"
      aria-label={displayName(listing)}
    >
      <div className="relative aspect-[4/3] bg-gray-100">
        {image ? (
          <Image
            src={image}
            alt={displayName(listing)}
            fill
            sizes="(max-width: 768px) 50vw, 40vw"
            className="object-cover"
            priority={slot === 0}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">No photo yet</div>
        )}
        <div className="absolute right-2 top-2 flex items-center gap-1.5 sm:right-3 sm:top-3">
          <span className="rounded-full bg-white/90 shadow-md backdrop-blur-md">
            <HeartIcon listingId={listing._id} />
          </span>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${displayName(listing)} from the comparison`}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-gray-600 shadow-md backdrop-blur-md hover:text-gray-900"
          >
            <X className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
            Option {slot + 1}
          </span>
          <button
            type="button"
            onClick={onPick}
            className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900"
          >
            Change
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <h2 className="mt-1 line-clamp-2 text-lg font-bold leading-tight tracking-tight text-gray-900 sm:text-2xl">
          {displayName(listing)}
        </h2>
        <p className="mt-1 flex items-center gap-1 text-xs text-gray-500 sm:text-sm">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{shortAddress(listing)}</span>
        </p>

        <div className="mt-4 flex items-end justify-between gap-2">
          <p className="leading-none">
            {rent != null ? (
              <>
                <span className="text-2xl font-bold tracking-tight text-gray-900 sm:text-[34px]">{money(rent)}</span>
                <span className="ml-1 text-xs text-gray-500 sm:text-sm">/ {basis === "unit" ? "apt" : "person"} / mo</span>
              </>
            ) : (
              <span className="text-lg font-semibold text-gray-500 sm:text-xl">Contact for price</span>
            )}
          </p>
          {hasRating && (
            <span className="flex items-center gap-1 text-xs font-semibold text-gray-700 sm:text-sm">
              <Star className="h-3.5 w-3.5 fill-red-500 text-red-500" />
              {listing.rating.toFixed(1)}
              <span className="font-normal text-gray-400">({listing.numReviews})</span>
            </span>
          )}
        </div>
        {rentBasis && lease?.rentIsPerPerson == null && rentBasis.beds > 1 && (
          <p className="mt-1 text-[11px] text-gray-400">Basis estimated from the listing.</p>
        )}

        {units.length > 1 && (
          <label className="mt-4 block">
            <span className="sr-only">Unit</span>
            <select
              value={unit?.id ?? ""}
              onChange={(e) => onUnit(e.target.value)}
              className="w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-medium text-gray-900 outline-none focus:border-red-400 focus:bg-white"
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {unitLabel(u)}
                </option>
              ))}
            </select>
          </label>
        )}
        {units.length <= 1 && unit && (
          <p className="mt-4 text-sm font-medium text-gray-700">{unitLabel(unit)}</p>
        )}
        {(unit?.leases?.length ?? 0) > 1 && (
          <label className="mt-2 block">
            <span className="sr-only">Offer</span>
            <select
              value={lease?.id ?? ""}
              onChange={(e) => onLease(e.target.value)}
              className="w-full appearance-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-red-400 focus:bg-white"
            >
              {unit.leases.map((l) => (
                <option key={l.id} value={l.id}>
                  {offerLabel(l)}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-auto pt-4">
          <Link
            href={`/listings/${listing._id}`}
            className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full bg-red-600 text-sm font-semibold text-white transition-colors hover:bg-red-700"
          >
            View listing
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </motion.article>
  );
}
