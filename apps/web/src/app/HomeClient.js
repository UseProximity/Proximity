"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, useInView, AnimatePresence } from "framer-motion";
import { Star, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useSession } from "next-auth/react";
import UniversityLogosCarousel from "@/components/ui/UniversityLogosCarousel";
import Footer from "@/components/layout/Footer";
import HeroSection from "@/components/home/HeroSection";
import HowItWorks from "@/components/home/HowItWorks";
import HomeFaq from "@/components/home/HomeFaq";
import { becomeLandlord } from "@/lib/auth/landlordRole";
import { trackEvent, recordFyp } from "@/utils/analytics";
import { GROUP_OPTIONS as FYP_GROUPS } from "@/lib/findYourPlace/options";

const SIDE_MARGIN = "px-5 sm:px-12 md:px-20 lg:px-28";

const CARD_W = 300;
const GAP = 20;
const STEP = CARD_W + GAP;

function ReviewCard({ review, onSeeMore }) {
  const textRef = useRef(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    setIsTruncated(el.scrollHeight > el.clientHeight);
  }, [review.text]);

  return (
    <div
      style={{ width: CARD_W, flexShrink: 0 }}
      className="bg-white border border-gray-150 rounded-2xl p-5 shadow-[0_2px_16px_rgba(0,0,0,0.07)]"
    >
      <div className="flex gap-1 mb-3.5">
        {Array.from({ length: review.rating }).map((_, j) => (
          <Star key={j} className="h-4 w-4 fill-red-400 text-red-400" />
        ))}
      </div>
      <p
        ref={textRef}
        className="text-gray-600 text-sm leading-relaxed overflow-hidden mb-5"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 4,
          WebkitBoxOrient: "vertical",
        }}
      >
        &ldquo;{review.text}&rdquo;
      </p>
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-gray-900">{review.author}</div>
        {isTruncated && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSeeMore(review);
            }}
            className="text-xs text-gray-400 font-medium hover:underline"
          >
            see more
          </button>
        )}
      </div>
    </div>
  );
}

function ReviewsCarousel() {
  const sectionRef = useRef(null);
  const trackRef = useRef(null);
  const isInView = useInView(sectionRef, { once: true, margin: "-80px" });

  const [reviews, setReviews] = useState([]);
  const [pos, setPos] = useState(0);
  const [skipAnim, setSkipAnim] = useState(false);
  const [containerW, setContainerW] = useState(0);
  const [selectedReview, setSelectedReview] = useState(null);

  useEffect(() => {
    fetch("/api/testimonials")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setReviews(data);
          setPos(data.length);
        }
      })
      .catch(() => {});
  }, []);

  const n = reviews.length;
  const reviewTrack = n > 0 ? [...reviews, ...reviews, ...reviews] : [];

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
    if (n === 0 || selectedReview) return;
    const t = setInterval(() => {
      setSkipAnim(false);
      setPos((p) => p + 1);
    }, 4500);
    return () => clearInterval(t);
  }, [n, selectedReview]);

  useEffect(() => {
    if (n === 0 || pos < n * 2) return;
    const t = setTimeout(() => {
      setSkipAnim(true);
      setPos((p) => p - n);
    }, 550);
    return () => clearTimeout(t);
  }, [pos, n]);

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
      if (next < n) {
        setTimeout(() => {
          setSkipAnim(true);
          setPos(n * 2 - 1);
        }, 550);
      }
      return next;
    });
  };

  const centerOffset = containerW > 0 ? (containerW - CARD_W) / 2 : 0;
  const x = -(pos * STEP) + centerOffset;
  const dotIdx = n > 0 ? (((pos - n) % n) + n) % n : 0;

  return (
    <section
      ref={sectionRef}
      className="w-full py-16 md:py-[5.5rem] bg-gray-50 border-t border-gray-200 overflow-hidden"
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
          <div className="absolute left-0 top-0 bottom-0 w-24 md:w-40 lg:w-56 bg-gradient-to-r from-gray-50 to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-24 md:w-40 lg:w-56 bg-gradient-to-l from-gray-50 to-transparent z-10 pointer-events-none" />

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
            {reviewTrack.map((review, i) => (
              <ReviewCard
                key={i}
                review={review}
                onSeeMore={setSelectedReview}
              />
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
            {reviews.map((_, i) => (
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

      {/* Review modal */}
      {selectedReview && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedReview(null)}
        >
          <div
            className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-[0_8px_40px_rgba(0,0,0,0.18)] relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedReview(null)}
              className="absolute top-4 right-4 text-gray-400 hover:text-gray-700 transition-colors"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex gap-1 mb-3.5">
              {Array.from({ length: selectedReview.rating }).map((_, j) => (
                <Star key={j} className="h-4 w-4 fill-red-400 text-red-400" />
              ))}
            </div>
            <p className="text-gray-600 text-sm leading-relaxed mb-5">
              &ldquo;{selectedReview.text}&rdquo;
            </p>
            <div className="text-sm font-bold text-gray-900">
              {selectedReview.author}
            </div>
          </div>
        </div>
      )}
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
            Your WashU housing search ends here.
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

// ─── Find Your Place Popup ─────────────────────────────────────────────────────

/*
 * A nudge into Find Your Place that is its first question (Wyatt, 2026-11-16):
 * picking a group size opens the flow with that answer already in, so the
 * visitor has started before deciding to. Hidden for anyone who already has
 * matches on this browser: "prx_fyp_v1" is where FindYourPlaceClient keeps
 * its run.
 */
// `suppressed`: the visitor is already answering in the hero bar, which asks
// the same question, so the popup stays out of the way.
// Below tablet width it also waits while the bar is on screen: the popup is fixed to
// the bottom of the screen, which is where the stacked bar sits, and would
// cover it.
function FindYourPlacePopup({ suppressed = false }) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [barInView, setBarInView] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    const bar = document.querySelector("[data-home-match-bar]");
    if (!bar || !window.matchMedia("(max-width: 767px)").matches) return;
    const observer = new IntersectionObserver(([entry]) => setBarInView(entry.isIntersecting));
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  const showing = visible && !dismissed && !suppressed && !barInView;
  // Counted when it is really on screen, not when the timer runs out.
  useEffect(() => {
    if (!showing || shownRef.current) return;
    shownRef.current = true;
    trackEvent("Find Your Place Popup Shown");
    recordFyp("popup_shown", {}, "/");
  }, [showing]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("prx_fyp_v1") ?? "null");
      if (saved?.results) return;
    } catch {
      // Unreadable storage: show it.
    }
    if (suppressed) return;
    const t = setTimeout(() => setVisible(true), 3000);
    return () => clearTimeout(t);
  }, [suppressed]);

  const start = (group) => {
    trackEvent("Find Your Place Popup Clicked", { group });
    recordFyp("popup_clicked", { group }, "/");
    router.push(`/find-your-place?group=${encodeURIComponent(group)}`);
  };

  return (
    <AnimatePresence>
      {showing && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 260, damping: 22 }}
          className="fixed bottom-6 right-4 z-50 w-[calc(100vw-2rem)] max-w-[320px] rounded-3xl border border-gray-200 bg-white p-5 shadow-[0_8px_32px_rgba(0,0,0,0.14)] sm:right-6"
          role="dialog"
          aria-label="Find Your Place"
        >
          <div className="flex items-center gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-gray-100" role="presentation">
              <div className="h-full w-[12%] rounded-full bg-red-600" />
            </div>
            <button
              type="button"
              onClick={() => {
                setDismissed(true);
                trackEvent("Find Your Place Popup Dismissed");
                recordFyp("popup_dismissed", {}, "/");
              }}
              className="text-gray-300 transition-colors hover:text-gray-500"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <h3 className="mt-3 text-xl font-bold text-gray-900">Find Your Place</h3>
          <p className="mt-1 text-xs leading-relaxed text-gray-600">
            Answer a few quick questions and find your perfect fit.
          </p>

          <p className="mt-4 text-[13px] font-medium text-gray-900">Group Size</p>
          <div className="mt-2 flex gap-2">
            {FYP_GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => start(g)}
                className="h-9 min-w-9 flex-1 rounded-full border border-red-300 bg-white text-sm font-medium text-red-600 transition-colors hover:bg-red-50 active:bg-red-100"
              >
                {g}
              </button>
            ))}
          </div>

        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function HomeClient({
  initialListings = null,
  initialPopular = null,
}) {
  const { data: session, update } = useSession();
  const [barEngaged, setBarEngaged] = useState(false);

  // Fix: new users who signed in via "Login as Landlord" get created as students
  // in auth.js. Detect the ?role=landlord callback param and correct it immediately.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const intendedRole = params.get("role");
    if (
      intendedRole === "landlord" &&
      session?.user?.role === "student" &&
      session?.user?.profileComplete === false
    ) {
      becomeLandlord(update)
        .then((changed) => {
          if (changed) {
            // Remove the role param from the URL without a reload
            const url = new URL(window.location.href);
            url.searchParams.delete("role");
            window.history.replaceState({}, "", url.toString());
          }
        })
        .catch(console.error);
    }
  }, [session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <HeroSection
          sideMargin={SIDE_MARGIN}
          initialPopular={initialPopular}
          allListings={initialListings}
          onBarEngage={() => setBarEngaged(true)}
        />
        <HowItWorks sideMargin={SIDE_MARGIN} />
        <HomeFaq sideMargin={SIDE_MARGIN} />
        <ReviewsCarousel />
        {/* <CollegesBand /> */}
        <CTABand />
      </main>
      <Footer />
      <FindYourPlacePopup suppressed={barEngaged} />
    </div>
  );
}
