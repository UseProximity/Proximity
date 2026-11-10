"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ListingCard } from "@/components/listings/MapPopupCard";
import { formatAvailableFrom } from "@/utils/listingFormatters";

function CardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg">
      <div className="aspect-video animate-pulse bg-gray-200" />
      <div className="space-y-2 p-3">
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-gray-200" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
      </div>
    </div>
  );
}

function MatchCard({ match, position, signedIn, onOpen, onContact, onLocked }) {
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

  // The card's own badges (Live, "Available Aug 1") sit top-left; the contact
  // pill drops below them when they are there.
  const hasBadge = !!listing && !listing.unavailable && (listing.verifiedLive || formatAvailableFrom(listing.availableFrom));

  return (
    <div className="min-w-0">
      {listing ? (
        <div
          className="relative"
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
        >
          <ListingCard listing={listing} onCardClick={() => onOpen(match, position)} />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onContact(match, position);
            }}
            className={`absolute left-3 z-[2] h-7 rounded-full bg-white/95 px-3 text-xs font-medium text-gray-700 shadow-sm hover:bg-white hover:text-red-600 ${
              hasBadge ? (listing.verifiedLive && formatAvailableFrom(listing.availableFrom) ? "top-[4.75rem]" : "top-11") : "top-3"
            }`}
          >
            Contact Owner
          </button>
        </div>
      ) : (
        <CardSkeleton />
      )}
      <p className="mt-2.5 px-1 text-sm leading-snug text-gray-700">{match.reason}</p>
      {match.note && <p className="mt-1 px-1 text-sm leading-snug text-gray-500">{match.note}</p>}
    </div>
  );
}

// Page 3: the top matches, or an honest empty state.
export default function StepMatches({ loading, error, matches, totalMatches, signedIn, onOpen, onContact, onLocked, onRetry }) {
  if (loading) {
    return (
      <div>
        <h2 className="text-[15px] font-semibold text-gray-900">Finding your top matches...</h2>
        <p className="mt-1 text-sm text-gray-500">Checking every live listing against what you told us.</p>
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <h2 className="text-[15px] font-semibold text-gray-900">{error.title}</h2>
        <p className="mt-1 text-sm text-gray-500">{error.body}</p>
        {error.retry && (
          <button type="button" onClick={onRetry} className="mt-5 h-9 rounded-full bg-red-600 px-5 text-sm font-medium text-white hover:bg-red-700">
            Try again
          </button>
        )}
        {error.signIn && (
          <Link
            href="/login?callbackUrl=/find-your-place"
            className="mt-5 inline-flex h-9 items-center rounded-full bg-red-600 px-5 text-sm font-medium text-white hover:bg-red-700"
          >
            Sign in to keep going
          </Link>
        )}
      </div>
    );
  }

  if (!matches.length) {
    return (
      <div>
        <h2 className="text-[15px] font-semibold text-gray-900">Nothing fits all of that right now</h2>
        <p className="mt-1 text-sm text-gray-500">
          No live listing matches every answer, even allowing for one near miss. Go back and loosen one of them (rent, lease
          length or move-in date usually open things up), or browse everything.
        </p>
        <Link
          href="/browse"
          className="mt-5 inline-flex h-9 items-center rounded-full border border-red-300 bg-white px-4 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          Browse All Listings
        </Link>
      </div>
    );
  }

  const nearOnly = matches.every((m) => m.near_miss);
  return (
    <div>
      <h2 className="text-[15px] font-semibold text-gray-900">Your Top Matches</h2>
      {nearOnly && (
        <p className="mt-1 text-sm text-gray-500">
          Nothing fits every answer right now, so these are the closest. Each one says what it misses.
        </p>
      )}
      <div className="mt-6 grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2">
        {matches.map((m, i) => (
          <MatchCard
            key={m.listing_id}
            match={m}
            position={i + 1}
            signedIn={signedIn}
            onOpen={onOpen}
            onContact={onContact}
            onLocked={onLocked}
          />
        ))}
      </div>
      <div className="mt-7 flex flex-wrap gap-2">
        <Link
          href="/browse"
          className="inline-flex h-9 items-center rounded-full border border-red-300 bg-white px-4 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          {totalMatches > matches.length ? `Browse All ${totalMatches} Matches` : "Browse All Listings"}
        </Link>
      </div>
    </div>
  );
}
