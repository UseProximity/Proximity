"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { Star } from "lucide-react";
import HeartIcon from "@/components/ui/HeartIcon";
import { WalkScale } from "@/components/listings/MapPopupCard";
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

/*
 * The explanation has to fit the card without scrolling (Wyatt, 2026-11-11),
 * and the card's height follows the window. So the text steps down through
 * these sizes until it fits the room it has. Only if the smallest still
 * overflows (a very short window) does the box scroll.
 */
const FIT_STEPS = [
  { reason: "text-xs leading-relaxed", note: "text-xs leading-snug" },
  { reason: "text-xs leading-snug", note: "text-xs leading-snug" },
  { reason: "text-[11px] leading-snug", note: "text-[11px] leading-snug" },
  { reason: "text-[11px] leading-tight", note: "text-[11px] leading-tight" },
  { reason: "text-[10px] leading-tight", note: "text-[10px] leading-tight" },
];

function FittedReason({ reason, note }) {
  const boxRef = useRef(null);
  const [step, setStep] = useState(0);
  const [resized, setResized] = useState(0);

  // Start again from the largest size whenever the room or the words change.
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      setStep(0);
      setResized((n) => n + 1);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setStep(0), [reason, note]);

  // Before paint: one size down for as long as the words overflow the box.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (box && step < FIT_STEPS.length - 1 && box.scrollHeight > box.clientHeight + 1) setStep(step + 1);
  }, [step, resized, reason, note]);

  const size = FIT_STEPS[step];
  return (
    <div ref={boxRef} className="scrollbar-hidden mt-2.5 min-h-0 flex-1 overflow-y-auto">
      <p className={`${size.reason} text-gray-700`}>{reason}</p>
      {note && <p className={`mt-1 ${size.note} text-red-600`}>{note}</p>}
    </div>
  );
}

export function MatchCardSkeleton() {
  return (
    <div className="flex h-full min-h-[150px] flex-col overflow-hidden rounded-xl border border-gray-100 bg-white shadow-lg sm:flex-row">
      <div className="aspect-video animate-pulse bg-gray-200 sm:aspect-auto sm:h-full sm:w-[36%]" />
      <div className="flex-1 space-y-2 p-3">
        <div className="h-3.5 w-2/3 animate-pulse rounded bg-gray-200" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
        <div className="h-3 w-5/6 animate-pulse rounded bg-gray-100" />
      </div>
    </div>
  );
}

// Staggered start for the reveal, one step per card (top left first).
const REVEAL_DELAY = ["delay-0", "delay-75", "delay-150", "delay-200"];

/*
 * The cell: the card, with its skeleton laid over it until the grid reveals
 * all four together (StepMatches). The card is drawn underneath from the start
 * so its photo can load and its explanation can size itself; on reveal the
 * skeleton fades out as the card fades and lifts in. `onReady` reports when
 * the card has its data and photo, or has failed.
 */
export default function MatchCard({ revealed = true, onReady, ...props }) {
  const { match, position } = props;
  const [listing, setListing] = useState(null);
  const [failed, setFailed] = useState(false);
  const [photoDone, setPhotoDone] = useState(false);

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

  const ready = failed || (!!listing && (photoDone || !listing.images?.[0]));
  useEffect(() => {
    if (ready) onReady?.(match.listing_id);
  }, [ready, onReady, match.listing_id]);

  if (failed) return null;
  const delay = REVEAL_DELAY[(position - 1) % REVEAL_DELAY.length];
  const fade = "transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none";
  return (
    <div className="relative h-full min-h-[150px]">
      {listing && (
        <div className={`h-full ${fade} ${delay} ${revealed ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-1.5 opacity-0"}`}>
          <MatchCardBody {...props} listing={listing} onPhotoDone={() => setPhotoDone(true)} />
        </div>
      )}
      <div
        aria-hidden={revealed}
        className={`absolute inset-0 ${fade} ${delay} ${revealed ? "pointer-events-none opacity-0" : "opacity-100"}`}
      >
        <MatchCardSkeleton />
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
function MatchCardBody({ match, position, signedIn, onOpen, onContact, onLocked, listing, onPhotoDone }) {

  const street = (listing.address ?? "").split(",")[0].trim();
  const title = listing.title || street;
  // Under a named building the full address; under a street-address title, the rest of it.
  const cityStateZip =
    listing.title && listing.title !== street ? listing.address : (listing.address ?? "").replace(/^[^,]+,\s*/, "");
  const units = listing.unitTypes ?? [];
  const beds = range(units.map((u) => u.bedrooms));
  const baths = range(units.map((u) => u.bathrooms));
  // The matched lease's price when the search sent one (null = not published);
  // the listing's range only for matches saved before it did.
  const rent =
    match.price === undefined
      ? getRentRangeLabel(units)
      : match.price
      ? `$${match.price.amount.toLocaleString("en-US")}`
      : "Contact for Pricing";
  const per = match.price?.per === "person" ? "/person" : "/mo";
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
      <div className="relative aspect-video flex-shrink-0 bg-gray-100 sm:aspect-auto sm:h-full sm:w-[36%]">
        {image ? (
          <Image src={image} alt={listing.address ?? title} fill sizes="(max-width: 640px) 100vw, 320px" className="object-cover" onLoad={onPhotoDone} onError={onPhotoDone} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">No image</div>
        )}
        <div className="absolute right-2 top-2 rounded-full border border-white/50 bg-white/90 p-0.5 shadow">
          <HeartIcon listingId={listing._id} size="sm" />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col p-3">
        <div className="flex flex-shrink-0 items-start justify-between gap-2">
          <h3 className="min-w-0 truncate text-sm font-bold leading-snug text-gray-900">{title}</h3>
          <span className="flex-shrink-0 whitespace-nowrap text-sm font-bold text-[#3C4142]">
            {rent}
            {rent !== "Contact for Pricing" && <span className="text-xs font-normal">{per}</span>}
          </span>
        </div>
        {/* Same lines, in the same order, as the browse listing card: address,
            then beds, baths and lease type, then the walk and shuttle badges. */}
        {cityStateZip && <p className="mt-0.5 flex-shrink-0 truncate text-xs text-gray-500">{cityStateZip}</p>}
        <p className="mt-2 flex-shrink-0 truncate text-xs text-gray-500">
          {beds ?? "N/A"} bed | {baths ?? "N/A"} bath
          {listing.leaseType ? ` | ${listing.leaseType}` : ""}
        </p>
        {(walk != null || shuttle != null) && (
          <div className="mt-1.5 flex flex-shrink-0 items-center gap-3">
            {walk != null && <WalkScale minutes={walk} label="campus" />}
            {shuttle != null && <WalkScale minutes={shuttle} label="shuttle" />}
          </div>
        )}

        {/* The explanation takes whatever height the card has left, sized to fit it. */}
        <FittedReason reason={match.reason} note={match.note} />

        <div className="flex flex-shrink-0 items-end justify-between gap-2 pt-2">
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
          {numReviews > 0 && Number.isFinite(rating) && rating > 0 && (
            <span className="flex flex-shrink-0 items-center gap-0.5 text-xs" title={`${rating.toFixed(1)} out of 5 from ${numReviews} review${numReviews === 1 ? "" : "s"}`}>
              <Star className="h-3 w-3 fill-red-400 text-red-400" />
              <span className="font-semibold tabular-nums text-gray-700">{rating.toFixed(1)}</span>
              <span className="tabular-nums text-gray-400">({numReviews})</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
