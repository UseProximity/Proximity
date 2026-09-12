"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Plus, X, Star, MapPin, RefreshCw, ArrowUpRight } from "lucide-react";
import HeartIcon from "@/components/ui/HeartIcon";
import { displayName, shortAddress, selectableUnits, unitLabel, offerLabel, money } from "@/lib/compare/model";

const EASE = [0.22, 1, 0.36, 1];

/*
 * One side of the comparison. No box around it: the photo fades toward the
 * centre column so the two sides read as one composition with the facts
 * between them, and the text below gets the whole column width.
 *
 * `delay` staggers the landing: left first, then right, then the centre.
 */
export default function PropertyCard({ side, slot, basis, delay = 0, onPick, onRemove, onUnit, onLease }) {
  const enter = {
    initial: { opacity: 0, y: 28, scale: 0.965 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, scale: 0.985, transition: { duration: 0.16 } },
    transition: { duration: 0.7, ease: EASE, delay },
  };
  // Left photo fades on its right edge, right photo on its left edge.
  const fade =
    slot === 0
      ? "md:[mask-image:linear-gradient(to_right,black_62%,transparent_100%)]"
      : "md:[mask-image:linear-gradient(to_left,black_62%,transparent_100%)]";
  const number = slot === 0 ? "01" : "02";

  if (!side) {
    return (
      <motion.button
        type="button"
        onClick={onPick}
        {...enter}
        className="group flex h-full min-h-[300px] w-full flex-col items-center justify-center gap-4 rounded-3xl border-2 border-dashed border-gray-200 bg-gray-50/60 p-6 text-center transition-colors hover:border-red-300 hover:bg-red-50/40 md:min-h-[480px]"
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
    <motion.article {...enter} className="flex h-full flex-col" aria-label={displayName(listing)}>
      <div className={`relative aspect-[4/3] overflow-hidden rounded-3xl bg-gray-100 md:aspect-[16/11] ${fade}`}>
        {image ? (
          <motion.div
            className="absolute inset-0"
            initial={{ scale: 1.08 }}
            animate={{ scale: 1 }}
            transition={{ duration: 1.4, ease: EASE, delay }}
          >
            <Image
              src={image}
              alt={displayName(listing)}
              fill
              sizes="(max-width: 768px) 50vw, 40vw"
              className="object-cover"
              priority
            />
          </motion.div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-400">No photo yet</div>
        )}

        {/* Top row: number tag and Change on one side, save and remove on the other */}
        <div className={`absolute left-2.5 right-2.5 top-2.5 flex items-center justify-between gap-2 sm:left-3 sm:right-3 sm:top-3 ${slot === 1 ? "flex-row-reverse" : ""}`}>
          <div className={`flex items-center gap-1.5 ${slot === 1 ? "flex-row-reverse" : ""}`}>
            <span className="flex h-7 min-w-7 items-center justify-center rounded-md bg-red-600 px-1.5 text-[11px] font-bold tracking-wide text-white shadow-md">
              {number}
            </span>
            <button
              type="button"
              onClick={onPick}
              className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white/90 px-2.5 text-[11px] font-semibold text-gray-800 shadow-md backdrop-blur-md hover:bg-white"
            >
              <RefreshCw className="h-3 w-3" strokeWidth={2.4} />
              Change
            </button>
          </div>
          <div className={`flex items-center gap-1.5 ${slot === 1 ? "flex-row-reverse" : ""}`}>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 shadow-md backdrop-blur-md [&_button]:p-0 [&_svg]:h-4 [&_svg]:w-4">
              <HeartIcon listingId={listing._id} />
            </span>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${displayName(listing)} from the comparison`}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-gray-600 shadow-md backdrop-blur-md hover:text-gray-900"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>

      <div className={`flex flex-1 flex-col pt-4 sm:pt-5 ${slot === 1 ? "md:items-end md:text-right" : ""}`}>
        <h2 className="line-clamp-2 text-lg font-bold leading-tight tracking-tight text-gray-900 sm:text-[26px]">
          {displayName(listing)}
        </h2>
        <p className={`mt-1 flex items-center gap-1 text-xs text-gray-500 sm:text-sm ${slot === 1 ? "md:flex-row-reverse" : ""}`}>
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{shortAddress(listing)}</span>
        </p>

        <div className={`mt-4 flex items-end justify-between gap-2 ${slot === 1 ? "md:flex-row-reverse" : ""}`}>
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

        <div className="mt-4 w-full space-y-2">
          {units.length > 1 ? (
            <label className="block">
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
          ) : (
            unit && <p className="text-sm font-medium text-gray-700">{unitLabel(unit)}</p>
          )}
          {(unit?.leases?.length ?? 0) > 1 && (
            <label className="block">
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
        </div>

        <div className="mt-auto w-full pt-5">
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
