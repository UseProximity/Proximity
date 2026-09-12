/*
 * /compare — two properties side by side.
 *
 * The URL is the state: ?a=<listing>&b=<listing> pick the sides, au/al and
 * bu/bl pin a unit and offer on each, basis=unit shows whole-apartment rent,
 * and add=<listing> arrives from a Compare pill when both slots are already
 * taken and the student needs to choose which one to replace.
 *
 * Listings are fetched here with the same getListing() the listing page uses,
 * so every number on this page is the number a student would see on the
 * listing itself. No click metric is counted: a comparison is not a visit.
 */
import { Suspense } from "react";
import { getListing } from "@/lib/listings/getListing";
import { getCachedListings } from "@/lib/listings/queryListings";
import { getRentRangeLabel } from "@/utils/listingFormatters";
import { NON_CAMPUS_WALK_PLACES } from "@/utils/washuPlaces";
import { UUID_RE, displayName } from "@/lib/compare/model";
import CompareClient from "@/components/compare/CompareClient";

export const metadata = {
  title: "Compare Apartments Side by Side | Proximity",
  description:
    "Put two WashU apartments next to each other: rent, walk to campus, lease terms, amenities, utilities and student reviews in one list.",
  alternates: { canonical: "/compare" },
  // A tool page keyed by query string. The listings themselves are the pages
  // worth indexing.
  robots: { index: false, follow: true },
};

async function load(id) {
  if (!id || !UUID_RE.test(id)) return null;
  const listing = await getListing(id).catch(() => null);
  // A property that has been hidden or has nothing on offer is not a choice.
  if (!listing || listing.unavailable) return null;
  return listing;
}

function campusMinutes(listing) {
  const pwm = listing.placeWalkMinutes || {};
  const vals = Object.entries(pwm)
    .filter(([k]) => !NON_CAMPUS_WALK_PLACES.includes(k))
    .map(([, v]) => v)
    .filter(Number.isFinite);
  return vals.length ? Math.min(...vals) : null;
}

// Everything the picker needs to list a property, and nothing more.
function pickerIndex(listings) {
  return listings
    .filter((l) => !l.unavailable)
    .map((l) => ({
      id: l._id,
      name: displayName(l),
      address: l.address,
      image: l.images?.[0] ?? null,
      rent: getRentRangeLabel(l.unitTypes),
      walk: campusMinutes(l),
      rating: l.numReviews > 0 ? l.rating : null,
      reviews: l.numReviews ?? 0,
    }))
    .sort((a, b) => (a.walk ?? Infinity) - (b.walk ?? Infinity) || a.name.localeCompare(b.name));
}

export default async function ComparePage({ searchParams }) {
  const params = await searchParams;
  const aId = params.a ?? null;
  const bId = params.b ?? null;
  const addId = params.add ?? null;
  const distinct = (id, other) => (id && id !== other ? id : null);

  const [a, b, add, all] = await Promise.all([
    load(aId),
    load(distinct(bId, aId)),
    load(addId && addId !== aId && addId !== bId ? addId : null),
    getCachedListings(),
  ]);

  return (
    <Suspense fallback={null}>
      <CompareClient
        sides={[a, b]}
        addCandidate={add}
        picker={pickerIndex(all)}
        requested={{ a: aId, b: bId }}
        initial={{
          au: params.au ?? null,
          al: params.al ?? null,
          bu: params.bu ?? null,
          bl: params.bl ?? null,
          basis: params.basis === "unit" ? "unit" : "person",
        }}
      />
    </Suspense>
  );
}
