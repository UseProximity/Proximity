"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import Image from "next/image";
import {
  Phone,
  Mail,
  ThumbsUp,
  ThumbsDown,
  PersonStanding,
  Bus,
} from "lucide-react";
import toast from "react-hot-toast";
import { signIn } from "next-auth/react";
import HeartIcon from "@/components/ui/HeartIcon";
import ListingMap from "@/components/listings/ListingMap";
import {
  getAreaRangeLabel,
  getRentRangeLabel,
  getUnitValuesLabel,
  calcAge,
} from "@/utils/listingFormatters";
import { WASHU_PLACES } from "@/utils/washuPlaces";
import { trackEvent } from "@/utils/analytics";

// Scroll `el` into view within its nearest scrollable ancestor; falls back to
// window-level scrollIntoView so it works in both modals and full-page views.
function scrollIntoContainer(el) {
  if (!el) return;
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const cs = window.getComputedStyle(parent);
    if (/auto|scroll/.test(cs.overflowY) && parent.scrollHeight > parent.clientHeight) {
      const elTop = el.getBoundingClientRect().top;
      const parentTop = parent.getBoundingClientRect().top;
      parent.scrollBy({ top: elTop - parentTop, behavior: "smooth" });
      return;
    }
    parent = parent.parentElement;
  }
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ─── Static Data ─────────────────────────────────────────────────────────────

const leaseAvailabilityMap = {
  "10_month": "10 Month",
  "12_month": "12 Month",
  "10-month": "10 Month",
  "12-month": "12 Month",
  semester: "Semester",
  summer: "Summer",
};

function formatLeaseAvailability(val) {
  if (!val) return "—";
  const arr = Array.isArray(val) ? val : [val];
  if (arr.length === 0) return "—";
  return arr.map((v) => leaseAvailabilityMap[v] || v).join(" · ");
}

function LeaseStatCell({ leaseAvailability }) {
  const [open, setOpen] = useState(false);
  const arr = Array.isArray(leaseAvailability)
    ? leaseAvailability.filter(Boolean)
    : leaseAvailability ? [leaseAvailability] : [];
  const labels = arr.map((v) => leaseAvailabilityMap[v] || v);

  if (labels.length === 0) {
    return (
      <div className="flex-1 px-4 py-3 text-center min-w-[80px]">
        <div className="text-sm sm:text-lg font-semibold text-gray-900">—</div>
        <div className="text-xs text-gray-500 mt-0.5">Lease</div>
      </div>
    );
  }

  if (labels.length === 1) {
    return (
      <div className="flex-1 px-4 py-3 text-center min-w-[80px]">
        <div className="text-sm sm:text-lg font-semibold text-gray-900">{labels[0]}</div>
        <div className="text-xs text-gray-500 mt-0.5">Lease</div>
      </div>
    );
  }

  return (
    <div className="flex-1 px-4 py-3 text-center min-w-[80px] relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex flex-col items-center gap-0.5 group"
      >
        <span className="text-sm sm:text-lg font-semibold text-gray-900 leading-tight">
          {labels[0]}
        </span>
        <span className="text-[11px] font-medium text-red-500 group-hover:text-red-600 transition-colors">
          +{labels.length - 1} more
        </span>
      </button>
      <div className="text-xs text-gray-500 mt-0.5">Lease</div>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-md py-1.5 min-w-[120px] text-center">
            {labels.map((l) => (
              <div key={l} className="text-xs text-gray-700 px-3 py-1">
                {l}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}


const TABS = [
  { id: "amenities", label: "Overview" },
  { id: "details", label: "Details" },
  { id: "map", label: "Map" },
  { id: "places", label: "Places" },
  { id: "reviews", label: "Reviews" },
  { id: "contact", label: "Contact Manager" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseAddress(addressStr) {
  const ci = addressStr?.indexOf(",") ?? -1;
  if (ci !== -1)
    return {
      street: addressStr.slice(0, ci).trim(),
      cityStateZip: addressStr.slice(ci + 1).trim(),
    };
  return { street: addressStr || "", cityStateZip: "" };
}

function StarRow({ label, value, onChange, readOnly = false }) {
  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="text-sm text-gray-600 w-32 shrink-0">{label}</span>
      )}
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            disabled={readOnly}
            onClick={() => !readOnly && onChange?.(star)}
            className={`text-xl transition ${
              star <= value
                ? "text-red-500"
                : "text-gray-300 hover:text-red-300"
            } ${readOnly ? "cursor-default" : "cursor-pointer"}`}
            aria-label={
              readOnly ? undefined : `Rate ${star} star${star > 1 ? "s" : ""}`
            }
          >
            ★
          </button>
        ))}
      </div>
      {!readOnly && (
        <span className="text-xs text-gray-400">
          {value ? `${value}/5` : "Select"}
        </span>
      )}
    </div>
  );
}

function decodeHtml(str) {
  if (typeof document === "undefined" || !str) return str;
  const el = document.createElement("textarea");
  el.innerHTML = str;
  return el.value;
}

function AmenityPill({ label }) {
  return (
    <span className="inline-block bg-gray-100 text-gray-700 text-sm font-medium px-3 py-1 rounded-full border border-gray-200">
      {decodeHtml(label)}
    </span>
  );
}

function StatCell({ label, value }) {
  return (
    <div className="flex-1 px-4 py-3 text-center min-w-[80px]">
      <div className="text-sm sm:text-lg font-semibold text-gray-900 break-words">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

// ─── Tab: Amenities ───────────────────────────────────────────────────────────

// Keys are the boolean column names from listing_amenities / listing_utilities.
const AMENITY_LABELS = {
  air_conditioning: "Air Conditioning",
  dishwasher:       "Dishwasher",
  gym:              "Gym",
  laundry:          "Laundry",
  mailroom:         "Mailroom",
  microwave:        "Microwave",
  oven:             "Oven",
  parking:          "Parking",
  pets_allowed:     "Pets Allowed",
  pool:             "Pool",
  refrigerator:     "Refrigerator",
  rooftop:          "Rooftop",
  storage:          "Storage",
  stove:            "Stove",
  study_room:       "Study Room",
};

const UTILITY_LABELS = {
  electric: "Electric",
  gas:      "Gas",
  heat:     "Heat",
  water:    "Water",
  internet: "Internet",
  trash:    "Trash",
  cable:    "Cable",
  sewer:    "Sewer",
  cooling:  "Cooling",
};

function toTitleCase(str) {
  return str
    .replace(/_/g, " ")
    .replace(/-/g, "-")
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

function AmenitiesTab({ listing }) {
  const amenities = [...new Set(
    (listing.amenities || [])
      .map((a) => AMENITY_LABELS[a] || AMENITY_LABELS[a?.toLowerCase()])
      .filter(Boolean)
  )];
  const utilities = [...new Set(
    (listing.utilitiesIncluded || [])
      .map((u) => UTILITY_LABELS[u] || UTILITY_LABELS[u?.toLowerCase()])
      .filter(Boolean)
  )];
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Amenities</h2>
      {amenities.length === 0 ? (
        <p className="text-gray-400 text-sm italic mb-6">
          No amenities listed for this property.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-6">
          {amenities.map((a) => (
            <AmenityPill key={a} label={a} />
          ))}
        </div>
      )}
      {utilities.length > 0 && (
        <>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">Utilities Included</h2>
          <div className="flex flex-wrap gap-2 mb-6">
            {utilities.map((u) => (
              <AmenityPill key={u} label={u} />
            ))}
          </div>
        </>
      )}
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Overview</h2>
      <div className="space-y-2">
        {decodeHtml(listing.description || "")
          .split("\n")
          .map((line, i) => {
            if (line.trim() === "<br>") {
              return <br key={i} />;
            }
            if (line.startsWith("#")) {
              return (
                <p key={i} className="text-gray-700 leading-relaxed font-bold">
                  {line.replace(/^#+\s*/, "")}
                </p>
              );
            }
            if (!line.trim()) return null;
            return (
              <p key={i} className="text-gray-700 leading-relaxed">
                {line}
              </p>
            );
          })}
      </div>
    </div>
  );
}

// ─── Tab: Map ─────────────────────────────────────────────────────────────────

function MapTab({ listing }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Location</h2>
      <ListingMap
        latitude={listing.latitude}
        longitude={listing.longitude}
        address={listing.address}
      />
    </div>
  );
}

// ─── Tab: Places ─────────────────────────────────────────────────────────────

function PlacesTab({ walkTimes, walkLoading, shuttleWalkMinutes }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Nearby Places
      </h2>
      <ul className="space-y-3">
        {[...WASHU_PLACES]
          .sort((a, b) => {
            const aMin = walkTimes[a.name] ?? Infinity;
            const bMin = walkTimes[b.name] ?? Infinity;
            return aMin - bMin;
          })
          .map((p) => (
            <li
              key={p.name}
              className="flex items-center gap-3 text-gray-700 py-2 border-b border-gray-100 last:border-0"
            >
              <PersonStanding size={18} className="text-red-400 shrink-0" />
              <span className="flex-1">{p.name}</span>
              <span className="text-sm text-gray-500 font-medium">
                {walkLoading
                  ? "..."
                  : walkTimes[p.name] != null
                  ? `${walkTimes[p.name]} min walk`
                  : "N/A"}
              </span>
            </li>
          ))}
      </ul>
      <div className="mt-4 pt-4 border-t border-gray-200">
        <div className="flex items-center gap-3 text-gray-700 py-2">
          <Bus size={18} className="text-red-400 shrink-0" />
          <span className="flex-1">Nearest Shuttle Stop</span>
          <span className="text-sm text-gray-500 font-medium">
            {shuttleWalkMinutes != null
              ? `${shuttleWalkMinutes} min walk`
              : "N/A"}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Auth Gate ───────────────────────────────────────────────────────────────

function SignInPrompt({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-6">
      <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-7 w-7 text-red-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.8}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
      </div>
      <div>
        <p className="text-gray-800 font-semibold text-base mb-1">{message}</p>
        <p className="text-gray-400 text-sm">
          Create a free account or sign in to continue.
        </p>
      </div>
      <button
        onClick={() => signIn("google", { callbackUrl: window.location.href })}
        className="flex items-center gap-3 bg-white border border-gray-200 shadow-sm hover:shadow-md text-gray-700 text-sm font-medium px-5 py-2.5 rounded-lg transition"
      >
        <img
          src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
          alt="Google"
          className="w-5 h-5"
        />
        Continue with Google
      </button>
    </div>
  );
}

// ─── Tab: Reviews ─────────────────────────────────────────────────────────────

function ReviewsTab({
  legitimateReviews,
  overallAvg,
  starCounts,
  commAvg,
  locAvg,
  valAvg,
  showAllReviews,
  setShowAllReviews,
  session,
  listing,
  reviewText,
  setReviewText,
  rating,
  setRating,
  commRating,
  setCommRating,
  locRating,
  setLocRating,
  valRating,
  setValRating,
  reviewLoading,
  handleReviewSubmit,
}) {
  const maxCount = Math.max(...starCounts.map((d) => d.count), 1);
  const displayed = showAllReviews
    ? legitimateReviews
    : legitimateReviews.slice(0, 4);

  // Local vote overrides: { [reviewId]: { upvotes: number, downvotes: number, userVote: 'up'|'down'|null } }
  const [voteOverrides, setVoteOverrides] = useState({});

  async function handleVote(reviewId, vote) {
    if (!session?.user) return;
    try {
      const res = await fetch("/api/reviewVote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, vote }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setVoteOverrides((prev) => ({ ...prev, [reviewId]: data }));
    } catch { /* ignore */ }
  }

  const userId = session?.user?.id;

  return (
    <div>
      {/* Overall rating header */}
      <div className="flex flex-col md:flex-row gap-6 mb-8">
        {/* Left: overall + bar chart */}
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            {overallAvg ? (
              <>
                <span className="text-3xl font-bold text-red-500">
                  {overallAvg}
                </span>
                <span className="text-gray-500 text-base font-normal ml-1">
                  / 5 Stars ★
                </span>
              </>
            ) : (
              "No reviews yet"
            )}
          </h2>
          <div className="space-y-1.5">
            {starCounts.map(({ star, count }) => (
              <div key={star} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-4 text-right">
                  {star}
                </span>
                <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-red-400 h-2 rounded-full transition-all"
                    style={{ width: `${(count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-400 w-4">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: category averages */}
        {(commAvg || locAvg || valAvg) && (
          <div className="flex flex-row md:flex-col justify-around md:justify-start gap-4 md:gap-3 md:pl-6 md:border-l border-gray-100">
            {[
              { label: "Communication", value: commAvg },
              { label: "Location", value: locAvg },
              { label: "Value", value: valAvg },
            ]
              .filter((c) => c.value)
              .map((c) => (
                <div key={c.label} className="text-center md:text-left">
                  <div className="text-xl font-bold text-gray-900">
                    {c.value}
                  </div>
                  <div className="text-xs text-gray-500">{c.label}</div>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Review cards */}
      {legitimateReviews.length === 0 ? (
        <div className="text-center py-10 text-gray-400 italic text-sm">
          No verified reviews yet. Be the first to share your experience!
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {displayed.map((review, i) => {
              const date = review.createdAt
                ? new Date(review.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : null;
              return (
                <div
                  key={i}
                  className="border border-gray-100 rounded-xl p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <img
                        src={
                          review.reviewer?.image?.trim()
                            ? review.reviewer.image
                            : "/default-icons/default-user.png"
                        }
                        alt={review.reviewer?.name || "Anonymous"}
                        className="w-8 h-8 rounded-full object-cover"
                      />
                      <div>
                        <div className="text-sm font-semibold text-gray-900">
                          {review.reviewer?.name || "Anonymous"}
                        </div>
                        {date && (
                          <div className="text-xs text-gray-400">{date}</div>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <span
                          key={s}
                          className={
                            s <= review.rating
                              ? "text-red-500 text-sm"
                              : "text-gray-200 text-sm"
                          }
                        >
                          ★
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-gray-700 text-sm leading-relaxed mb-3">
                    {review.comment}
                  </p>
                  <div className="flex gap-4 text-xs text-gray-400">
                    {(() => {
                      const override = voteOverrides[review._id];
                      const upCount = override ? override.upvotes : (review.upvotes ?? 0);
                      const downCount = override ? override.downvotes : (review.downvotes ?? 0);
                      const userVote = override
                        ? override.userVote
                        : review.userVote ?? null;
                      return (
                        <>
                          <button
                            type="button"
                            onClick={() => handleVote(review._id, "up")}
                            className={`flex items-center gap-1 transition ${userVote === "up" ? "text-green-500" : "hover:text-green-500"}`}
                          >
                            <ThumbsUp size={13} /> <span>{upCount}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleVote(review._id, "down")}
                            className={`flex items-center gap-1 transition ${userVote === "down" ? "text-red-500" : "hover:text-red-500"}`}
                          >
                            <ThumbsDown size={13} /> <span>{downCount}</span>
                          </button>
                        </>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>

          {legitimateReviews.length > 4 && (
            <div className="flex justify-center mb-6">
              <button
                type="button"
                onClick={() => setShowAllReviews((v) => !v)}
                className="bg-black text-white text-sm font-medium px-8 py-2.5 rounded-full hover:bg-gray-800 transition"
              >
                {showAllReviews ? "Show Less" : "View More"}
              </button>
            </div>
          )}
        </>
      )}

      {/* Leave a Review form */}
      <div className="border-t border-gray-100 pt-6 mt-4">
        {session?.user?.email?.endsWith("@wustl.edu") ? (
          <>
            <h3 className="text-base font-semibold text-gray-900 mb-4">
              Leave a Review
            </h3>
            <form onSubmit={handleReviewSubmit} className="space-y-4">
              <StarRow label="Overall" value={rating} onChange={setRating} />
              <StarRow
                label="Communication"
                value={commRating}
                onChange={setCommRating}
              />
              <StarRow label="Location" value={locRating} onChange={setLocRating} />
              <StarRow label="Value" value={valRating} onChange={setValRating} />
              <textarea
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                placeholder="Leave a review..."
                rows={4}
                maxLength={1000}
                className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-500 transition resize-none"
              />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={
                    reviewLoading ||
                    !reviewText.trim() ||
                    reviewText.trim().length < 5 ||
                    rating === 0
                  }
                  className="bg-red-600 text-white text-sm font-medium px-6 py-2 rounded-full shadow hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {reviewLoading ? "Posting..." : "Post"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
            Reviews are only open to verified WashU students. Please sign in with your{" "}
            <span className="font-semibold">@wustl.edu</span> Google account.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tab: Contact Manager ─────────────────────────────────────────────────────

function ContactTab({
  listing,
  session,
  contactForm,
  setContactForm,
  handleContactSubmit,
  contactLoading,
  contactSent,
}) {
  const [ageStatus, setAgeStatus] = useState(listing.twentyOnePlus ? "loading" : "ok");

  useEffect(() => {
    if (!listing.twentyOnePlus) return;
    fetch("/api/getUser")
      .then((r) => r.json())
      .then((data) => {
        if (!data.birthday) {
          setAgeStatus("no_birthday");
        } else {
          setAgeStatus(calcAge(data.birthday) >= 21 ? "ok" : "too_young");
        }
      })
      .catch(() => setAgeStatus("ok"));
  }, [listing.twentyOnePlus]);

  if (listing.twentyOnePlus && ageStatus === "loading") {
    return <div className="py-8 text-center text-sm text-gray-400">Verifying eligibility...</div>;
  }

  if (listing.twentyOnePlus && ageStatus === "no_birthday") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        This property requires residents to be 21+. Please add your birthday in your{" "}
        <a href="/dashboard/student" className="underline font-medium">
          profile settings
        </a>{" "}
        to verify your age.
      </div>
    );
  }

  if (listing.twentyOnePlus && ageStatus === "too_young") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        This property requires residents to be 21 or older.
      </div>
    );
  }

  const owner = listing.owner;

  const handleChange = (field) => (e) =>
    setContactForm((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="max-w-xl">
      {contactSent ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-green-700 text-sm font-medium">
          Your message was sent! The property manager will be in touch soon.
        </div>
      ) : (
        <form onSubmit={handleContactSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                First Name *
              </label>
              <input
                type="text"
                required
                value={contactForm.firstName}
                onChange={handleChange("firstName")}
                placeholder="Jane"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 transition"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">
                Last Name *
              </label>
              <input
                type="text"
                required
                value={contactForm.lastName}
                onChange={handleChange("lastName")}
                placeholder="Doe"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 transition"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">
              Email *
            </label>
            <input
              type="email"
              required
              value={contactForm.email}
              onChange={handleChange("email")}
              placeholder="jane@example.com"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 transition"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">
              Phone Number
            </label>
            <input
              type="tel"
              value={contactForm.phone}
              onChange={handleChange("phone")}
              placeholder="(123) 456-7890"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 transition"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">
              Message *
            </label>
            <textarea
              required
              rows={4}
              value={contactForm.message}
              onChange={handleChange("message")}
              placeholder="I'm interested in touring this location!"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 transition resize-none"
            />
          </div>
          <button
            type="submit"
            disabled={contactLoading}
            className="w-full bg-red-600 text-white font-medium text-sm py-2.5 rounded-lg hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {contactLoading ? "Sending..." : "Send Message"}
          </button>
        </form>
      )}
    </div>
  );
}

function GalleryImage({ src, index, onImageLoad, onClick }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div
      className={`relative mb-4 break-inside-avoid rounded-lg overflow-hidden bg-gray-800/20${onClick ? " cursor-zoom-in" : ""}`}
      onClick={onClick}
    >
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center min-h-[120px]">
          <svg
            className="animate-spin h-8 w-8 text-white/70"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        </div>
      )}
      <Image
        src={src}
        alt={`Listing photo ${index + 1}`}
        width={1200}
        height={900}
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        className={`w-full h-auto block rounded-lg shadow transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        loading="lazy"
        onLoad={() => { setLoaded(true); onImageLoad(src); }}
      />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ListingModalInfo({ session, listing, excludeTabs = [], compact = false }) {
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [activeTab, setActiveTab] = useState("amenities");

  // Esc closes gallery overlay (only when lightbox is not open — lightbox takes priority)
  useEffect(() => {
    if (!isGalleryOpen) return;
    const handler = (e) => { if (e.key === "Escape" && !lightboxSrc) setIsGalleryOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isGalleryOpen, lightboxSrc]);

  // Esc closes lightbox
  useEffect(() => {
    if (!lightboxSrc) return;
    const handler = (e) => { if (e.key === "Escape") setLightboxSrc(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxSrc]);

  // Review form state
  const [reviewText, setReviewText] = useState("");
  const [rating, setRating] = useState(0);
  const [commRating, setCommRating] = useState(0);
  const [locRating, setLocRating] = useState(0);
  const [valRating, setValRating] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);

  // Walk times — read from pre-computed DB values (populated at listing creation)
  const walkLoading = false;
  const storedTimes = listing?.placeWalkMinutes;
  const walkTimes = useMemo(() => storedTimes ?? {}, [storedTimes]);

  // Contact form state
  const [contactForm, setContactForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    message: "",
  });
  const [contactLoading, setContactLoading] = useState(false);
  const [contactSent, setContactSent] = useState(false);

  // Hero image loading state
  const [heroImageLoaded, setHeroImageLoaded] = useState(false);
  const heroImgWrapperRef = useRef(null);
  useEffect(() => {
    if (!heroImgWrapperRef.current) return;
    const img = heroImgWrapperRef.current.querySelector("img");
    if (img?.complete && img.naturalWidth > 0) setHeroImageLoaded(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Unit selector — sorted ascending by beds, then baths, then disambiguation index
  const [selectedUnitIdx, setSelectedUnitIdx] = useState(0);

  // sortedUnits: [{origIdx, label}] sorted ascending by beds → baths → dup number
  // Studios (0 beds) are labelled "Studio" and not sorted by baths within the group
  // Units with identical beds, baths, rent, and area are deduplicated — only the first is kept.
  const sortedUnits = useMemo(() => {
    const units = listing.unitTypes ?? [];
    const isStudio = (u) => (u.bedrooms ?? 0) === 0;

    // Deduplicate: if two units share the same beds, baths, rent, and area they are identical
    const seen = new Set();
    const deduped = units.filter((u) => {
      const key = `${u.bedrooms ?? ""}|${u.bathrooms ?? ""}|${u.rent ?? ""}|${u.area ?? ""}|${u.leaseType ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Build base labels in original order for stable disambiguation numbering
    const baseLabelOf = deduped.map((u) => {
      if (isStudio(u)) return "Studio";
      const beds = u.bedrooms != null ? `${u.bedrooms} Bed` : "? Bed";
      const baths = u.bathrooms != null ? `${u.bathrooms} Bath` : "? Bath";
      return `${beds} / ${baths}`;
    });
    const counts = {};
    for (const lbl of baseLabelOf) counts[lbl] = (counts[lbl] || 0) + 1;
    const counters = {};
    const labels = baseLabelOf.map((lbl) => {
      if (counts[lbl] > 1) {
        counters[lbl] = (counters[lbl] || 0) + 1;
        return { base: lbl, num: counters[lbl], label: `${lbl} (${counters[lbl]})` };
      }
      return { base: lbl, num: 0, label: lbl };
    });
    return deduped
      .map((u, i) => ({ unit: u, origIdx: i, ...labels[i] }))
      .sort((a, b) => {
        const bedDiff = (a.unit.bedrooms ?? 0) - (b.unit.bedrooms ?? 0);
        if (bedDiff !== 0) return bedDiff;
        // Studios: don't sort by baths, only by dup number
        if (isStudio(a.unit)) return a.num - b.num;
        const bathDiff = (a.unit.bathrooms ?? 0) - (b.unit.bathrooms ?? 0);
        if (bathDiff !== 0) return bathDiff;
        return a.num - b.num;
      });
  }, [listing.unitTypes]);

  const selectedUnit = sortedUnits[selectedUnitIdx]?.unit ?? null;

  // ── P1 listing extras (pet policy, fees, concessions, faqs, conflict count) ──
  const [listingExtras, setListingExtras] = useState(null);
  const [conflictCount, setConflictCount] = useState(0);

  useEffect(() => {
    const id = listing?._id || listing?.id;
    if (!id) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/landlord/listings/${id}/pet-policy`).then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch(`/api/landlord/listings/${id}/fees`).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/landlord/listings/${id}/concessions`).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/landlord/listings/${id}/faqs`).then((r) => r.ok ? r.json() : []).catch(() => []),
      fetch(`/api/listings/${id}/conflicts`).then((r) => r.ok ? r.json() : {}).catch(() => {}),
    ]).then(([petPolicy, fees, concessions, faqs, conflicts]) => {
      if (cancelled) return;
      setListingExtras({ petPolicy, fees: fees ?? [], concessions: concessions ?? [], faqs: faqs ?? [] });
      setConflictCount(conflicts?.active_count ?? (Array.isArray(conflicts) ? conflicts.length : 0));
    });
    return () => { cancelled = true; };
  }, [listing?._id, listing?.id]);

  // Images — put any image with "main" in the filename first
  const sanitizeUrl = (url) => url?.replace(/ /g, "%20") ?? url;
  const images = (() => {
    const raw = Array.isArray(listing?.images)
      ? listing.images.filter(Boolean).map(sanitizeUrl)
      : [];
    const mainIdx = raw.findIndex((url) =>
      /main/i.test(url.split("/").pop().split("?")[0])
    );
    if (mainIdx > 0) {
      const reordered = [...raw];
      reordered.unshift(reordered.splice(mainIdx, 1)[0]);
      return reordered;
    }
    return raw;
  })();
  const coverImage = images[0];
  const secondImage = images[1] || images[0] || null;
  const thirdImage = images[2] || images[1] || images[0] || null;

  // Address
  const { street, cityStateZip: parsedCityStateZip } = parseAddress(listing.address);
  const cityStateZip = (listing.title && listing.title !== street) ? listing.address : parsedCityStateZip;

  // Reviews
  const legitimateReviews = (listing.reviews || [])
    .filter(Boolean)
    .filter((r) => r.legitimacy);
  const overallAvg = legitimateReviews.length
    ? (
        legitimateReviews.reduce((s, r) => s + r.rating, 0) /
        legitimateReviews.length
      ).toFixed(1)
    : null;
  const starCounts = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: legitimateReviews.filter((r) => Math.round(r.rating) === star)
      .length,
  }));
  function categoryAvg(field) {
    const vals = legitimateReviews
      .map((r) => r[field])
      .filter((v) => v != null);
    return vals.length
      ? (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1)
      : null;
  }
  const commAvg = categoryAvg("communicationRating");
  const locAvg = categoryAvg("locationRating");
  const valAvg = categoryAvg("valueRating");

  // Handlers
  const handleReviewSubmit = async (e) => {
    e.preventDefault();
    if (reviewLoading) return;

    if (!session) {
      signIn(undefined, { callbackUrl: "/browse" });
      return;
    }
    if (!["student", "super"].includes(session.user.role)) {
      toast.error("Only students can leave reviews.");
      return;
    }
    if (reviewText.trim().length < 5 || rating < 1 || rating > 5) {
      toast.error("Please write a valid review and select an overall rating.");
      return;
    }

    try {
      setReviewLoading(true);
      const res = await fetch("/api/submitReview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating,
          comment: reviewText.trim(),
          listingId: listing._id,
          communicationRating: commRating || null,
          locationRating: locRating || null,
          valueRating: valRating || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || "Failed to submit review.");
        return;
      }
      toast.success(
        "Review submitted! It will appear after landlord approval."
      );
      setReviewText("");
      setRating(0);
      setCommRating(0);
      setLocRating(0);
      setValRating(0);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setReviewLoading(false);
    }
  };

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    if (!session) {
      signIn(undefined, { callbackUrl: window.location.href });
      return;
    }
    setContactLoading(true);
    try {
      const res = await fetch("/api/contactLandlord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...contactForm,
          listingId: listing._id,
          landlordEmail: listing.contactEmail ?? listing.owner?.email,
          landlordName: listing.contactName ?? listing.owner?.name,
          listingAddress: listing.address,
        }),
      });
      if (res.ok) {
        fetch("/api/contacted", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId: listing._id }),
        });
        setTimeout(() => trackEvent("contact_submit", { listingId: listing._id, address: listing.address }), 0);
        setContactSent(true);
      } else {
        toast.error("Failed to send message. Please try again.");
      }
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setContactLoading(false);
    }
  };

  return (
    <>
      <div className={`bg-gray-50${compact ? "" : " min-h-screen"}`}>
        <div className={`max-w-7xl mx-auto px-4 ${compact ? "pt-4 pb-8" : "py-8"}`}>
          {/* ── Photo Grid ── */}
          <div className={`relative flex flex-col md:flex-row gap-2 mb-6 rounded-xl overflow-hidden ${compact ? "md:h-[300px]" : "md:h-[520px]"}`}>
            {/* Main image — natural width on desktop (no crop, no whitespace) */}
            <div
              ref={heroImgWrapperRef}
              className="relative cursor-pointer bg-gray-100 rounded-tl-xl rounded-tr-xl md:rounded-tr-none md:rounded-bl-xl overflow-hidden md:flex-shrink-0 md:w-[65%] aspect-[4/3] md:aspect-auto"
              onClick={() => images.length > 0 && setIsGalleryOpen(true)}
            >
              {coverImage ? (
                <>
                  {!heroImageLoaded && (
                    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-red-600" />
                    </div>
                  )}
                  <Image
                    src={coverImage}
                    alt={listing.address}
                    fill
                    priority
                    sizes="(max-width: 768px) 100vw, 65vw"
                    className="object-cover"
                    onLoad={() => setHeroImageLoaded(true)}
                  />
                </>
              ) : (
                <div className="w-full aspect-[4/3] md:aspect-auto md:h-full md:w-[400px] bg-gray-200 flex items-center justify-center text-gray-400 text-sm">
                  No photos available
                </div>
              )}
              {/* HeartIcon — shown in modal (mobile); desktop panel has its own header */}
              {!compact && (
                <div
                  className="absolute top-3 right-3 bg-white/90 backdrop-blur-md rounded-full p-2 shadow-xl border border-white/50 z-10"
                  onClick={(e) => e.stopPropagation()}
                >
                  <HeartIcon listingId={listing._id} />
                </div>
              )}
            </div>

            {/* Two stacked thumbnails — fill remaining width, desktop only */}
            <motion.div
              className="hidden md:flex flex-1 flex-col gap-2 min-w-[180px]"
              initial={compact ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.28, duration: 0.38, ease: "easeOut" }}
            >
              {/* Top thumbnail */}
              <div
                className="relative flex-1 cursor-pointer overflow-hidden rounded-tr-xl bg-gray-100"
                onClick={() => setIsGalleryOpen(true)}
              >
                {secondImage ? (
                  <Image
                    src={secondImage}
                    alt="Listing photo 2"
                    fill
                    sizes="(max-width: 768px) 0vw, 35vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-200" />
                )}
              </div>
              {/* Bottom thumbnail */}
              <div
                className="relative flex-1 cursor-pointer overflow-hidden rounded-br-xl bg-gray-100"
                onClick={() => setIsGalleryOpen(true)}
              >
                {thirdImage ? (
                  <Image
                    src={thirdImage}
                    alt="Listing photo 3"
                    fill
                    sizes="(max-width: 768px) 0vw, 35vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-300" />
                )}
              </div>
            </motion.div>

            {/* Always-visible "See all photos" button */}
            {images.length > 0 && (
              <button
                onClick={() => setIsGalleryOpen(true)}
                className="absolute bottom-4 right-4 z-20 text-white font-semibold text-sm bg-black/30 px-3 py-1.5 rounded-full hover:bg-black/50 transition"
              >
                See all photos ({images.length})
              </button>
            )}
          </div>

          <motion.div
            initial={compact ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.22, duration: 0.4, ease: "easeOut" }}
          >

          {/* ── Header Info ── */}
          {listing.unavailable && (
            <div className="bg-gray-100 border border-gray-300 rounded-xl px-6 py-3 mb-4 flex items-center gap-2 text-gray-600 text-sm font-medium">
              <span className="inline-block w-2 h-2 rounded-full bg-gray-400 shrink-0" />
              This listing is currently unavailable
            </div>
          )}
          <div className="bg-white rounded-xl shadow px-6 py-5 mb-4 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
            <div>
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900 leading-snug">{listing.title || street}</h1>
              {cityStateZip && (
                <p className="text-gray-500 text-sm mt-0.5">{cityStateZip}</p>
              )}
            </div>
            {!listing.unavailable && (
              <button
                onClick={() => {
                  setActiveTab("contact");
                  setTimeout(() => scrollIntoContainer(document.getElementById("listing-tabs")), 50);
                }}
                className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg transition bg-red-600 hover:bg-red-700 text-white"
              >
                Contact Manager
              </button>
            )}
          </div>

          {/* ── Unit Selector ── */}
          {sortedUnits.length > 0 && (
            <div className="bg-white rounded-xl shadow mb-4 overflow-hidden">
              <div className="flex w-full">
                {sortedUnits.map(({ origIdx, label }, sortedIdx) => (
                  <button
                    key={origIdx}
                    type="button"
                    onClick={() => setSelectedUnitIdx(sortedIdx)}
                    className={`flex-1 py-2.5 px-2 text-sm font-semibold text-center transition border-b-2 ${
                      selectedUnitIdx === sortedIdx
                        ? "bg-red-600 text-white border-red-600"
                        : "bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Stats Bar ── */}
          <div className="bg-white rounded-xl shadow mb-6 flex flex-wrap divide-y md:divide-y-0 md:divide-x divide-gray-100">
            <StatCell
              label="/ mo"
              value={selectedUnit ? (
                selectedUnit.rent != null ? `$${selectedUnit.rent.toLocaleString()}` : "TBD"
              ) : (() => {
                const label = getRentRangeLabel(listing.unitTypes);
                if (label === "Contact for Pricing") return "TBD";
                const dashIdx = label.indexOf("-");
                if (dashIdx === -1) return label;
                return (
                  <>
                    <span className="whitespace-nowrap">{label.slice(0, dashIdx + 1)}</span>
                    <wbr />
                    <span className="whitespace-nowrap">{label.slice(dashIdx + 1)}</span>
                  </>
                );
              })()}
            />
            <StatCell
              label="Beds"
              value={selectedUnit ? (selectedUnit.bedrooms != null ? String(selectedUnit.bedrooms) : "—") : getUnitValuesLabel(listing.unitTypes, "bedrooms")}
            />
            <StatCell
              label="Baths"
              value={selectedUnit ? (selectedUnit.bathrooms != null ? String(selectedUnit.bathrooms) : "—") : getUnitValuesLabel(listing.unitTypes, "bathrooms")}
            />
            <StatCell
              label="Sq Ft"
              value={selectedUnit ? (selectedUnit.area ? selectedUnit.area.toLocaleString() : "—") : getAreaRangeLabel(listing.unitTypes)}
            />
            <LeaseStatCell leaseAvailability={listing.leaseAvailability} />
            <StatCell
              label="Rating"
              value={overallAvg ? `★ ${overallAvg}` : "—"}
            />
          </div>

          {/* ── Conflict awareness banner (§10.3) ── */}
          {conflictCount > 0 && (
            <div className="mb-4 px-4 py-2.5 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-800 flex items-center gap-2">
              <span className="text-yellow-500">⚠</span>
              Another student is currently in the application stage for this property.
            </div>
          )}

          {/* ── Active concessions pills ── */}
          {listingExtras?.concessions?.filter((c) => c.active).length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {listingExtras.concessions.filter((c) => c.active).map((c) => (
                <span key={c.id} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 border border-green-200">
                  🎁 {c.description}
                </span>
              ))}
            </div>
          )}

          {/* ── Sticky Tab Bar ── */}
          <div
            id="listing-tabs"
            className={`sticky z-30 bg-white border-b border-gray-100 shadow-sm mb-6 -mx-4 ${compact ? "top-[52px]" : "top-0 px-4"}`}
          >
            <nav className={`flex ${compact ? "justify-center" : "overflow-x-auto max-w-7xl mx-auto"}`}>
              {TABS.filter((tab) => !excludeTabs.includes(tab.id) && !(listing.unavailable && tab.id === "contact")).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition ${
                    activeTab === tab.id
                      ? "text-red-600 border-red-600"
                      : "text-gray-500 border-transparent hover:text-gray-800 hover:border-gray-300"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* ── Tab Content ── */}
          <div className="bg-white rounded-xl shadow p-6">
            {activeTab === "amenities" && <AmenitiesTab listing={listing} />}
            {activeTab === "map" && <MapTab listing={listing} />}
            {activeTab === "places" && (
              <PlacesTab
                walkTimes={walkTimes}
                walkLoading={walkLoading}
                shuttleWalkMinutes={listing?.shuttleWalkMinutes ?? null}
              />
            )}
            {activeTab === "reviews" && !session && (
              <SignInPrompt message="Sign in to view and leave reviews." />
            )}
            {activeTab === "reviews" && session && (
              <ReviewsTab
                legitimateReviews={legitimateReviews}
                overallAvg={overallAvg}
                starCounts={starCounts}
                commAvg={commAvg}
                locAvg={locAvg}
                valAvg={valAvg}
                showAllReviews={showAllReviews}
                setShowAllReviews={setShowAllReviews}
                session={session}
                listing={listing}
                reviewText={reviewText}
                setReviewText={setReviewText}
                rating={rating}
                setRating={setRating}
                commRating={commRating}
                setCommRating={setCommRating}
                locRating={locRating}
                setLocRating={setLocRating}
                valRating={valRating}
                setValRating={setValRating}
                reviewLoading={reviewLoading}
                handleReviewSubmit={handleReviewSubmit}
              />
            )}
            {activeTab === "contact" && !session && (
              <SignInPrompt message="Sign in to contact the property manager." />
            )}
            {activeTab === "contact" && session && (
              <ContactTab
                listing={listing}
                session={session}
                contactForm={contactForm}
                setContactForm={setContactForm}
                handleContactSubmit={handleContactSubmit}
                contactLoading={contactLoading}
                contactSent={contactSent}
              />
            )}
            {activeTab === "details" && (
              <div className="space-y-7">
                {/* Pet policy */}
                {listingExtras?.petPolicy?.policy_text && (
                  <section>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Pet policy</h3>
                    <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                      {listingExtras.petPolicy.policy_text}
                    </p>
                  </section>
                )}

                {/* Fees */}
                {listingExtras?.fees?.length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Fees</h3>
                    {["one_time", "refundable_deposit", "recurring", "penalty"].map((cat) => {
                      const catFees = listingExtras.fees.filter((f) => f.fee_types?.category === cat);
                      if (!catFees.length) return null;
                      const labels = { one_time: "One-time", refundable_deposit: "Deposits", recurring: "Recurring", penalty: "Penalties" };
                      return (
                        <div key={cat} className="mb-4">
                          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{labels[cat]}</p>
                          <div className="space-y-1.5">
                            {catFees.map((f) => (
                              <div key={f.id} className="flex items-center justify-between text-sm">
                                <span className="text-gray-700">{f.fee_types?.display_label || f.fee_type_id}</span>
                                <span className="font-medium text-gray-900">
                                  ${Number(f.amount).toLocaleString()}
                                  <span className="text-xs text-gray-400 font-normal ml-1">{f.basis !== "flat" ? `/ ${f.basis.replace(/_/g, " ")}` : ""}</span>
                                  {f.refundable && <span className="ml-1 text-xs text-green-600">(refundable)</span>}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </section>
                )}

                {/* Concessions */}
                {listingExtras?.concessions?.filter((c) => c.active).length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">Current offers</h3>
                    <div className="space-y-2">
                      {listingExtras.concessions.filter((c) => c.active).map((c) => (
                        <div key={c.id} className="flex items-start gap-2 text-sm text-gray-700">
                          <span className="text-green-600 mt-0.5">✓</span>
                          <div>
                            <p className="font-medium">{c.description}</p>
                            {c.conditions && <p className="text-xs text-gray-400">{c.conditions}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* FAQs */}
                {listingExtras?.faqs?.filter((f) => f.is_public).length > 0 && (
                  <section>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">FAQs</h3>
                    <div className="space-y-3">
                      {listingExtras.faqs.filter((f) => f.is_public).sort((a, b) => a.sort_order - b.sort_order).map((faq) => (
                        <details key={faq.id} className="group border border-gray-200 rounded-lg overflow-hidden">
                          <summary className="px-4 py-3 text-sm font-medium text-gray-900 cursor-pointer hover:bg-gray-50 list-none flex items-center justify-between">
                            {faq.question}
                            <span className="text-gray-400 group-open:rotate-180 transition-transform">▾</span>
                          </summary>
                          <div className="px-4 pb-3 pt-1 text-sm text-gray-600 leading-relaxed border-t border-gray-100">
                            {faq.answer}
                          </div>
                        </details>
                      ))}
                    </div>
                  </section>
                )}

                {!listingExtras && (
                  <p className="text-sm text-gray-400 text-center py-8">Loading details…</p>
                )}
                {listingExtras && !listingExtras.petPolicy?.policy_text && !listingExtras.fees?.length && !listingExtras.faqs?.filter((f) => f.is_public).length && (
                  <p className="text-sm text-gray-400 text-center py-8">No additional details available yet.</p>
                )}
              </div>
            )}
          </div>
          </motion.div>
        </div>
      </div>

      {/* ── Full-screen Gallery Modal ── */}
      {isGalleryOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm overflow-y-auto"
          onClick={() => setIsGalleryOpen(false)}
        >
          <div
            className="max-w-6xl mx-auto px-6 py-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6 text-white">
              <div className="text-lg font-semibold">
                Photos ({images.length})
              </div>
              <button
                type="button"
                onClick={() => setIsGalleryOpen(false)}
                className="text-white/80 hover:text-white text-3xl leading-none"
                aria-label="Close photo gallery"
              >
                ×
              </button>
            </div>
            <div className="columns-1 sm:columns-2 lg:columns-3 gap-4">
              {images.map((src) => (
                <GalleryImage
                  key={src}
                  src={src}
                  index={images.indexOf(src)}
                  onClick={(e) => { e.stopPropagation(); setLightboxSrc(src); }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox (fullscreen single image) ── */}
      {lightboxSrc && (
        <div
          className="fixed inset-0 z-[70] bg-black/95 flex items-center justify-center"
          onClick={() => setLightboxSrc(null)}
        >
          <button
            type="button"
            className="absolute top-4 right-4 text-white/80 hover:text-white text-4xl leading-none z-10"
            onClick={() => setLightboxSrc(null)}
            aria-label="Close fullscreen image"
          >
            ×
          </button>
          <div className="relative max-w-[90vw] max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <Image
              src={lightboxSrc}
              alt="Fullscreen photo"
              width={1600}
              height={1200}
              className="object-contain max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
              priority
            />
          </div>
        </div>
      )}
    </>
  );
}
