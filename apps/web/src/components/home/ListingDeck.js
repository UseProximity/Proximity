"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import HeartIcon from "@/components/ui/HeartIcon";
import { WalkScale } from "@/components/listings/MapPopupCard";
import { listingHref } from "@/lib/listings/listingLink";
import {
  formatAvailableFrom,
  getCampusWalkMinutes,
  getListingHeading,
  getRentRangeLabel,
} from "@/utils/listingFormatters";

/*
 * The homepage hero's rotating stack of listing cards. It shows whatever
 * listings it is handed (Suggested for you, or Popular: see HeroSection), one
 * on top with the next ones fanned out behind it, and moves on by itself every
 * few seconds until the visitor hovers, focuses or takes the controls.
 */

const ROTATE_MS = 5000;

function range(values) {
  const nums = values.filter(Number.isFinite);
  if (!nums.length) return "N/A";
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  return lo === hi ? String(lo) : `${lo}-${hi}`;
}

function DeckCard({ listing, tag, priority, onOpen }) {
  const imageUrl = listing.images?.[0];
  const imageCount = listing.images?.length || 0;
  const { title, subtitle } = getListingHeading(listing);
  const rent = getRentRangeLabel(listing.unitTypes);
  const priced = rent !== "Contact for Pricing";
  const numReviews = Number(listing.numReviews) || 0;
  const rating = Number(listing.rating);
  const hasRating = numReviews > 0 && Number.isFinite(rating) && rating > 0;
  const available = formatAvailableFrom(listing.availableFrom);
  const campusMin = getCampusWalkMinutes(listing);
  const shuttleMin = typeof listing.shuttleWalkMinutes === "number" ? listing.shuttleWalkMinutes : null;

  return (
    <div
      onClick={onOpen}
      className="group absolute inset-0 cursor-pointer overflow-hidden rounded-3xl bg-gray-200 shadow-[0_18px_50px_rgba(0,0,0,0.22)]"
    >
      {/* Real crawlable link to the listing page. Plain clicks are cancelled so
          the card's own handler opens the listing; cmd/ctrl/middle-click and
          crawlers get the /listings/[id] URL. */}
      <a
        href={`/listings/${listing._id}`}
        aria-label={title}
        className="absolute inset-0 z-[1]"
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
            e.stopPropagation();
            return;
          }
          e.preventDefault();
        }}
      />
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={listing.address}
          fill
          priority={priority}
          sizes="(max-width: 1024px) 100vw, 560px"
          className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400">No image</div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/10" />

      <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap items-center gap-2 pr-14">
        {available && (
          <span className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold leading-none text-gray-900 shadow-sm">
            {available}
          </span>
        )}
        {tag && (
          <span className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold leading-none text-white shadow-sm">
            {tag}
          </span>
        )}
        {listing.verifiedLive && (
          <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-semibold uppercase leading-none tracking-wide text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
            Live
          </span>
        )}
      </div>
      <div className="absolute right-4 top-4 z-[2]">
        <HeartIcon listingId={listing._id} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-5 text-white sm:p-6">
        <div className="flex items-end justify-between gap-3">
          <h3 className="min-w-0 truncate text-xl font-bold leading-tight sm:text-2xl">{title}</h3>
          <span className="flex-shrink-0 whitespace-nowrap text-xl font-bold sm:text-2xl">
            {priced ? rent : <span className="text-sm font-semibold">{rent}</span>}
            {priced && <span className="text-sm font-normal text-white/80"> /mo</span>}
          </span>
        </div>
        {subtitle && <p className="mt-1 truncate text-sm text-white/80">{subtitle}</p>}
        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
          <span className="truncate">
            {range(listing.unitTypes.map((u) => u.bedrooms))} bed{" | "}
            {range(listing.unitTypes.map((u) => u.bathrooms))} bath
            {listing.leaseType ? ` | ${listing.leaseType}` : ""}
          </span>
          {hasRating && (
            <span className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap">
              <Star className="h-3.5 w-3.5 fill-red-400 text-red-400" />
              <span className="font-semibold tabular-nums">{rating.toFixed(1)}</span>
              <span className="tabular-nums text-white/70">({numReviews})</span>
            </span>
          )}
        </div>
        <div className="mt-2 flex min-h-[26px] items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            {campusMin != null && Number.isFinite(campusMin) && <WalkScale minutes={campusMin} label="campus" onPhoto />}
            {shuttleMin != null && <WalkScale minutes={shuttleMin} label="shuttle" onPhoto />}
          </div>
          {imageCount > 1 && (
            <span className="hidden flex-shrink-0 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium leading-none min-[420px]:block">
              See all {imageCount} photos
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function DeckSkeleton() {
  return <div className="absolute inset-0 animate-pulse rounded-3xl bg-gray-200" />;
}

const ARROW =
  "flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300";

// listings: null while still loading, otherwise the cards to show.
// tag: the red pill on the top card saying what these are ("Popular").
export default function ListingDeck({ listings, tag = "", onOpenListing = null }) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  // Paused while the pointer is over it OR keyboard focus is inside it: one
  // ending must not restart rotation while the other still holds.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const count = listings?.length ?? 0;
  // The list can change under us (Popular refreshing, Suggested arriving).
  const at = count ? index % count : 0;

  const step = (by) => {
    if (count < 2) return;
    setDir(by);
    setIndex((i) => (((i % count) + by) % count + count) % count);
  };

  useEffect(() => {
    if (count < 2 || paused || reduceMotion) return;
    const t = setInterval(() => {
      // A tab in the background keeps its place.
      if (document.hidden) return;
      setDir(1);
      setIndex((i) => (i + 1) % count);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [count, paused, reduceMotion]);

  const current = count ? listings[at] : null;
  const next = count > 1 ? listings[(at + 1) % count] : null;
  const afterNext = count > 2 ? listings[(at + 2) % count] : null;

  return (
    <div
      className="w-full"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(e) => {
        // Moving between the deck's own buttons is not leaving it.
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <div className="relative aspect-[1/1.02] w-full sm:aspect-[5/4]">
        {/* The next two cards, fanned out behind the one on top. */}
        {afterNext && (
          <div className="absolute inset-0 origin-bottom-right translate-x-[5%] rotate-[7deg] scale-[0.94] overflow-hidden rounded-3xl bg-gray-300 shadow-md" aria-hidden="true">
            {afterNext.images?.[0] && (
              <Image src={afterNext.images[0]} alt="" fill sizes="(max-width: 1024px) 100vw, 560px" className="object-cover opacity-60" />
            )}
          </div>
        )}
        {next && (
          <div className="absolute inset-0 origin-bottom-right translate-x-[2.5%] rotate-[3.5deg] scale-[0.97] overflow-hidden rounded-3xl bg-gray-300 shadow-lg" aria-hidden="true">
            {next.images?.[0] && (
              <Image src={next.images[0]} alt="" fill sizes="(max-width: 1024px) 100vw, 560px" className="object-cover opacity-80" />
            )}
          </div>
        )}

        {listings === null ? (
          <DeckSkeleton />
        ) : (
          <AnimatePresence initial={false} custom={dir}>
            {current && (
              <motion.div
                key={current._id}
                custom={dir}
                variants={{
                  enter: (d) => (reduceMotion ? { opacity: 0 } : { opacity: 0, x: d > 0 ? 28 : -28, rotate: d > 0 ? 3.5 : -3.5, scale: 0.97 }),
                  center: { opacity: 1, x: 0, rotate: 0, scale: 1 },
                  exit: (d) => (reduceMotion ? { opacity: 0 } : { opacity: 0, x: d > 0 ? -60 : 60, rotate: d > 0 ? -5 : 5, scale: 0.97 }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-0"
              >
                <DeckCard
                  listing={current}
                  tag={tag}
                  priority={at === 0}
                  onOpen={() => {
                    onOpenListing?.(current, at);
                    router.push(listingHref(current._id, "/"));
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      {count > 1 && (
        <div className="mt-6 flex items-center gap-4">
          <div className="flex gap-2.5">
            <button type="button" onClick={() => step(-1)} className={ARROW} aria-label="Previous listing">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => step(1)} className={ARROW} aria-label="Next listing">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            {listings.map((l, i) => (
              <button
                key={l._id}
                type="button"
                onClick={() => {
                  setDir(i >= at ? 1 : -1);
                  setIndex(i);
                }}
                aria-label={`Show listing ${i + 1} of ${count}`}
                aria-current={i === at}
                className={`h-2 rounded-full transition-all duration-300 ${i === at ? "w-6 bg-red-600" : "w-2 bg-gray-300 hover:bg-gray-400"}`}
              />
            ))}
          </div>
          {next && (
            <p className="ml-auto hidden min-w-0 truncate text-sm font-semibold text-gray-500 sm:block">
              Next: {getListingHeading(next).title}
            </p>
          )}
        </div>
      )}

      {/* Every card's listing page as a real link in the first HTML, not only
          the one on top. */}
      {count > 1 && (
        <ul className="sr-only">
          {listings.map((l) => (
            <li key={l._id}>
              <a href={`/listings/${l._id}`} tabIndex={-1}>
                {getListingHeading(l).title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
