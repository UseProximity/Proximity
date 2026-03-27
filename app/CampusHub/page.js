"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import ModalDorms from "../../components/ModalDorms";
import { AiFillStar } from "react-icons/ai";

const allDorms = [
  "Beaumont",
  "Danforth",
  "Dardick",
  "Dauten",
  "Eliot A",
  "Hurd",
  "Koenig",
  "Lee",
  "Lien",
  "Park",
  "Umrath",
  "Eliot B",
  "Gregg",
  "Hitzeman",
  "Liggett",
  "Mudd",
  "Myers",
  "Nemerov",
  "Rutledge",
  "Shanedling",
  "Shepley",
  "SoFoHo",
  "Wheeler",
  "Greenway Apartments",
  "Millbrook",
  "University Drive",
  "Village East",
  "Rosedale Apartments",
  "The Lofts",
  "Washington Ave Apartments",
  "520 Kingsland",
  "Village & Lopata House",
];

const CANONICAL_ROOM_TYPES = [
  "Modern Single",
  "Modern Double",
  "Modern Triple",
  "Traditional Single",
  "Traditional Double",
  "Traditional Triple",
  "Apartment Style",
];

function normalizeRoomType(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  for (const canonical of CANONICAL_ROOM_TYPES) {
    if (s === canonical.toLowerCase()) return canonical;
  }
  // partial matches
  if (s.includes("apartment")) return "Apartment Style";
  if (s.includes("suite")) return "Suite";
  if (s.includes("modern") && s.includes("triple")) return "Modern Triple";
  if (s.includes("modern") && s.includes("single")) return "Modern Single";
  if (s.includes("modern") && s.includes("double")) return "Modern Double";
  if (s.includes("traditional") && s.includes("triple"))
    return "Traditional Triple";
  if (s.includes("traditional") && s.includes("single"))
    return "Traditional Single";
  if (s.includes("traditional") && s.includes("double"))
    return "Traditional Double";
  if (s.includes("triple")) return "Modern Triple";
  if (s.includes("single")) return "Modern Single";
  if (s.includes("double")) return "Modern Double";
  return null;
}

const FORM_TAGS = [
  "Quiet Floor",
  "Study Floor",
  "Social Floor",
  "Historic",
  "New Building",
  "Central Location",
  "Apartment Style",
  "Modern",
  "On-Campus",
  "Off-Campus",
];

const EMPTY_FORM = {
  name: "",
  classYear: "",
  rating: 0,
  tags: [],
  content: "",
};

export default function CampusHub() {
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [ratingMin, setRatingMin] = useState(1);
  const [ratingMax, setRatingMax] = useState(5);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedDorm, setSelectedDorm] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const [allReviews, setAllReviews] = useState([]);
  const [dbReviews, setDbReviews] = useState([]);
  const [dormMeta, setDormMeta] = useState({});
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formSuccess, setFormSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/dormReviews")
      .then((r) => r.json())
      .then((data) => setAllReviews(Array.isArray(data) ? data : []))
      .catch(() => {});
    fetch("/api/dorms")
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data)) return;
        const map = {};
        data.forEach((d) => {
          map[d.name] = d;
        });
        setDormMeta(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedDorm) return;
    setDbReviews([]);
    setShowReviewForm(false);
    setForm(EMPTY_FORM);
    setFormError(null);
    setFormSuccess(false);
    fetch(`/api/dormReviews?dorm=${encodeURIComponent(selectedDorm.name)}`)
      .then((r) => r.json())
      .then((data) => setDbReviews(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [selectedDorm]);

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (
      !form.name.trim() ||
      !form.classYear ||
      !form.rating ||
      !form.content.trim()
    ) {
      setFormError("Please fill in all required fields.");
      return;
    }
    setFormSubmitting(true);
    try {
      const res = await fetch("/api/dormReviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, dorm: selectedDorm.name }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Submission failed");
      }
      const newReview = await res.json();
      setDbReviews((prev) => [newReview, ...prev]);
      setAllReviews((prev) => [newReview, ...prev]);
      setFormSuccess(true);
      setShowReviewForm(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setFormSubmitting(false);
    }
  };

  const allTags = [...new Set(allReviews.flatMap((r) => r.tags))].sort();
  const allDormTypes = CANONICAL_ROOM_TYPES.filter((type) =>
    Object.values(dormMeta).some((d) => d.roomTypes?.includes(type))
  );
  const cardRefs = useRef({});

  const dormGroups = allReviews.reduce((acc, review) => {
    if (!acc[review.dorm]) acc[review.dorm] = [];
    acc[review.dorm].push(review);
    return acc;
  }, {});

  const filteredDorms = allDorms
    .filter((dorm) => {
      const dormReviews = dormGroups[dorm] || [];
      const matchesRating =
        dormReviews.length === 0 ||
        dormReviews.some((r) => r.rating >= ratingMin && r.rating <= ratingMax);
      const matchesType =
        selectedTypes.length === 0 ||
        selectedTypes.some((t) => dormMeta[dorm]?.roomTypes?.includes(t));
      const matchesSearch =
        searchQuery === "" ||
        dorm.toLowerCase().includes(searchQuery.toLowerCase()) ||
        dormReviews.some((r) =>
          r.content.toLowerCase().includes(searchQuery.toLowerCase())
        );
      const matchesTags =
        selectedTags.length === 0 ||
        dormReviews.some((r) =>
          selectedTags.some((tag) => r.tags.includes(tag))
        );
      return matchesRating && matchesType && matchesSearch && matchesTags;
    })
    // Sort by number of reviews (desc), then by name for stable ordering
    .sort((a, b) => {
      const aCount = dormGroups[a]?.length || 0;
      const bCount = dormGroups[b]?.length || 0;
      if (bCount !== aCount) return bCount - aCount;
      return a.localeCompare(b);
    });

  const handleReset = () => {
    setSelectedTypes([]);
    setRatingMin(1);
    setRatingMax(5);
    setSearchQuery("");
    setSelectedTags([]);
  };

  const toggleTag = (tag) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const toggleDormType = (type) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const activeFilterCount =
    selectedTypes.length +
    (ratingMin > 1 || ratingMax < 5 ? 1 : 0) +
    selectedTags.length;

  const filterContent = (
    <div className="space-y-6">
      {/* Dorm Type */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Dorm Type
          </h3>
          <button
            onClick={() => setSelectedTypes([])}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear
          </button>
        </div>
        <div className="space-y-2">
          {allDormTypes.map((type) => (
            <label
              key={type}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={selectedTypes.includes(type)}
                onChange={() => toggleDormType(type)}
                className="accent-red-500 rounded"
              />
              <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">
                {type}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Rating */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Rating
        </h3>
        <div className="px-1">
          {/* Min/max labels */}
          <div className="flex justify-between mb-2">
            <span className="text-xs text-gray-600 flex items-center gap-0.5">
              {[...Array(ratingMin)].map((_, i) => (
                <AiFillStar key={i} className="text-yellow-400 text-xs" />
              ))}
            </span>
            <span className="text-xs text-gray-600 flex items-center gap-0.5">
              {[...Array(ratingMax)].map((_, i) => (
                <AiFillStar key={i} className="text-yellow-400 text-xs" />
              ))}
            </span>
          </div>
          {/* Dual-range track */}
          <div className="relative h-5">
            <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 h-1.5 rounded-full bg-gray-200 pointer-events-none">
              <div
                className="absolute h-full bg-red-400 rounded-full"
                style={{
                  left: `${((ratingMin - 1) / 4) * 100}%`,
                  right: `${((5 - ratingMax) / 4) * 100}%`,
                }}
              />
            </div>
            {/* Min thumb */}
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              value={ratingMin}
              onChange={(e) =>
                setRatingMin(Math.min(Number(e.target.value), ratingMax))
              }
              className="absolute inset-0 w-full h-full appearance-none bg-transparent cursor-pointer pointer-events-none
                [&::-webkit-slider-thumb]:pointer-events-auto
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-red-500
                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white
                [&::-webkit-slider-thumb]:shadow"
              style={{ zIndex: ratingMin >= ratingMax ? 5 : 3 }}
            />
            {/* Max thumb */}
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              value={ratingMax}
              onChange={(e) =>
                setRatingMax(Math.max(Number(e.target.value), ratingMin))
              }
              className="absolute inset-0 w-full h-full appearance-none bg-transparent cursor-pointer pointer-events-none
                [&::-webkit-slider-thumb]:pointer-events-auto
                [&::-webkit-slider-thumb]:appearance-none
                [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-red-500
                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white
                [&::-webkit-slider-thumb]:shadow"
              style={{ zIndex: 4 }}
            />
          </div>
          {/* Tick labels */}
          <div className="flex justify-between mt-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <span key={n} className="text-xs text-gray-400">
                {n}★
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Tags */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Tags
          </h3>
          <button
            onClick={() => setSelectedTags([])}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Clear
          </button>
        </div>
        <div className="space-y-2">
          {allTags.map((tag) => (
            <label
              key={tag}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={selectedTags.includes(tag)}
                onChange={() => toggleTag(tag)}
                className="accent-red-500 rounded"
              />
              <span className="text-sm text-gray-600 group-hover:text-gray-900 transition-colors">
                {tag}
              </span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  const filterSidebar = (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-6">
      {/* Search + Reset — desktop only */}
      <div className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="Search dorms or keywords..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
        />
        <button
          onClick={handleReset}
          className="w-full px-3 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          Reset
        </button>
      </div>
      {filterContent}
    </div>
  );

  // Card fade-up on scroll into view
  useEffect(() => {
    // Reset all cards to hidden whenever filteredDorms changes
    Object.values(cardRefs.current).forEach((el) => {
      if (el) {
        el.style.opacity = "0";
        el.style.transform = "translateY(24px)";
      }
    });

    const observer = new IntersectionObserver(
      (entries) => {
        let batchIndex = 0;
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.style.transitionDelay = `${batchIndex * 40}ms`;
            entry.target.style.opacity = "1";
            entry.target.style.transform = "translateY(0)";
            observer.unobserve(entry.target);
            batchIndex++;
          }
        });
      },
      { threshold: 0.1 }
    );

    Object.values(cardRefs.current).forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [filteredDorms]);

  // Prevent unwanted scrolling on filter interactions
  useEffect(() => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {
      if (
        this.tagName === "SELECT" ||
        this.tagName === "INPUT" ||
        this.tagName === "BUTTON"
      ) {
        return;
      }
      originalScrollIntoView.call(this);
    };
    return () => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    };
  }, []);

  return (
    <>
      {/* Parallax Hero Banner */}
      <div
        className="relative h-72 flex items-center justify-center text-white text-center"
        style={{
          backgroundImage: "url('/dorms/danforth.png')",
          backgroundAttachment: "fixed",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative z-10 px-4">
          <p className="text-red-300 font-semibold text-sm uppercase tracking-widest mb-2">
            Washington University in St. Louis
          </p>
          <h1 className="text-5xl font-bold mb-3">On Campus Hub</h1>
          <p className="text-white/80 text-lg max-w-xl mx-auto">
            Verified reviews from real WashU students who lived there.
          </p>
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto px-6 pb-6 md:p-6">
        {/* Mobile sticky search + filter bar */}
        <div className="lg:hidden sticky top-[83px] z-40 bg-white/95 border-b border-gray-200 -mx-6 px-4 py-2 mb-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search dorms or keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
            />
            <button
              onClick={() => setFiltersOpen(true)}
              className="relative flex items-center justify-center w-10 h-10 border border-gray-300 rounded-xl bg-white shrink-0"
            >
              <img
                src="/assets/filter-icon.svg"
                alt=""
                style={{
                  width: "18px",
                  height: "18px",
                  filter: "brightness(0) opacity(0.6)",
                }}
              />
              {activeFilterCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Mobile overlay */}
        {filtersOpen && (
          <div className="lg:hidden fixed inset-0 z-50">
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setFiltersOpen(false)}
            />
            {/* Panel — full screen with small margin */}
            <div className="absolute inset-4 bg-white rounded-2xl flex flex-col shadow-2xl">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
                <span className="font-semibold text-base">Filters</span>
                <button
                  onClick={() => setFiltersOpen(false)}
                  className="text-gray-400 hover:text-gray-600 text-xl leading-none"
                >
                  ✕
                </button>
              </div>
              {/* Scrollable content */}
              <div className="overflow-y-auto flex-1 p-5">{filterContent}</div>
              {/* Sticky footer */}
              <div className="shrink-0 border-t border-gray-100 px-5 py-4 flex gap-3">
                <button
                  onClick={() => setFiltersOpen(false)}
                  className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white font-semibold rounded-xl transition-colors text-sm"
                >
                  Search
                </button>
                <button
                  onClick={handleReset}
                  className="px-5 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors text-sm"
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          {/* Sidebar – desktop only */}
          <div className="hidden lg:block w-64 shrink-0">
            <div className="lg:sticky lg:top-6">{filterSidebar}</div>
          </div>

          {/* Dorm grid */}
          <div className="flex-1 min-w-0 w-full overflow-hidden">
            {filteredDorms.length === 0 ? (
              <p className="text-center text-gray-500 mt-12">
                No dorms match your filters.
              </p>
            ) : (
              <div className="flex flex-wrap gap-6">
                {filteredDorms.map((dorm, index) => {
                  const dormReviews = dormGroups[dorm] || [];
                  const dbRoomTypes = dormMeta[dorm]?.roomTypes;
                  const roomType = dbRoomTypes?.length
                    ? dbRoomTypes.join(" · ")
                    : "—";
                  const rawTags =
                    dormMeta[dorm]?.tags || dormReviews[0]?.tags || [];
                  const mainTags =
                    rawTags.length > 2
                      ? rawTags.slice(0, 2).join(" · ") +
                        ` +${rawTags.length - 2}`
                      : rawTags.join(" · ");
                  return (
                    <div
                      key={dorm}
                      ref={(el) => (cardRefs.current[dorm] = el)}
                      className="bg-white rounded-lg shadow cursor-pointer hover:shadow-lg hover:-translate-y-1 w-full max-w-full sm:w-[calc(50%-12px)] lg:w-[calc(33.333%-16px)] overflow-hidden"
                      style={{
                        opacity: 0,
                        transform: "translateY(24px)",
                        transition:
                          "opacity 0.5s ease, transform 0.5s ease, box-shadow 0.2s ease",
                      }}
                      onClick={() => {
                        setSelectedDorm({ name: dorm, reviews: dormReviews });
                        setModalOpen(true);
                      }}
                    >
                      <Image
                        src={
                          dormMeta[dorm]?.image
                            ? `/dorms/${dormMeta[dorm].image}`
                            : "/images/placeholder.jpeg"
                        }
                        alt={dorm}
                        width={400}
                        height={192}
                        className="w-full h-48 object-cover rounded-t-lg"
                      />
                      <div className="p-4 space-y-1">
                        {/* Row 1: name + tags */}
                        <div className="flex justify-between items-baseline gap-2">
                          <h2 className="text-lg font-bold leading-tight">
                            {dorm}
                          </h2>
                          <p className="text-sm text-gray-600 text-right shrink-0 whitespace-nowrap">
                            {mainTags}
                          </p>
                        </div>
                        {/* Row 2: type + review count */}
                        <div className="flex justify-between items-baseline gap-2">
                          <p className="text-sm text-gray-600 truncate min-w-0">
                            {roomType}
                          </p>
                          <p className="text-sm text-gray-500 shrink-0">
                            {dormReviews.length} review
                            {dormReviews.length !== 1 && "s"}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal */}
        <ModalDorms isOpen={modalOpen} onClose={() => setModalOpen(false)}>
          {selectedDorm &&
            (() => {
              const seen = new Set();
              const modalReviews = [
                ...selectedDorm.reviews,
                ...dbReviews,
              ].filter((r) => {
                const id = String(r._id);
                if (seen.has(id)) return false;
                seen.add(id);
                return true;
              });
              const avgRating = modalReviews.length
                ? (
                    modalReviews.reduce((s, r) => s + r.rating, 0) /
                    modalReviews.length
                  ).toFixed(1)
                : null;
              const dbModalTypes = dormMeta[selectedDorm.name]?.roomTypes;
              const dormType = dbModalTypes?.length
                ? dbModalTypes.join(" · ")
                : null;
              return (
                <div className="w-full">
                  {/* Header */}
                  <div className="sticky md:static top-0 bg-white z-10 -mx-6 px-6 pt-4 pb-3 mb-1 rounded-t-xl">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      {dormType ? (
                        <span className="inline-block px-2.5 py-0.5 bg-red-50 text-red-500 text-xs font-bold rounded-full uppercase tracking-widest">
                          {dormType}
                        </span>
                      ) : (
                        <span />
                      )}
                      <button
                        onClick={() => setModalOpen(false)}
                        className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-xl w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 hover:scale-110 shrink-0"
                      >
                        ×
                      </button>
                    </div>
                    <h2 className="text-2xl font-bold text-gray-900 leading-tight">
                      {selectedDorm.name}
                    </h2>
                    {avgRating && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <AiFillStar className="text-red-500 text-base" />
                        <span className="text-sm font-semibold text-gray-800">
                          {avgRating}
                        </span>
                        <span className="text-sm text-gray-400">
                          ({modalReviews.length} review
                          {modalReviews.length !== 1 ? "s" : ""})
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Image */}
                  {dormMeta[selectedDorm.name]?.image && (
                    <div className="mb-5 rounded-xl overflow-hidden">
                      <Image
                        src={`/dorms/${dormMeta[selectedDorm.name].image}`}
                        alt={selectedDorm.name}
                        width={800}
                        height={400}
                        className="w-full h-[220px] md:h-[260px] object-cover"
                        style={{ objectPosition: "center" }}
                      />
                    </div>
                  )}

                  {/* Reviews */}
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-base font-bold text-gray-900">
                      Reviews
                    </h3>
                    {modalReviews.length > 0 && (
                      <span className="text-xs text-gray-400 font-medium">
                        {modalReviews.length} total
                      </span>
                    )}
                  </div>

                  {modalReviews.length > 0 ? (
                    <div className="space-y-3">
                      {modalReviews.map((r, idx) => {
                        const dateLabel =
                          r.date ||
                          (r.createdAt
                            ? new Date(r.createdAt).toLocaleDateString(
                                "en-US",
                                { month: "long", year: "numeric" }
                              )
                            : "");
                        return (
                          <div
                            key={r._id || idx}
                            className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm"
                          >
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2.5">
                                <div className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center flex-shrink-0">
                                  <span className="text-xs font-bold text-red-500">
                                    {r.name[0]}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-sm font-semibold text-gray-900">
                                    {r.name}
                                  </span>
                                  <span className="text-xs text-gray-400 ml-1.5">
                                    Class of {r.classYear}
                                  </span>
                                </div>
                              </div>
                              <div className="flex gap-0.5 flex-shrink-0">
                                {[1, 2, 3, 4, 5].map((s) => (
                                  <AiFillStar
                                    key={s}
                                    className={
                                      s <= r.rating
                                        ? "text-red-500"
                                        : "text-gray-200"
                                    }
                                  />
                                ))}
                              </div>
                            </div>
                            <p className="text-sm text-gray-700 leading-relaxed mb-3">
                              {r.content}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {r.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full"
                                >
                                  {tag}
                                </span>
                              ))}
                              <span className="ml-auto text-xs text-gray-400">
                                {dateLabel}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-gray-400 text-sm bg-gray-50 rounded-xl">
                      No reviews yet. Be the first to leave one!
                    </div>
                  )}

                  {/* Add Review */}
                  <div className="mt-6">
                    {formSuccess && (
                      <div className="mb-3 px-4 py-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-xl">
                        Thanks for your review!
                      </div>
                    )}
                    {!showReviewForm ? (
                      <button
                        onClick={() => {
                          setShowReviewForm(true);
                          setFormSuccess(false);
                        }}
                        className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm font-semibold text-gray-500 hover:border-red-300 hover:text-red-500 transition-colors duration-150"
                      >
                        + Add a Review
                      </button>
                    ) : (
                      <form
                        onSubmit={handleFormSubmit}
                        className="border border-gray-200 rounded-xl p-5 space-y-4 bg-gray-50"
                      >
                        <h4 className="text-sm font-bold text-gray-900">
                          Write a Review
                        </h4>

                        {/* Name + Class Year */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-semibold text-gray-600 mb-1 block">
                              First Name *
                            </label>
                            <input
                              type="text"
                              value={form.name}
                              onChange={(e) =>
                                setForm((f) => ({ ...f, name: e.target.value }))
                              }
                              placeholder="e.g. Alex"
                              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-red-300"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-semibold text-gray-600 mb-1 block">
                              Class Year *
                            </label>
                            <select
                              value={form.classYear}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  classYear: e.target.value,
                                }))
                              }
                              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-red-300"
                            >
                              <option value="">Select…</option>
                              {[2025, 2026, 2027, 2028, 2029, 2030].map((y) => (
                                <option key={y} value={y}>
                                  {y}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Rating */}
                        <div>
                          <label className="text-xs font-semibold text-gray-600 mb-1 block">
                            Rating *
                          </label>
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() =>
                                  setForm((f) => ({ ...f, rating: s }))
                                }
                                className="text-2xl transition-transform hover:scale-110"
                              >
                                <AiFillStar
                                  className={
                                    s <= form.rating
                                      ? "text-red-500"
                                      : "text-gray-200"
                                  }
                                />
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Tags */}
                        <div>
                          <label className="text-xs font-semibold text-gray-600 mb-2 block">
                            Tags
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {FORM_TAGS.map((tag) => {
                              const active = form.tags.includes(tag);
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() =>
                                    setForm((f) => ({
                                      ...f,
                                      tags: active
                                        ? f.tags.filter((t) => t !== tag)
                                        : [...f.tags, tag],
                                    }))
                                  }
                                  className={`px-2.5 py-1 text-xs font-medium rounded-full border transition-colors duration-100 ${
                                    active
                                      ? "bg-red-500 text-white border-red-500"
                                      : "bg-white text-gray-600 border-gray-200 hover:border-red-300"
                                  }`}
                                >
                                  {tag}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Review text */}
                        <div>
                          <label className="text-xs font-semibold text-gray-600 mb-1 block">
                            Your Review *
                          </label>
                          <textarea
                            value={form.content}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                content: e.target.value,
                              }))
                            }
                            placeholder="Share your experience living here…"
                            rows={3}
                            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:border-red-300 resize-none"
                          />
                        </div>

                        {formError && (
                          <p className="text-xs text-red-500">{formError}</p>
                        )}

                        <div className="flex gap-2 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setShowReviewForm(false);
                              setFormError(null);
                            }}
                            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={formSubmitting}
                            className="px-5 py-2 text-sm font-semibold bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors disabled:opacity-50"
                          >
                            {formSubmitting ? "Submitting…" : "Submit Review"}
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                </div>
              );
            })()}
        </ModalDorms>
      </div>
    </>
  );
}
