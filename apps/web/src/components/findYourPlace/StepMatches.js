"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import MatchCard, { MatchCardSkeleton } from "./MatchCard";
import { DEFAULT_FILTERS, filterListings } from "@/lib/listings/filterListings";
import { BROWSE_HANDOFF_KEY } from "@/lib/findYourPlace/options";

/*
 * The four matches as a 2x2 grid that follows the window (Wyatt, 2026-11-10):
 * the grid takes all the height the panel has left and splits it into two
 * rows, and each card stretches to its cell. So the whole set is on screen
 * without scrolling, larger on a big window and tighter on a small one. On a
 * phone the cards stack and the panel's body scrolls.
 */
const GRID = "grid min-h-0 flex-1 grid-cols-1 gap-3 sm:grid-cols-2 sm:grid-rows-2";
// The panel is wider on this step so each cell has room for photo and text.
export const MATCH_PANEL = "max-w-[1100px]";

const LINK = "inline-flex h-8 flex-shrink-0 items-center rounded-full border border-red-300 bg-white px-3.5 text-xs font-medium text-red-600 hover:bg-red-50";

/*
 * "Browse All N Matches". Opens browse in a new tab with the answers pre-set in
 * its filter bar (lib/findYourPlace/browseHandoff.js). N is worked out here
 * with browse's own filter function over browse's own listing feed, so the
 * number on the button is the number of cards the student lands on.
 */
function BrowseMatchesLink({ browse }) {
  const [count, setCount] = useState(null);

  useEffect(() => {
    if (!browse?.filters) return;
    let cancelled = false;
    fetch("/api/listings")
      .then((res) => (res.ok ? res.json() : null))
      .then((listings) => {
        if (cancelled || !Array.isArray(listings)) return;
        const passing = filterListings(listings, {
          filters: { ...DEFAULT_FILTERS, ...browse.filters },
          search: "",
          savedIds: [],
          campusMinutes: () => null, // only read by the walk filter, which is never pre-set
        });
        setCount(passing.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [browse]);

  if (!browse?.filters || count === 0) {
    return (
      <Link href="/browse" target="_blank" rel="noopener noreferrer" className={LINK}>
        Browse All Listings
      </Link>
    );
  }
  return (
    <Link
      href="/browse?fyp=1"
      target="_blank"
      rel="noopener noreferrer"
      className={LINK}
      onClick={() => {
        try {
          window.localStorage.setItem(BROWSE_HANDOFF_KEY, JSON.stringify(browse));
        } catch {
          // Without storage browse opens unfiltered, which is still a working page.
        }
      }}
    >
      {count == null ? "Browse All Matches" : `Browse All ${count} Matches`}
    </Link>
  );
}

// Page 3: the top matches, or an honest empty state.
export default function StepMatches({ loading, error, matches, browse, signedIn, onOpen, onContact, onLocked, onRetry }) {
  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <h2 className="text-[15px] font-semibold text-gray-900">Finding your top matches...</h2>
        <p className="mb-3 mt-1 text-xs text-gray-500">Checking every live listing against what you told us.</p>
        <div className={GRID}>
          {[0, 1, 2, 3].map((i) => (
            <MatchCardSkeleton key={i} />
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
        <Link href="/browse" className={`mt-5 ${LINK}`}>
          Browse All Listings
        </Link>
      </div>
    );
  }

  const nearOnly = matches.every((m) => m.near_miss);
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-gray-900">Your Top Matches</h2>
          {nearOnly && (
            <p className="mt-0.5 text-xs text-gray-500">
              Nothing fits every answer right now, so these are the closest. Each one says what it misses.
            </p>
          )}
        </div>
        <BrowseMatchesLink browse={browse} />
      </div>
      <div className={GRID}>
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
    </div>
  );
}
