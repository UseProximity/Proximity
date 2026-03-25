"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, useInView } from "framer-motion";
import {
  Search,
  Star,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import AddressSearchInput from "@/components/AddressSearchInput";
import UniversityLogosCarousel from "@/components/UniversityLogosCarousel";
import Footer from "@/components/Footer";
import { getRentRangeLabel } from "@/utils/listingFormatters";

const HeroMapPreview = dynamic(() => import("@/components/HeroMapPreview"), {
  ssr: false,
});

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

const SIDE_MARGIN = "px-12 md:px-20 lg:px-28";

// ─── Hero + Map (combined) ─────────────────────────────────────────────────────

function HeroMapSection() {
  const [searchQuery, setSearchQuery] = useState("");
  const [previewListings, setPreviewListings] = useState([]);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/listings")
      .then((r) => r.json())
      .then((data) => {
        const all = Array.isArray(data)
          ? data
          : Array.isArray(data?.listings)
          ? data.listings
          : [];
        setPreviewListings(all.slice(0, 15));
      })
      .catch(() => {});
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    router.push(q ? `/browse?search=${encodeURIComponent(q)}` : "/browse");
  };

  const handleSuggestionSelect = (feature) => {
    const [lng, lat] = feature.center;
    router.push(`/browse?lat=${lat}&lng=${lng}`);
  };

  const BG = "#f2f4f8";

  return (
    <section className="relative overflow-hidden" style={{ background: BG }}>
      <div className="flex flex-col lg:flex-row lg:min-h-[680px]">
        {/* ── Left: Hero content ── */}
        <div
          className={`relative z-40 flex-shrink-0 max-w-[800px] ${SIDE_MARGIN} pt-10 md:pb-8 pb-20 lg:py-26 flex flex-col justify-center`}
        >
          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08 }}
            className="text-5xl sm:text-6xl lg:text-[56px] font-bold text-gray-900 leading-[1.1] tracking-tight mb-6"
          >
            Find Your Perfect <span className="text-red-700">WashU</span>{" "}
            Housing Now
          </motion.h1>

          {/* Sub-headline */}
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.16 }}
            className="text-[17px] text-gray-500 max-w-sm mb-2 leading-relaxed"
          >
            The only platform that actually understands what students care
            about.
          </motion.p>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.16 }}
            className="text-[17px] text-gray-500 max-w-sm mb-8 leading-relaxed"
          >
            Relevant filters, real peer reviews, and a streamlined search to
            help you secure off-campus housing with full transparency.
          </motion.p>

          {/* Search bar */}
          <motion.form
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.24 }}
            onSubmit={handleSearch}
            className="relative max-w-md mb-5"
          >
            <div className="flex items-center bg-white rounded-xl border border-gray-200 focus-within:border-red-300 shadow-md shadow-black/[0.05] transition-all duration-200 p-1.5 gap-1">
              <Search className="ml-2.5 h-4 w-4 text-gray-400 flex-shrink-0" />
              <AddressSearchInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onSelectSuggestion={handleSuggestionSelect}
                placeholder="Search address..."
                className="w-full px-2.5 py-2.5 text-sm bg-transparent border-0 outline-none text-gray-900 placeholder-gray-400"
              />
              <button
                type="submit"
                className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg text-sm transition-all duration-150 flex-shrink-0"
              >
                Search
              </button>
            </div>
          </motion.form>

          {/* Tagline */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.46 }}
            className="mt-4 text-xl font-bold text-gray-800 leading-snug"
          >
            Better apartments.{" "}
            <span className="text-red-600">Honest reviews.</span> Zero stress.
          </motion.p>
        </div>

        {/* ── Right: Map ── */}
        <div className="relative flex-1 min-h-[400px] lg:min-h-0 overflow-hidden">
          {/* Real Mapbox map, desaturated */}
          <div className="absolute inset-0">
            <HeroMapPreview listings={previewListings} />
          </div>

          {/* Left gradient — blends map into hero bg (desktop only) */}
          <div
            className="hidden lg:block absolute left-0 top-0 bottom-0 w-56 z-30 pointer-events-none"
            style={{
              background: `linear-gradient(to right, ${BG} 0%, transparent 100%)`,
            }}
          />
          {/* Top gradient */}
          <div
            className="absolute top-0 left-0 right-0 h-14 z-30 pointer-events-none"
            style={{
              background: `linear-gradient(to bottom, ${BG} 0%, transparent 100%)`,
            }}
          />
          {/* Bottom gradient */}
          <div
            className="absolute bottom-0 left-0 right-0 h-20 z-30 pointer-events-none"
            style={{
              background: `linear-gradient(to top, ${BG} 0%, transparent 100%)`,
            }}
          />
        </div>
      </div>
    </section>
  );
}

// ─── Reviews Carousel ──────────────────────────────────────────────────────────

const REVIEWS = [
  {
    text: "Proximity made the whole housing process easy and convenient. Ben Flicker responded very quickly with an option that fit our group's needs, and we are very satisfied with the property we decided to lease.",
    author: "Felix Harari",
    rating: 5,
  },
  {
    text: "Before Proximity, our apartment search was a mess. We were late to sign a lease and completely lost in the process. We decided to give Proximity a shot and filled out the form on the website. We received a quick response, and a few days later, we were matched up with a great apartment for next semester. Overall made the process much less stressful and really saved us.",
    author: "Jameson T",
    rating: 5,
  },
  {
    text: "I was scrambling to find housing that I would like and when I reached out to Proximity, they were quick to help me find a place that fit my needs, set me up with the landlord, and help me secure my lease. They were incredibly responsive, helpful, and kind.",
    author: "Wyatt Ogle",
    rating: 5,
  },
  {
    text: "As an on-campus student at WashU, I did not have much luck using the on-campus housing process and was unsure if a matching service would truly be able to find a place that fit my needs off-campus. When I completed the form, I received a response in a very timely manner that provided me with options that were within walking distance of campus and at a cost that was reasonable compared to what I had seen on-campus. The quickness of the response and how well the options were matched to what I was looking for made using this site far more effective than spending hours searching Google for listings nearby.",
    author: "Benjamin K",
    rating: 5,
  },
  {
    text: "The on-campus housing process sucks, and I was seriously dreading my living conditions next year. I was worried about being stuck with the dregs of the off-campus housing, as I was certain I wouldn't get an on-campus assignment. Fortunately, Proximity helped me find a 9 room apartment for me and my friends and it is far nicer than my standards, I can't recommend it enough.",
    author: "Spencer Gaukel",
    rating: 5,
  },
  {
    text: "Proximity made finding a triple for next year at LOCAL super easy. It matched all three of our preferences without the usual back-and-forth of coordinating, and helped weigh our options to find the perfect match. The process felt really smooth and straightforward.",
    author: "Anonymous",
    rating: 5,
  },
  {
    text: "I got a really quick response that matched my needs exactly. I was able to find the best match to the spot I really needed and the platform was able to hit each priority that I listed.",
    author: "Ethan",
    rating: 5,
  },
  {
    text: "The experience was very good and very smooth. It was very helpful and helped me find exactly what I needed with very quick response times. They actually listened to what I was looking for instead of just giving me anything.",
    author: "Anonymous",
    rating: 5,
  },
  {
    text: "I could tell that they really cared about helping me find housing. All responses were extremely timely and helpful.",
    author: "Sam",
    rating: 5,
  },
  {
    text: "I was skeptical of the housing match service, but after searching unsuccessfully for a few days I decied to give it a try. It took me a few minutes and I received 2 personalized options in under 2 hours. I told them I liked LOCAL, they connected me with the leasing team, and I signed my lease the next day. ",
    author: "Marvin Z",
    rating: 5,
  },
];

const N_REVIEWS = REVIEWS.length;
const REVIEW_TRACK = [...REVIEWS, ...REVIEWS, ...REVIEWS];
const CARD_W = 300;
const GAP = 20;
const STEP = CARD_W + GAP;

function ReviewsCarousel() {
  const sectionRef = useRef(null);
  const trackRef = useRef(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-80px" });

  const [pos, setPos] = useState(N_REVIEWS);
  const [skipAnim, setSkipAnim] = useState(false);
  const [containerW, setContainerW] = useState(0);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const update = () => setContainerW(el.offsetWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setSkipAnim(false);
      setPos((p) => p + 1);
    }, 4500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (pos >= N_REVIEWS * 2) {
      const t = setTimeout(() => {
        setSkipAnim(true);
        setPos((p) => p - N_REVIEWS);
      }, 550);
      return () => clearTimeout(t);
    }
  }, [pos]);

  useEffect(() => {
    if (!skipAnim) return;
    const t = setTimeout(() => setSkipAnim(false), 16);
    return () => clearTimeout(t);
  }, [skipAnim]);

  const goNext = () => {
    setSkipAnim(false);
    setPos((p) => p + 1);
  };
  const goPrev = () => {
    setSkipAnim(false);
    setPos((p) => {
      const next = p - 1;
      if (next < N_REVIEWS) {
        setTimeout(() => {
          setSkipAnim(true);
          setPos(N_REVIEWS * 2 - 1);
        }, 550);
      }
      return next;
    });
  };

  const centerOffset = containerW > 0 ? (containerW - CARD_W) / 2 : 0;
  const x = -(pos * STEP) + centerOffset;
  const dotIdx = (((pos - N_REVIEWS) % N_REVIEWS) + N_REVIEWS) % N_REVIEWS;

  return (
    <section
      ref={sectionRef}
      className="w-full py-16 md:py-22 bg-white overflow-hidden"
    >
      {/* Header */}
      <div className={`w-full ${SIDE_MARGIN}`}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12"
        >
          <span className="inline-block px-3 py-1 bg-red-50 text-red-500 text-xs font-bold rounded-full uppercase tracking-widest mb-4">
            Student Reviews
          </span>
          <h2 className="text-4xl md:text-5xl font-black text-gray-900">
            Don&apos;t take our word for it.
          </h2>
        </motion.div>
      </div>

      {/* Sliding track */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : {}}
        transition={{ duration: 0.6, delay: 0.2 }}
      >
        <div ref={trackRef} className="relative overflow-hidden">
          {/* Side fades */}
          <div className="absolute left-0 top-0 bottom-0 w-24 md:w-40 lg:w-56 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-24 md:w-40 lg:w-56 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />

          <motion.div
            className="flex py-6"
            style={{ gap: GAP }}
            animate={{ x }}
            transition={
              skipAnim
                ? { duration: 0 }
                : { type: "spring", stiffness: 55, damping: 20, mass: 1 }
            }
          >
            {REVIEW_TRACK.map((review, i) => (
              <div
                key={i}
                style={{ width: CARD_W, flexShrink: 0 }}
                className="bg-white border border-gray-150 rounded-2xl p-5 shadow-[0_2px_16px_rgba(0,0,0,0.07)]"
              >
                <div className="flex gap-1 mb-3.5">
                  {Array.from({ length: review.rating }).map((_, j) => (
                    <Star
                      key={j}
                      className="h-4 w-4 fill-red-400 text-red-400"
                    />
                  ))}
                </div>
                <p
                  className="text-gray-600 text-sm leading-relaxed mb-5 overflow-hidden"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 4,
                    WebkitBoxOrient: "vertical",
                  }}
                >
                  &ldquo;{review.text}&rdquo;
                </p>
                <div>
                  <div className="text-sm font-bold text-gray-900">
                    {review.author}
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-4 mt-3">
          <button
            onClick={goPrev}
            className="p-2 rounded-full border border-gray-200 hover:border-gray-300 text-gray-400 hover:text-gray-700 transition-all duration-150"
            aria-label="Previous review"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex gap-2">
            {REVIEWS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === dotIdx ? "w-6 bg-red-500" : "w-1.5 bg-gray-200"
                }`}
              />
            ))}
          </div>
          <button
            onClick={goNext}
            className="p-2 rounded-full border border-gray-200 hover:border-gray-300 text-gray-400 hover:text-gray-700 transition-all duration-150"
            aria-label="Next review"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </motion.div>
    </section>
  );
}

// ─── Popular Rentals ───────────────────────────────────────────────────────────

function RentalCard({ listing, index, isInView }) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const imageUrl = listing.images?.[0];
  const imageCount = listing.images?.length || 0;
  const [streetAddress, ...restParts] = listing.address.split(",");
  const cityStateZip = restParts.join(",").trim();
  const bedValues = listing.unitTypes
    .map((u) => u.bedrooms)
    .filter(Number.isFinite);
  const bathValues = listing.unitTypes
    .map((u) => u.bathrooms)
    .filter(Number.isFinite);
  const bedLabel =
    bedValues.length === 0
      ? "N/A"
      : Math.min(...bedValues) === Math.max(...bedValues)
      ? String(Math.min(...bedValues))
      : `${Math.min(...bedValues)}-${Math.max(...bedValues)}`;
  const bathLabel =
    bathValues.length === 0
      ? "N/A"
      : Math.min(...bathValues) === Math.max(...bathValues)
      ? String(Math.min(...bathValues))
      : `${Math.min(...bathValues)}-${Math.max(...bathValues)}`;

  const initial = isMobile
    ? { opacity: 0, x: index % 2 === 0 ? -40 : 40 }
    : { opacity: 0, y: 40 };

  return (
    <motion.div
      initial={initial}
      animate={isInView ? { opacity: 1, x: 0, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.07 }}
    >
      <div
        onClick={() => router.push(`/?listing=${listing._id}`)}
        className="group block cursor-pointer"
      >
        <div className="relative bg-white rounded-2xl shadow-lg overflow-hidden border border-gray-100 hover:border-red-200 transition-colors duration-200 flex flex-col">
          <div className="relative">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={listing.address}
                className="w-full aspect-video object-cover"
              />
            ) : (
              <div className="w-full aspect-video bg-gray-100 flex items-center justify-center text-gray-400">
                No image
              </div>
            )}
            {imageCount > 1 && (
              <div className="absolute bottom-3 right-3 bg-black/70 text-white text-xs font-semibold px-2.5 py-1 rounded-full">
                See all {imageCount} photos
              </div>
            )}
          </div>
          <div className="p-3 bg-[#fafafa] flex flex-col flex-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-bold text-sm text-gray-900 leading-snug">
                  {streetAddress}
                </h3>
                {cityStateZip && (
                  <p className="text-xs text-gray-500 font-normal mt-0.5">
                    {cityStateZip}
                  </p>
                )}
              </div>
              <span className="text-red-500 font-bold text-sm whitespace-nowrap flex-shrink-0">
                {getRentRangeLabel(listing.unitTypes)}
                <span className="text-xs font-normal">/mo</span>
              </span>
            </div>
            <div className="flex items-center justify-between mt-auto pt-2">
              <span className="text-gray-500 text-xs">
                {bedLabel} bed{" | "}
                {bathLabel} bath
                {listing.leaseAvailability
                  ? ` | ${listing.leaseAvailability}`
                  : ""}
              </span>
              {listing.owner?.name && (
                <span className="text-gray-400 text-xs truncate ml-2">
                  {listing.owner.name}
                </span>
              )}
            </div>
          </div>
          <div className="absolute bottom-0 left-0 w-0 h-0.5 bg-red-600 transition-[width] duration-300 group-hover:w-full" />
        </div>
      </div>
    </motion.div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 animate-pulse">
      <div className="h-64 bg-gray-100" />
      <div className="p-4 space-y-2.5">
        <div className="h-4 bg-gray-100 rounded-lg w-3/4" />
        <div className="h-3 bg-gray-100 rounded-lg w-1/2" />
      </div>
    </div>
  );
}

function PopularRentals() {
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const isMobile = useIsMobile();
  const visibleListings = isMobile ? listings.slice(0, 3) : listings;

  useEffect(() => {
    fetch("/api/listings")
      .then((r) => r.json())
      .then((data) => {
        const all = Array.isArray(data)
          ? data
          : Array.isArray(data?.listings)
          ? data.listings
          : [];
        setListings(all.slice(0, 6));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <section ref={ref} className="w-full pt-16 pb-8 md:py-22 bg-gray-50/70">
      <div className={`w-full ${SIDE_MARGIN}`}>
        {/* Section header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="flex items-end justify-between mb-10"
        >
          <div>
            <span className="inline-block px-3 py-1 bg-red-50 text-red-500 text-xs font-bold rounded-full uppercase tracking-widest mb-3">
              Available Now
            </span>
            <h2 className="text-4xl md:text-5xl font-black text-gray-900">
              Popular rentals.
            </h2>
          </div>
          <Link
            href="/browse"
            className="hidden md:flex items-center gap-1.5 text-sm font-semibold text-red-500 hover:text-red-600 transition-colors"
          >
            View all <ArrowRight className="h-4 w-4" />
          </Link>
        </motion.div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
            : visibleListings.map((listing, i) => (
                <RentalCard
                  key={listing._id}
                  listing={listing}
                  index={i}
                  isInView={isInView}
                />
              ))}
        </div>

        {/* Mobile "view all" */}
        <div className="flex md:hidden justify-center mt-10">
          <Link
            href="/browse"
            className="group flex items-center gap-2 px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white font-semibold rounded-xl transition-all duration-150 text-sm shadow-md"
          >
            View all listings
            <ArrowRight className="h-4 w-4 transition-transform duration-150 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── Colleges Band ─────────────────────────────────────────────────────────────

function CollegesBand() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section
      ref={ref}
      className="w-full py-6 bg-white border-t border-gray-100"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={isInView ? { opacity: 1 } : {}}
        transition={{ duration: 0.6 }}
      >
        <UniversityLogosCarousel />
      </motion.div>
    </section>
  );
}

// ─── CTA Band ──────────────────────────────────────────────────────────────────

function CTABand() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });
  const router = useRouter();

  return (
    <section ref={ref} className="w-full py-20 md:py-24 bg-red-700">
      <div className={`w-full ${SIDE_MARGIN} text-center`}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
        >
          <h2 className="text-4xl md:text-5xl font-black text-white mb-4 leading-tight">
            Find your next place today.
          </h2>
          <p className="text-lg text-red-100 mb-8 max-w-lg mx-auto leading-relaxed">
            Join WashU students who found housing they love.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => router.push("/browse")}
              className="px-8 py-4 bg-white hover:bg-red-50 text-red-500 font-bold rounded-xl transition-all duration-150 shadow-lg shadow-red-700/20 text-base"
            >
              Browse Listings
            </button>
            <button
              onClick={() => router.push("/CampusHub")}
              className="px-8 py-4 bg-transparent hover:bg-white/10 text-white font-semibold rounded-xl transition-all duration-150 border border-white/40 hover:border-white/60 text-base"
            >
              Explore Campus Hub
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function HomePage() {
  useEffect(() => {
    document.body.style.overflow = "";
    document.body.style.height = "";
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.width = "";
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <main>
        <HeroMapSection />
        <PopularRentals />
        <ReviewsCarousel />
        {/* <CollegesBand /> */}
        <CTABand />
      </main>
      <Footer />
    </div>
  );
}
