"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useSession } from "next-auth/react";
import MatchBar from "./MatchBar";
import ListingDeck from "./ListingDeck";
import { trackEvent, setListingSource } from "@/utils/analytics";

/*
 * The homepage hero: the headline and the Find Your Place bar on the left, the
 * rotating listing cards on the right (underneath on a phone).
 *
 * The cards follow the rule the old homepage row had. Signed-in students with
 * enough activity get "Suggested for you" (the same 2 or 4 picks as the
 * /browse strip); everyone else, and any student the endpoint returns nothing
 * for, gets Popular. The session is server-provided, so signed-out visitors and
 * crawlers get Popular in the first HTML; signed-in students see a placeholder
 * until the suggestion answer arrives, never Popular flashing into Suggested.
 */
export default function HeroSection({ sideMargin, initialPopular = null, allListings = null, onBarEngage = null }) {
  // Server-seeded so the ranked cards (and their crawlable /listings/[id]
  // anchors) are in the first HTML; the mount fetch refreshes the ranking.
  const [popular, setPopular] = useState(initialPopular ?? []);
  const [loading, setLoading] = useState(!(initialPopular && initialPopular.length));
  const { data: session } = useSession();
  const userId = session?.user?.id;
  // null = still asking (signed in only); [] = none, show Popular.
  const [suggested, setSuggested] = useState(userId ? null : []);
  const showSuggested = !!suggested?.length;

  useEffect(() => {
    if (!userId) {
      setSuggested([]);
      return;
    }
    fetch("/api/listings/suggested")
      .then((r) => (r.ok ? r.json() : { ids: [] }))
      .then((data) => {
        const byId = new Map((allListings ?? []).map((l) => [String(l._id), l]));
        const found = (data?.ids ?? []).map((id) => byId.get(String(id))).filter(Boolean);
        // Even count only (0, 2 or 4), matching the browse strip.
        setSuggested(found.slice(0, found.length - (found.length % 2)));
      })
      .catch(() => setSuggested([]));
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showSuggested) return;
    trackEvent("suggested_impression", { surface: "home", count: suggested.length });
  }, [showSuggested]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Server ranks these by recent saves + contacts (last week, month, all
    // time), so they are shown as-is rather than re-sorted here.
    fetch("/api/listings/popular")
      .then((r) => r.json())
      .then((data) => {
        const all = Array.isArray(data) ? data : Array.isArray(data?.listings) ? data.listings : [];
        // Keep the server-rendered cards if the refresh comes back empty (a
        // 500 returns {error}, which parses to []).
        if (all.length) setPopular(all.slice(0, 6));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const deck = suggested === null ? null : showSuggested ? suggested : loading && !popular.length ? null : popular;
  // Nothing to show at all (both sources empty): the headline takes the row.
  const empty = deck !== null && deck.length === 0;

  return (
    <section className="relative overflow-x-clip bg-gradient-to-t from-red-100 via-red-50/60 to-white">
      <div
        className={`mx-auto grid w-full max-w-[1440px] items-center gap-12 ${sideMargin} pb-14 pt-10 sm:pt-14 xl:gap-12 xl:pb-20 xl:pt-16 ${
          empty ? "" : "min-[1200px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]"
        }`}
      >
        <div className="relative z-20 min-w-0">
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.05 }}
            className="text-[2.75rem] font-bold leading-[1.05] tracking-tight text-gray-950 sm:text-6xl min-[1200px]:text-[length:clamp(3.5rem,calc(8vw-2.5rem),4.5rem)]"
          >
            Find Your Perfect{" "}
            <span className="block">
              <span className="text-red-600">WashU</span> Housing.
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.14 }}
            className="mt-6 text-lg font-bold leading-snug text-gray-800 sm:text-xl"
          >
            Better apartments. <span className="text-red-600">Honest reviews.</span> Zero stress.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.22 }}
            className="mt-10 sm:-ml-3 sm:mt-14"
          >
            <MatchBar onEngage={onBarEngage} />
          </motion.div>
        </div>

        {!empty && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.18 }}
            className="relative z-10 mx-auto w-full min-w-0 max-w-[600px] pr-[5%] pt-4 min-[1200px]:pt-0"
          >
            <ListingDeck
              listings={deck}
              tag={showSuggested ? "Suggested for you" : "Popular"}
              onOpenListing={
                showSuggested
                  ? (listing, i) => {
                      trackEvent("suggested_click", {
                        surface: "home",
                        listing_id: String(listing._id),
                        position: i + 1,
                      });
                      setListingSource(listing._id, "suggested");
                    }
                  : null
              }
            />
          </motion.div>
        )}
      </div>
    </section>
  );
}
