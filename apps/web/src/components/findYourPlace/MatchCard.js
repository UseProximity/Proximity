"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Star } from "lucide-react";
import HeartIcon from "@/components/ui/HeartIcon";
import { getRentRangeLabel } from "@/utils/listingFormatters";
import { NON_CAMPUS_WALK_PLACES } from "@/utils/washuPlaces";

const range = (values) => {
  const nums = values.filter(Number.isFinite);
  if (!nums.length) return null;
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return lo === hi ? String(lo) : `${lo}-${hi}`;
};

// Shortest walk to a main-campus building, as the browse card works it out.
function campusWalk(listing) {
  const pwm = listing.placeWalkMinutes;
  if (typeof pwm === "number") return pwm;
  if (!pwm || typeof pwm !== "object") return null;
  const vals = Object.entries(pwm)
    .filter(([k]) => !NON_CAMPUS_WALK_PLACES.includes(k))
    .map(([, v]) => v)
    .filter(Number.isFinite);
  return vals.length ? Math.min(...vals) : null;
}

export function MatchCardSkeleton() {
  return (
    <div className="flex h-full min-h-[150px] flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg sm:flex-row">
      <div className="aspect-video animate-pulse bg-gray-200 sm:aspect-auto sm:h-full sm:w-[42%]" />
      <div className="flex-1 space-y-2 p-3">
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-gray-200" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-gray-100" />
      </div>
    </div>
  );
}

/*
 * One match: photo on the left, the listing's facts and why it matched on the
 * right. It is its own card rather than the browse ListingCard because it has
 * to stretch to whatever cell the 2x2 grid gives it (the browse card's height
 * is fixed by its photo), and because the reason belongs inside it.
 */
export default function MatchCard({ match, position, signedIn, onOpen, onContact, onLocked }) {
  const [listing, setListing] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/listing/${match.listing_id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data) setListing(data);
        else setFailed(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [match.listing_id]);

  if (failed) return null;
  if (!listing) return <MatchCardSkeleton />;

  const street = (listing.address ?? "").split(",")[0].trim();
  const title = listing.title || street;
  const units = listing.unitTypes ?? [];
  const beds = range(units.map((u) => u.bedrooms));
  const baths = range(units.map((u) => u.bathrooms));
  const rent = getRentRangeLabel(units);
  const numReviews = Number(listing.numReviews) || 0;
  const rating = Number(listing.rating);
  const walk = campusWalk(listing);
  const shuttle = typeof listing.shuttleWalkMinutes === "number" ? listing.shuttleWalkMinutes : null;
  const image = listing.images?.[0];

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={title}
      onClick={() => onOpen(match, position)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(match, position)}
      // Signed out: the matches are shown, but opening, saving or contacting
      // one asks for an account first (Wyatt, 2026-11-10).
      onClickCapture={
        signedIn
          ? undefined
          : (e) => {
              e.preventDefault();
              e.stopPropagation();
              onLocked(match, position);
            }
      }
      className="group flex h-full min-h-[150px] cursor-pointer flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg transition-colors hover:border-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300 sm:flex-row"
    >
      <div className="relative aspect-video flex-shrink-0 bg-gray-100 sm:aspect-auto sm:h-full sm:w-[42%]">
        {image ? (
          <Image src={image} alt={listing.address ?? title} fill sizes="(max-width: 640px) 100vw, 320px" className="object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">No image</div>
        )}
        <div className="absolute right-2 top-2 rounded-full border border-white/50 bg-white/90 p-0.5 shadow">
          <HeartIcon listingId={listing._id} size="sm" />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate text-sm font-bold text-gray-900">{title}</h3>
          <span className="flex-shrink-0 whitespace-nowrap text-sm font-bold text-[#3C4142]">
            {rent}
            {rent !== "Contact for Pricing" && <span className="text-xs font-normal">/mo</span>}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-gray-500">
          <span className="truncate">
            {beds ?? "N/A"} bed | {baths ?? "N/A"} bath
            {walk != null ? ` | ${walk} min walk` : ""}
            {shuttle != null ? ` | ${shuttle} min to shuttle` : ""}
          </span>
          {numReviews > 0 && Number.isFinite(rating) && rating > 0 && (
            <span className="flex flex-shrink-0 items-center gap-0.5" title={`${rating.toFixed(1)} out of 5 from ${numReviews} review${numReviews === 1 ? "" : "s"}`}>
              <Star className="h-3 w-3 fill-red-400 text-red-400" />
              <span className="font-semibold tabular-nums text-gray-700">{rating.toFixed(1)}</span>
              <span className="tabular-nums text-gray-400">({numReviews})</span>
            </span>
          )}
        </div>

        <p className="mt-2 line-clamp-3 text-xs leading-snug text-gray-700">{match.reason}</p>
        {match.note && <p className="mt-1 line-clamp-2 text-xs leading-snug text-red-600">{match.note}</p>}

        <div className="mt-auto pt-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onContact(match, position);
            }}
            className="h-7 rounded-full border border-red-300 bg-white px-3.5 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            Contact
          </button>
        </div>
      </div>
    </div>
  );
}
