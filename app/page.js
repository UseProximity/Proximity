"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, useInView } from "framer-motion";
import {
  Search,
  Star,
  MapPin,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Bed,
  Bath,
} from "lucide-react";
import Link from "next/link";
import UniversityLogosCarousel from "@/components/UniversityLogosCarousel";
import Footer from "@/components/Footer";

const SIDE_MARGIN = "px-12 md:px-20 lg:px-28";

// ─── Hero + Map (combined) ─────────────────────────────────────────────────────

function HeroMapSection() {
  const [searchQuery, setSearchQuery] = useState("");
  const [previewListings, setPreviewListings] = useState([]);
  const router = useRouter();
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-40px" });

  useEffect(() => {
    fetch("/api/listings")
      .then((r) => r.json())
      .then((data) => {
        const all = Array.isArray(data)
          ? data
          : Array.isArray(data?.listings)
          ? data.listings
          : [];
        setPreviewListings(all.slice(0, 2));
      })
      .catch(() => {});
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    router.push(q ? `/browse?search=${encodeURIComponent(q)}` : "/browse");
  };

  const card1 = previewListings[0];
  const card2 = previewListings[1];

  const mapPins = [
    { top: "18%", left: "20%", active: true },
    { top: "40%", left: "55%", active: false },
    { top: "63%", left: "28%", active: false },
    { top: "26%", left: "72%", active: false },
    { top: "54%", left: "80%", active: false },
    { top: "74%", left: "62%", active: false },
    { top: "12%", left: "46%", active: false },
  ];

  const BG = "#f2f4f8";

  return (
    <section
      ref={ref}
      className="relative overflow-hidden"
      style={{ background: BG }}
    >
      <div className="flex flex-col lg:flex-row lg:min-h-[680px]">

      {/* ── Left: Hero content ── */}
      <div className={`relative z-40 flex-shrink-0 max-w-[720px] ${SIDE_MARGIN} py-20 lg:py-26 flex flex-col justify-center`}>

        {/* Headline */}
        <motion.h1
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.08 }}
          className="text-5xl sm:text-6xl lg:text-[68px] font-bold text-gray-900 leading-[0.93] tracking-tight mb-6"
        >
          Find your perfect <span className="text-red-700">WashU</span> Housing
          Now
        </motion.h1>

        {/* Sub-headline */}
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.16 }}
          className="text-[17px] text-gray-500 max-w-sm mb-8 leading-relaxed"
        >
          The only platform built for students to discover, review, and secure
          off-campus housing with full transparency.
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
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search address or neighborhood..."
              className="flex-1 px-2.5 py-2.5 text-sm bg-transparent border-0 outline-none text-gray-900 placeholder-gray-400 min-w-0"
            />
            <button
              type="submit"
              className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-lg text-sm transition-all duration-150 flex-shrink-0"
            >
              Search
            </button>
          </div>
        </motion.form>

        {/* Stats strip */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.46 }}
          className="flex gap-8"
        >
          {[
            { value: "500+", label: "Listings" },
            { value: "14+", label: "Universities" },
            { value: "1,200+", label: "Reviews" },
            { value: "100%", label: "Transparent" },
          ].map((stat) => (
            <div key={stat.label} className="mt-8 flex flex-col">
              <span className="text-2xl font-black text-gray-900">{stat.value}</span>
              <span className="text-xs text-gray-500 font-medium mt-0.5">{stat.label}</span>
            </div>
          ))}
        </motion.div>
      </div>

      {/* ── Right: Map ── */}
      <div className="relative flex-1 min-h-[400px] lg:min-h-0 overflow-hidden pointer-events-none">

        {/* Map base */}
        <div className="absolute inset-0" style={{ background: "#e7ecf3" }}>

          {/* Horizontal roads */}
          {[16, 30, 45, 60, 72, 85].map((pct, i) => (
            <div
              key={`h${pct}`}
              className="absolute bg-white"
              style={{
                top: `${pct}%`,
                left: 0,
                right: 0,
                height: i === 1 || i === 3 ? "3px" : "2px",
                opacity: i === 1 || i === 3 ? 0.85 : 0.6,
              }}
            />
          ))}

          {/* Vertical roads */}
          {[10, 26, 40, 54, 66, 78, 90].map((pct, i) => (
            <div
              key={`v${pct}`}
              className="absolute bg-white"
              style={{
                left: `${pct}%`,
                top: 0,
                bottom: 0,
                width: i === 1 || i === 4 ? "3px" : "2px",
                opacity: i === 1 || i === 4 ? 0.85 : 0.6,
              }}
            />
          ))}

          {/* Block fills */}
          {[
            { t: "20%", l: "28%", w: "10%", h: "7%" },
            { t: "33%", l: "42%", w: "10%", h: "9%" },
            { t: "49%", l: "56%", w: "9%", h: "9%" },
            { t: "13%", l: "13%", w: "11%", h: "5%" },
            { t: "63%", l: "29%", w: "9%", h: "7%" },
            { t: "20%", l: "68%", w: "10%", h: "7%" },
            { t: "47%", l: "80%", w: "8%", h: "11%" },
          ].map((b, i) => (
            <div
              key={i}
              className="absolute rounded-sm"
              style={{ top: b.t, left: b.l, width: b.w, height: b.h, background: "#dbe2ec" }}
            />
          ))}

          {/* Street labels */}
          <span className="absolute text-[9px] text-gray-400 font-medium select-none tracking-wide" style={{ top: "27%", left: "42%" }}>
            Delmar Blvd
          </span>
          <span className="absolute text-[9px] text-gray-400 font-medium select-none tracking-wide" style={{ top: "57%", left: "53%" }}>
            Forest Park Pkwy
          </span>
          <span className="absolute text-[9px] text-gray-400 font-medium select-none tracking-wide" style={{ top: "8%", left: "22%" }}>
            Skinker Blvd
          </span>
          <span className="absolute text-[9px] text-gray-400 font-medium select-none tracking-wide uppercase" style={{ top: "38%", left: "60%" }}>
            DELMAR LOOP
          </span>
        </div>

        {/* Map pins */}
        {mapPins.map((pin, i) => (
          <motion.div
            key={i}
            initial={{ scale: 0, opacity: 0 }}
            animate={isInView ? { scale: 1, opacity: 1 } : {}}
            transition={{
              delay: 0.5 + i * 0.08,
              type: "spring",
              stiffness: 380,
              damping: 22,
            }}
            className="absolute z-10"
            style={{ top: pin.top, left: pin.left, transform: "translate(-50%, -50%)" }}
          >
            {pin.active ? (
              <div className="relative">
                <div className="w-[14px] h-[14px] rounded-full bg-red-500 shadow-lg shadow-red-400/40 ring-4 ring-red-100" />
                <div className="absolute inset-0 w-[14px] h-[14px] rounded-full bg-red-400 animate-ping opacity-25" />
              </div>
            ) : (
              <div className="w-3 h-3 rounded-full bg-red-400/60 shadow" />
            )}
          </motion.div>
        ))}

        {/* Floating listing card 1 */}
        {/* TODO: Make the floating Listing card a component and reuse once I get real data for the map. */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, delay: 0.6 }}
          className="absolute z-20 bg-white rounded-2xl overflow-hidden pointer-events-auto"
          style={{
            top: "7%",
            left: "8%",
            width: "250px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)",
          }}
        >
          <div className="h-[120px] bg-gray-100 overflow-hidden">
            {card1?.images?.[0] ? (
              <img
                src={card1.images[0]}
                alt={card1.address}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center">
                <MapPin className="h-7 w-7 text-gray-400" />
              </div>
            )}
          </div>
          <div className="p-3.5">
            <div className="text-red-500 font-bold text-[15px] leading-tight mb-0.5">
              {card1?.unitTypes?.[0]?.rent
                ? `$${card1.unitTypes[0].rent.toLocaleString()}`
                : "$2,800"}
              <span className="text-gray-400 text-xs font-normal"> /month</span>
            </div>
            <div className="font-bold text-gray-900 text-sm truncate mb-0.5">
              {card1?.address?.split(",")[0] || "Kingsbury Manor"}
            </div>
            <div className="text-xs text-gray-400 truncate mb-2.5">
              {card1?.address || "St. Louis, MO"}
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {(card1?.unitTypes?.[0]?.bedrooms ?? 3) && (
                <span className="flex items-center gap-1">
                  <Bed className="h-3.5 w-3.5" />
                  {card1?.unitTypes?.[0]?.bedrooms ?? 3}
                </span>
              )}
              {(card1?.unitTypes?.[0]?.bathrooms ?? 2) && (
                <span className="flex items-center gap-1">
                  <Bath className="h-3.5 w-3.5" />
                  {card1?.unitTypes?.[0]?.bathrooms ?? 2}
                </span>
              )}
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                0.4mi
              </span>
            </div>
          </div>
        </motion.div>

        {/* Floating listing card 2 */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.55, delay: 0.75 }}
          className="absolute z-20 bg-white rounded-2xl overflow-hidden pointer-events-auto"
          style={{
            bottom: "10%",
            right: "6%",
            width: "210px",
            boxShadow: "0 12px 40px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)",
          }}
        >
          <div className="h-[95px] bg-gray-100 overflow-hidden">
            {card2?.images?.[0] ? (
              <img
                src={card2.images[0]}
                alt={card2.address}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center">
                <MapPin className="h-6 w-6 text-gray-400" />
              </div>
            )}
          </div>
          <div className="p-3">
            <div className="text-red-500 font-bold text-sm mb-0.5">
              {card2?.unitTypes?.[0]?.rent
                ? `$${card2.unitTypes[0].rent.toLocaleString()}`
                : "$1,950"}
              <span className="text-gray-400 text-xs font-normal"> /month</span>
            </div>
            <div className="font-bold text-gray-900 text-xs truncate mb-0.5">
              {card2?.address?.split(",")[0] || "University Square"}
            </div>
            <div className="text-xs text-gray-400 truncate">
              {card2?.address || "St. Louis, MO"}
            </div>
          </div>
        </motion.div>

        {/* Left gradient — blends map into hero bg (desktop only) */}
        <div
          className="hidden lg:block absolute left-0 top-0 bottom-0 w-56 z-30"
          style={{ background: `linear-gradient(to right, ${BG} 0%, transparent 100%)` }}
        />
        {/* Top gradient */}
        <div
          className="absolute top-0 left-0 right-0 h-14 z-30"
          style={{ background: `linear-gradient(to bottom, ${BG} 0%, transparent 100%)` }}
        />
        {/* Bottom gradient */}
        <div
          className="absolute bottom-0 left-0 right-0 h-20 z-30"
          style={{ background: `linear-gradient(to top, ${BG} 0%, transparent 100%)` }}
        />
      </div>

      </div>
    </section>
  );
}

// ─── Reviews Carousel ──────────────────────────────────────────────────────────

const REVIEWS = [
  {
    text: "I found my apartment in two days. The landlord reviews saved me from renting from someone with a terrible reputation — something I never would have known otherwise.",
    author: "Maya T.",
    university: "Washington University in St. Louis",
    rating: 5,
  },
  {
    text: "The heatmaps are honestly the best feature. I could see exactly which neighborhoods had the most students and which were safer. Made the decision so much easier.",
    author: "Jordan K.",
    university: "University of Southern California",
    rating: 5,
  },
  {
    text: "I subleased my apartment in 3 days. Way better than posting on Facebook groups and dealing with random people. Everyone here is a verified student.",
    author: "Priya M.",
    university: "Columbia University",
    rating: 5,
  },
  {
    text: "Proximity showed me listings I couldn't find anywhere else. The rent comparison tool told me I was about to overpay by $300/month. Huge.",
    author: "Alex R.",
    university: "UCLA",
    rating: 5,
  },
  {
    text: "As an international student, finding housing was incredibly stressful. Proximity made the whole process transparent and I felt confident in my decision.",
    author: "Chen W.",
    university: "Penn State University",
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

  const goNext = () => { setSkipAnim(false); setPos((p) => p + 1); };
  const goPrev = () => {
    setSkipAnim(false);
    setPos((p) => {
      const next = p - 1;
      if (next < N_REVIEWS) {
        setTimeout(() => { setSkipAnim(true); setPos(N_REVIEWS * 2 - 1); }, 550);
      }
      return next;
    });
  };

  const centerOffset = containerW > 0 ? (containerW - CARD_W) / 2 : 0;
  const x = -(pos * STEP) + centerOffset;
  const dotIdx = ((pos - N_REVIEWS) % N_REVIEWS + N_REVIEWS) % N_REVIEWS;

  return (
    <section ref={sectionRef} className="w-full py-18 md:py-24 bg-white overflow-hidden">

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
                    <Star key={j} className="h-4 w-4 fill-red-400 text-red-400" />
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
                  <div className="text-sm font-bold text-gray-900">{review.author}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{review.university}</div>
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
  const firstUnit = listing.unitTypes?.[0];
  const price = firstUnit?.rent;
  const beds = firstUnit?.bedrooms;
  const baths = firstUnit?.bathrooms;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.5, delay: index * 0.07 }}
    >
      <Link href="/browse" className="group block">
        <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-lg hover:border-gray-200 transition-all duration-300">
          <div className="relative h-48 bg-gray-100 overflow-hidden">
            {listing.images?.[0] ? (
              <img
                src={listing.images[0]}
                alt={listing.address}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                <MapPin className="h-8 w-8 text-gray-300" />
              </div>
            )}
            {listing.rating > 0 && (
              <div className="absolute top-3 right-3 flex items-center gap-1 bg-white/90 backdrop-blur-sm px-2 py-1 rounded-lg text-xs font-semibold text-gray-900 shadow-sm">
                <Star className="h-3 w-3 fill-red-400 text-red-400" />
                {listing.rating.toFixed(1)}
              </div>
            )}
          </div>
          <div className="p-4">
            <p className="text-sm font-semibold text-gray-900 truncate mb-2">
              {listing.address}
            </p>
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-400">
                {beds ? `${beds} bd` : ""}
                {beds && baths ? " · " : ""}
                {baths ? `${baths} ba` : ""}
              </div>
              {price ? (
                <div className="text-sm font-bold text-gray-900">
                  ${price.toLocaleString()}
                  <span className="text-xs font-normal text-gray-400">/mo</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl overflow-hidden border border-gray-100 animate-pulse">
      <div className="h-48 bg-gray-100" />
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
    <section ref={ref} className="w-full py-20 md:py-28 bg-gray-50/70">
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
            : listings.map((listing, i) => (
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
            Join thousands of students who found housing they actually love —
            without the chaos.
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
  return (
    <div className="min-h-screen bg-white">
      <main>
        <HeroMapSection />
        <PopularRentals />
        <ReviewsCarousel />
        <CollegesBand />
        <CTABand />
      </main>
      <Footer />
    </div>
  );
}
