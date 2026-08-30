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
  Car,
  FileText,
  Star,
  LayoutGrid,
  X,
} from "lucide-react";
import toast from "react-hot-toast";
import { signIn } from "next-auth/react";
import HeartIcon from "@/components/ui/HeartIcon";
import StarRatingInput from "@/components/ui/StarRatingInput";
import ListingMap from "@/components/listings/ListingMap";
import LeaseOptions from "@/components/listings/LeaseOptions";
import { calcAge } from "@/utils/listingFormatters";
import { WASHU_PLACES } from "@/utils/washuPlaces";
import {
  DRIVE_PLACES,
  NEAREST_DRIVE_POOLS,
  DRIVE_LABELS,
} from "@/utils/drivePlaces";
import { trackEvent, getListingSource } from "@/utils/analytics";
import { formatAvailableFrom } from "@/utils/listingFormatters";
import ReviewReplySection from "./ReviewReplySection";
import { isReviewEligibleEmail } from "@/lib/schools";

// Scroll `el` into view within its nearest scrollable ancestor; falls back to
// window-level scrollIntoView so it works in both modals and full-page views.
function scrollIntoContainer(el) {
  if (!el) return;
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    const cs = window.getComputedStyle(parent);
    if (
      /auto|scroll/.test(cs.overflowY) &&
      parent.scrollHeight > parent.clientHeight
    ) {
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

const TABS = [
  { id: "amenities", label: "Overview" },
  { id: "map", label: "Map" },
  { id: "places", label: "Places" },
  { id: "reviews", label: "Reviews" },
  { id: "contact", label: "Contact" },
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
      <StarRatingInput
        value={value}
        onChange={onChange}
        px={20}
        color="red"
        readOnly={readOnly}
        ariaLabelPrefix={label ? `Rate ${label}` : "Rate"}
      />
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

const AMENITY_LABELS = {
  air_conditioning: "Air Conditioning",
  dishwasher: "Dishwasher",
  gym: "Gym",
  laundry: "Laundry",
  mailroom: "Mailroom",
  microwave: "Microwave",
  oven: "Oven",
  parking: "Parking",
  pets_allowed: "Pets Allowed",
  pool: "Pool",
  refrigerator: "Refrigerator",
  rooftop: "Rooftop",
  storage: "Storage",
  stove: "Stove",
  study_room: "Study Room",
};

const UTILITY_LABELS = {
  electric: "Electric",
  gas: "Gas",
  heat: "Heat",
  water: "Water",
  internet: "Internet",
  trash: "Trash",
  cable: "Cable",
  sewer: "Sewer",
  cooling: "Cooling",
};

function toTitleCase(str) {
  return str
    .replace(/_/g, " ")
    .replace(/-/g, "-")
    .replace(
      /\w\S*/g,
      (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    );
}

function AmenitiesTab({ listing }) {
  const amenities = [
    ...new Set([
      ...(listing.amenities || [])
        .map((a) => AMENITY_LABELS[a] || AMENITY_LABELS[a?.toLowerCase()])
        .filter(Boolean),
      // Landlord-entered "other" amenities are free text — display as-is.
      ...(listing.customAmenities || []).filter(Boolean),
    ]),
  ];
  const utilities = [
    ...new Set(
      (listing.utilitiesIncluded || [])
        .map((u) => UTILITY_LABELS[u] || UTILITY_LABELS[u?.toLowerCase()])
        .filter(Boolean)
    ),
  ];
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
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            Utilities Included
          </h2>
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
    <ListingMap
      latitude={listing.latitude}
      longitude={listing.longitude}
      address={listing.address}
    />
  );
}

// ─── Tab: Places ─────────────────────────────────────────────────────────────

// Walking person (Material-style); lucide PersonWalking isn't in our package yet.
function WalkingPersonIcon({ size = 24, className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7" />
    </svg>
  );
}

function splitPlaceLabel(label) {
  const idx = label.indexOf(" (");
  if (idx === -1) return { primary: label, secondary: null };
  return { primary: label.slice(0, idx), secondary: label.slice(idx + 1) };
}

// A single place row: name on the left, "X min" + a trailing mode icon on the
// right. The icon (walk/drive) conveys the mode, so the word is dropped.
function PlaceRow({ label, minutes, Icon, loading }) {
  const { primary, secondary } = splitPlaceLabel(label);
  return (
    <li className="flex items-center gap-2 py-2 border-b border-gray-100 text-gray-700">
      <span className="flex-1 min-w-0 truncate">
        {primary}
        {secondary && (
          <span className="text-xs text-gray-400 font-normal"> {secondary}</span>
        )}
      </span>
      <span className="text-sm text-gray-500 font-medium whitespace-nowrap">
        {loading ? "..." : minutes != null ? `${minutes} min` : "N/A"}
      </span>
      <Icon size={16} className="text-red-400 shrink-0" />
    </li>
  );
}

function PlaceGroup({ label, items, Icon = Car, loading = false, twoColumn = false }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
        {label}
      </h3>
      <ul className={twoColumn ? "grid grid-cols-1 sm:grid-cols-2 gap-x-8" : undefined}>
        {items.map((it) => (
          <PlaceRow
            key={it.key}
            label={it.label}
            minutes={it.minutes}
            loading={loading}
            Icon={it.icon ?? Icon}
          />
        ))}
      </ul>
    </div>
  );
}

function PlacesTab({ walkTimes, walkLoading, shuttleWalkMinutes, driveTimes }) {
  const [mode, setMode] = useState("walking");
  const hasDriveTimes = Object.keys(driveTimes ?? {}).length > 0;

  // Combine fixed driving destinations + the synthetic nearest rows into one
  // labeled, categorized list.
  const driveItems = useMemo(
    () => [
      ...DRIVE_PLACES.map((p) => ({
        key: p.name,
        label: DRIVE_LABELS[p.name] ?? p.name,
        category: p.category,
        minutes: driveTimes?.[p.name],
      })),
      ...NEAREST_DRIVE_POOLS.map((p) => ({
        key: p.resultName,
        label: DRIVE_LABELS[p.resultName] ?? p.label,
        category: p.category,
        minutes: driveTimes?.[p.resultName],
      })),
    ],
    [driveTimes]
  );

  const campusWalkItems = useMemo(
    () =>
      [...WASHU_PLACES]
        .filter((p) => p.name !== "Schnucks (Grocery)")
        .sort((a, b) => (walkTimes[a.name] ?? Infinity) - (walkTimes[b.name] ?? Infinity))
        .map((p) => ({
          key: p.name,
          label: p.name,
          minutes: walkTimes[p.name],
        })),
    [walkTimes]
  );

  const walkEssentialsItems = useMemo(() => {
    const items = [
      {
        key: "schnucks",
        label: "Schnucks",
        minutes: walkTimes?.["Schnucks (Grocery)"],
        icon: WalkingPersonIcon,
      },
      {
        key: "shuttle",
        label: "Nearest Shuttle Stop",
        minutes: shuttleWalkMinutes,
        icon: WalkingPersonIcon,
      },
    ];
    return items.sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity));
  }, [walkTimes, shuttleWalkMinutes]);

  const sortDriveByMinutes = (items) =>
    [...items].sort((a, b) => (a.minutes ?? Infinity) - (b.minutes ?? Infinity));

  const groceryItems = useMemo(
    () => sortDriveByMinutes(driveItems.filter((it) => it.category === "grocery")),
    [driveItems]
  );
  const attractionItems = useMemo(
    () => sortDriveByMinutes(driveItems.filter((it) => it.category === "attractions")),
    [driveItems]
  );
  const parkingItems = useMemo(
    () => sortDriveByMinutes(driveItems.filter((it) => it.category === "parking")),
    [driveItems]
  );
  const essentialsItems = useMemo(() => {
    const order = ["gas_station_nearest", "pharmacy_nearest", "Lambert Airport"];
    return order.map((key) => driveItems.find((it) => it.key === key)).filter(Boolean);
  }, [driveItems]);

  const toggleBtn = (value, Icon, text) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`flex items-center gap-1.5 px-3 py-1 text-sm font-medium rounded-md transition-colors ${
        mode === value ? "bg-white text-red-500 shadow-sm" : "text-gray-500 hover:text-gray-700"
      }`}
    >
      <Icon size={16} /> {text}
    </button>
  );

  return (
    <div>
      <div className="flex justify-end mb-4">
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
          {toggleBtn("walking", WalkingPersonIcon, "Walking")}
          {toggleBtn("driving", Car, "Driving")}
        </div>
      </div>

      {mode === "walking" ? (
        <div className="space-y-4">
          <PlaceGroup
            label="Essentials"
            items={walkEssentialsItems}
            loading={walkLoading}
            twoColumn
          />
          <PlaceGroup
            label="Campus Buildings"
            items={campusWalkItems}
            Icon={WalkingPersonIcon}
            loading={walkLoading}
            twoColumn
          />
        </div>
      ) : !hasDriveTimes ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          Driving times aren&apos;t available for this listing yet.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          <PlaceGroup label="Essentials" items={essentialsItems} />
          <PlaceGroup label="Campus Parking" items={parkingItems} />
          <PlaceGroup label="Shopping" items={groceryItems} />
          <PlaceGroup label="Attractions" items={attractionItems} />
        </div>
      )}
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
    } catch {
      /* ignore */
    }
  }

  const userId = session?.user?.id;
  const isLandlord =
    listing?.owner?._id === userId || listing?.owner?.id === userId;
  console.log("Listing:\n", listing);

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
                  <div className="mb-3">
                    <p className="text-gray-700 text-sm leading-relaxed">
                      {review.comment}
                    </p>
                    <ReviewReplySection
                      review={review}
                      owner={listing?.owner}
                      isLandlord={isLandlord}
                    />
                  </div>
                  <div className="flex gap-4 text-xs text-gray-400">
                    {(() => {
                      const override = voteOverrides[review._id];
                      const upCount = override
                        ? override.upvotes
                        : review.upvotes ?? 0;
                      const downCount = override
                        ? override.downvotes
                        : review.downvotes ?? 0;
                      const userVote = override
                        ? override.userVote
                        : review.userVote ?? null;
                      return (
                        <>
                          <button
                            type="button"
                            onClick={() => handleVote(review._id, "up")}
                            className={`flex items-center gap-1 transition ${
                              userVote === "up"
                                ? "text-green-500"
                                : "hover:text-green-500"
                            }`}
                          >
                            <ThumbsUp size={13} /> <span>{upCount}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleVote(review._id, "down")}
                            className={`flex items-center gap-1 transition ${
                              userVote === "down"
                                ? "text-red-500"
                                : "hover:text-red-500"
                            }`}
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
        {isReviewEligibleEmail(session?.user?.email) ? (
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
              <StarRow
                label="Location"
                value={locRating}
                onChange={setLocRating}
              />
              <StarRow
                label="Value"
                value={valRating}
                onChange={setValRating}
              />
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
            Sign in with your school email to leave a review
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
  selectedLease = null,
}) {
  const [ageStatus, setAgeStatus] = useState(
    listing.twentyOnePlus ? "loading" : "ok"
  );

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
    return (
      <div className="py-8 text-center text-sm text-gray-400">
        Verifying eligibility...
      </div>
    );
  }

  if (listing.twentyOnePlus && ageStatus === "no_birthday") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        This property requires residents to be 21+. Please add your birthday in
        your{" "}
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

  /*
   * The recipient is the owner of the SELECTED lease, not the property's primary
   * landlord — several landlords can offer leases at one property, so "the
   * landlord" is only meaningful once an offering is chosen. The lease options
   * above already show that lease's price, term and type, so only the name is
   * repeated here. The listing owner remains the fallback for properties whose
   * units carry no lease at all.
   */
  const owner = selectedLease
    ? {
        name: selectedLease.landlordName ?? listing.owner?.name,
        image: selectedLease.landlordImage ?? listing.owner?.image,
      }
    : listing.owner;

  const handleChange = (field) => (e) =>
    setContactForm((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="max-w-xl">
      {/* Landlord info */}
      {owner && (
        <div className="flex items-center gap-4 mb-6">
          <img
            src={
              owner.image?.trim()
                ? owner.image
                : "/default-icons/default-user.png"
            }
            alt={owner.name}
            className="w-14 h-14 rounded-full object-cover ring-2 ring-gray-100"
          />
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">
              Listing by
            </p>
            <span className="text-lg font-semibold text-gray-900">
              {owner.name}
            </span>
          </div>
        </div>
      )}

      {contactSent ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-green-700 text-sm font-medium">
          Your message was sent!
          {owner ? ` ${owner.name} will be in touch soon.` : ""}
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
      className={`relative mb-4 break-inside-avoid rounded-lg overflow-hidden bg-gray-800/20${
        onClick ? " cursor-zoom-in" : ""
      }`}
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
        className={`w-full h-auto block rounded-lg shadow transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        loading="lazy"
        onLoad={() => {
          setLoaded(true);
          onImageLoad?.(src);
        }}
      />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

/*
 * "View floor plan", beside the unit's beds and baths.
 *
 * Renders nothing when the unit has no plan, which is most of them — an
 * always-present link to a missing diagram is worse than no link. The plan
 * opens in place rather than navigating away, with the original a click further
 * on for anyone who wants to keep it.
 */
function FloorPlanLink({ url, onOpen }) {
  if (!url) return null;
  return (
    <>
      <span className="mx-1.5 text-gray-300">·</span>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1 font-medium text-red-600 underline underline-offset-2 transition hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
      >
        <LayoutGrid className="h-3 w-3" />
        View floor plan
      </button>
    </>
  );
}

function FloorPlanViewer({ url, unitName, onClose }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Floor plan${unitName ? ` for ${unitName}` : ""}`}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">
            Floor plan{unitName ? ` — ${unitName}` : ""}
          </h3>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto text-xs font-medium text-red-600 underline underline-offset-2 hover:text-red-700"
          >
            Open original
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close floor plan"
            className="rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-4">
          {/* A plan can be a PDF as readily as an image, and an <img> would show
              a broken icon for one. */}
          {/\.pdf($|\?)/i.test(url) ? (
            <iframe src={url} title="Floor plan" className="h-[70vh] w-full rounded-lg bg-white" />
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={url} alt="Floor plan" className="mx-auto max-h-[70vh] w-auto object-contain" />
          )}
        </div>
      </div>
    </div>
  );
}

export default function ListingModalInfo({
  session,
  listing,
  excludeTabs = [],
  compact = false,
  tabBarAction = null,
  // The unit that satisfied the browse filters, if the renter arrived from a
  // filtered search. See lib/listings/filterListings.js.
  initialUnitId = null,
}) {
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState(null);
  const [activeTab, setActiveTab] = useState("amenities");

  // Esc closes gallery overlay (only when lightbox is not open — lightbox takes priority)
  useEffect(() => {
    if (!isGalleryOpen) return;
    const handler = (e) => {
      if (e.key === "Escape" && !lightboxSrc) setIsGalleryOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isGalleryOpen, lightboxSrc]);

  // Esc closes lightbox
  useEffect(() => {
    if (!lightboxSrc) return;
    const handler = (e) => {
      if (e.key === "Escape") setLightboxSrc(null);
    };
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

  // Drive times — pre-computed DB values keyed by locations name (incl. *_nearest)
  const storedDriveTimes = listing?.placeDriveMinutes;
  const driveTimes = useMemo(() => storedDriveTimes ?? {}, [storedDriveTimes]);

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
  const [floorPlanOpen, setFloorPlanOpen] = useState(false);

  // sortedUnits: [{origIdx, label}] sorted ascending by beds → baths → dup number
  // Studios (0 beds) are labelled "Studio" and not sorted by baths within the group
  // Units with identical beds, baths, rent, and area are deduplicated — only the first is kept.
  const sortedUnits = useMemo(() => {
    const units = (listing.unitTypes ?? []).filter(
      (u) => u.available !== false
    );
    const isStudio = (u) => (u.bedrooms ?? 0) === 0;

    /*
     * No deduplication. Two units that look identical are two apartments: a
     * building with ten matching studios has ten of them, and each carries its
     * own offering from possibly a different landlord.
     *
     * This used to collapse units matching on beds, baths, rent and area, which
     * was written when a "unit" meant a floor-plan type. Under the property →
     * unit → lease model it hid real inventory — and would have hidden one
     * landlord's live offering behind another's identical-looking one.
     */
    const deduped = units;

    // Build base labels in original order for stable disambiguation numbering.
    // Each entry has a full label ("2 Bed / 1 Bath") and a short label
    // ("2 Br / 1 Ba") used when the selector has to scroll horizontally.
    const baseLabelOf = deduped.map((u) => {
      // Landlord-named units/floor plans display their custom title instead of "2 Bed / 1 Bath".
      if (u.title) return { full: u.title, short: u.title };
      if (isStudio(u)) return { full: "Studio", short: "Studio" };
      const beds = u.bedrooms != null ? String(u.bedrooms) : "?";
      const baths = u.bathrooms != null ? String(u.bathrooms) : "?";
      return {
        full: `${beds} Bed / ${baths} Bath`,
        short: `${beds} Br / ${baths} Ba`,
      };
    });
    const counts = {};
    for (const { full } of baseLabelOf) counts[full] = (counts[full] || 0) + 1;
    const counters = {};
    const labels = baseLabelOf.map(({ full, short }) => {
      if (counts[full] > 1) {
        counters[full] = (counters[full] || 0) + 1;
        const n = counters[full];
        return {
          base: full,
          num: n,
          label: `${full} (${n})`,
          shortLabel: `${short} (${n})`,
        };
      }
      return { base: full, num: 0, label: full, shortLabel: short };
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

  /*
   * Open on the unit the renter's filters actually matched rather than the
   * cheapest-by-bedroom default. Runs as an effect because sortedUnits is
   * derived, and re-runs when the detail fetch replaces the browse-feed listing
   * (the feed paints first, so the unit may not be resolvable on first render).
   *
   * Dedup above can collapse the matched unit into an identical twin, so fall
   * back to the twin's tab — same beds/baths/rent, so it is the same answer.
   */
  useEffect(() => {
    if (!initialUnitId) return;
    let idx = sortedUnits.findIndex((s) => s.unit.id === initialUnitId);
    if (idx < 0) {
      const target = (listing.unitTypes ?? []).find((u) => u.id === initialUnitId);
      if (target) {
        idx = sortedUnits.findIndex(
          (s) =>
            s.unit.bedrooms === target.bedrooms &&
            s.unit.bathrooms === target.bathrooms
        );
      }
    }
    if (idx >= 0) setSelectedUnitIdx(idx);
  }, [initialUnitId, sortedUnits, listing.unitTypes]);

  const selectedUnit = sortedUnits[selectedUnitIdx]?.unit ?? null;

  useEffect(() => {
    // The plan belongs to one apartment; switching tabs makes it the wrong one.
    setFloorPlanOpen(false);
  }, [selectedUnitIdx]);

  /*
   * Leases on the unit whose tab is open. A unit can carry several competing
   * offerings, so each row is independently contactable — there is no "selected"
   * lease in the browse view.
   */
  const selectedUnitLeases = useMemo(
    () => selectedUnit?.leases ?? [],
    [selectedUnit]
  );

  /*
   * The browse panel paints itself from the listing feed before the detail fetch
   * resolves, and that feed carries no leases at all. An ABSENT `leases` key
   * therefore means "not loaded yet", while an empty array means "genuinely none
   * on offer" — getListing always sets one. Conflating them would tell a reader a
   * unit has no lease when it simply hasn't arrived.
   */
  const leasesLoading = !!selectedUnit && selectedUnit.leases === undefined;

  /*
   * Which lease the contact form is about. Set by the Contact button on a lease
   * row; falls back to the open unit's first offering when the Contact tab is
   * reached from the tab strip instead.
   */
  const [selectedLeaseId, setSelectedLeaseId] = useState(null);
  useEffect(() => {
    setSelectedLeaseId((current) =>
      current && selectedUnitLeases.some((l) => l.id === current)
        ? current
        : selectedUnitLeases[0]?.id ?? null
    );
  }, [selectedUnitLeases]);

  const selectedLease =
    selectedUnitLeases.find((l) => l.id === selectedLeaseId) ?? null;

  /*
   * Name of the open unit. Prefers its real identity, then the landlord's floor
   * plan name, and only then a generated description — a unit that predates unit
   * identity gets no invented label. Mirrors unitIdentityLabel in getListing.
   */
  // Null when the unit predates unit identity and the landlord never named it —
  // 60% of rows. The specs line is promoted to the heading in that case rather
  // than restating the bed/bath count twice.
  const selectedUnitName =
    selectedUnit?.identityLabel ?? selectedUnit?.title ?? null;

  const selectedUnitSpecs = [
    (selectedUnit?.bedrooms ?? 0) === 0
      ? "Studio"
      : `${selectedUnit?.bedrooms ?? "?"} bed`,
    `${selectedUnit?.bathrooms ?? "?"} bath`,
    // Only when it is known — "? sq ft" is worse than saying nothing.
    ...(selectedUnit?.area != null
      ? [`${Number(selectedUnit.area).toLocaleString()} sq ft`]
      : []),
  ].join(" · ");

  /*
   * Whether to offer furniture rental. Reads unit_leases.furnished — the
   * per-offering flag — because two landlords on one unit can differ; the
   * property-level listings.furnished is only a fallback for units whose leases
   * haven't loaded.
   */
  const showFurnishCta = selectedUnitLeases.length
    ? selectedUnitLeases.some((l) => !l.furnished)
    : !listing.furnished;

  const handleContactLease = (lease) => {
    setSelectedLeaseId(lease.id);
    /*
     * Clicking Contact is an intent to send, so the form comes back even after
     * a previous enquiry. It used to latch: contactSent was set on the first
     * submit and never cleared, so every later lease showed "Your message was
     * sent!" instead of a form — and on a unit with competing offerings, a
     * renter who wrote to one landlord could not write to the next.
     * The typed fields are deliberately kept, so asking several landlords about
     * the same place doesn't mean retyping the same message.
     */
    setContactSent(false);
    setActiveTab("contact");
    setTimeout(
      () => scrollIntoContainer(document.getElementById("listing-tabs")),
      50
    );
  };

  // When the unit tabs don't all fit, the selector scrolls horizontally and
  // uses abbreviated labels ("Br"/"Ba"). Overflow is measured against a hidden
  // full-label row so the decision never feeds back into its own measurement.
  const unitTrackRef = useRef(null);
  const unitMeasureRef = useRef(null);
  const [unitsScroll, setUnitsScroll] = useState(false);
  useEffect(() => {
    const track = unitTrackRef.current;
    const measure = unitMeasureRef.current;
    if (!track || !measure) return;
    const check = () =>
      setUnitsScroll(measure.scrollWidth > track.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(track);
    return () => ro.disconnect();
  }, [sortedUnits]);

  // Images — respect the landlord-chosen order (sort_order from listing_images).
  const sanitizeUrl = (url) => url?.replace(/ /g, "%20") ?? url;
  const images = Array.isArray(listing?.images)
    ? listing.images.filter(Boolean).map(sanitizeUrl)
    : [];

  /*
   * The two tiles beside the cover follow the UNIT whose tab is open, whenever
   * that unit has pictures of its own. The big shot stays the property's — it
   * is what the building looks like, and it should not jump around as someone
   * flicks between units — while the pair beside it becomes the evidence that
   * these are genuinely different apartments rather than one listing wearing
   * different labels.
   *
   * The unit takes as many of the two tiles as it has pictures for: one photo
   * replaces the top tile, two replace both. A unit with a single picture used
   * to be shown none of it — the pair only switched together — which meant a
   * landlord who uploaded one photo of their apartment saw no sign of it beside
   * the cover.
   */
  const unitImages = Array.isArray(selectedUnit?.images)
    ? selectedUnit.images.filter(Boolean).map(sanitizeUrl)
    : [];
  const showingUnitPhotos = unitImages.length > 0;

  /*
   * What the gallery shows: the building's own photos AND the photos of the
   * unit whose tab is open, kept as labelled sections. A renter looking at
   * Apt 1W wants the building and that apartment — not every other unit's
   * bedrooms, which is a different listing to them.
   *
   * propertyImages is read separately from `images` because the latter falls
   * back to unit photos when the building has none of its own; using it here
   * would file those under "the property".
   */
  const propertyGallery = Array.isArray(listing?.propertyImages)
    ? listing.propertyImages.filter(Boolean).map(sanitizeUrl)
    : images; // browse-feed shape, before the detail fetch lands

  const gallerySections = [
    ...(propertyGallery.length
      ? [{ key: "property", label: "The property", photos: propertyGallery }]
      : []),
    ...(unitImages.length
      ? [{ key: "unit", label: selectedUnitName ?? "This unit", photos: unitImages }]
      : []),
  ];
  const galleryCount = gallerySections.reduce((n, sec) => n + sec.photos.length, 0);

  const coverImage = images[0] || unitImages[0];
  /*
   * Whether anything renders beside the cover. Keyed on the tiles themselves
   * rather than on the property's photo count: a building with one picture and
   * a unit with two does have a pair to show, and testing images.length alone
   * would collapse the hero to full width and hide them.
   */
  const hasSideTiles = showingUnitPhotos || images.length > 1;
  /*
   * The two tiles, each tagged with where it came from so the caption only
   * appears on a photo that really is of this unit.
   *
   * The offset differs by source: the cover already consumed images[0] from the
   * property set, but nothing has consumed the unit's, so its photos start at 0.
   * Unit photos claim tiles from the top down; the property's fill the rest.
   */
  const propertyTile = [
    images[1] || images[0] || null,
    images[2] || images[1] || images[0] || null,
  ];
  const sideTiles = [0, 1]
    .map((i) =>
      unitImages[i]
        ? { src: unitImages[i], isUnit: true }
        : propertyTile[i]
          ? { src: propertyTile[i], isUnit: false }
          : null
    )
    .filter(Boolean);

  // Address
  const { street, cityStateZip: parsedCityStateZip } = parseAddress(
    listing.address
  );
  const cityStateZip =
    listing.title && listing.title !== street
      ? listing.address
      : parsedCityStateZip;

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
    if (reviewText.trim().length < 5 || rating < 0.5 || rating > 5) {
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
      toast.success("Thanks for reviewing!");
      trackEvent("Review Submitted", { listingId: listing._id, rating });
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
          // The recipient is resolved server-side from the lease. The names
          // below are only a fallback for listings whose units carry no lease.
          leaseId: selectedLease?.id ?? null,
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
        setTimeout(() => {
          const source = getListingSource(listing._id);
          trackEvent("Contact Submitted", {
            listingId: listing._id,
            address: listing.address,
            ...(source ? { source } : {}),
          });
        }, 0);
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
        <div
          className={`max-w-7xl mx-auto px-4 ${compact ? "pt-4 pb-8" : "py-8"}`}
        >
          {/* ── Photo Grid ── */}
          <div
            className={`relative flex flex-col md:flex-row gap-2 mb-6 rounded-xl overflow-hidden ${
              compact ? "md:h-[300px]" : "md:h-[520px]"
            }`}
          >
            {/* Main image — natural width on desktop (no crop, no whitespace) */}
            <div
              ref={heroImgWrapperRef}
              className={`relative cursor-pointer bg-gray-100 rounded-tl-xl rounded-tr-xl md:rounded-bl-xl overflow-hidden aspect-[4/3] md:aspect-auto ${
                hasSideTiles
                  ? "md:rounded-tr-none md:flex-shrink-0 md:w-[65%]"
                  : "md:rounded-tr-xl md:rounded-br-xl md:w-full"
              }`}
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
              {/* Cover badges: live PMS-verified availability + Street View attribution */}
              {(listing.verifiedLive || (coverImage && listing.imageFromStreetView)) && (
                <div className="absolute top-3 left-3 z-10 flex flex-col items-start gap-1.5">
                  {listing.verifiedLive && !listing.unavailable && (
                    <div className="flex items-center gap-1.5 bg-red-600 text-white text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm">
                      <span className="relative flex h-2 w-2" aria-hidden="true">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                      </span>
                      <span className="uppercase tracking-wide">Live availability</span>
                    </div>
                  )}
                  {coverImage && listing.imageFromStreetView && (
                    <div className="flex items-center gap-1 bg-black/60 text-white text-xs font-medium px-2.5 py-1 rounded-full">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.94 6.31a1.5 1.5 0 112.12 2.12L9.7 9.79a1 1 0 00-.29.7V11a1 1 0 11-2 0v-.5a3 3 0 01.88-2.12l.65-.65zM10 14.5a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                      </svg>
                      Street View
                    </div>
                  )}
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

            {/* Two stacked thumbnails — fill remaining width, desktop only.
                Hidden when there's a single photo so it doesn't render as repeated frames. */}
            {hasSideTiles && (
            <motion.div
              className="hidden md:flex flex-1 flex-col gap-2 min-w-[180px]"
              initial={compact ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.28, duration: 0.38, ease: "easeOut" }}
            >
              {sideTiles.map((tile, i) => (
                <div
                  key={`${tile.src}-${i}`}
                  className={`relative flex-1 cursor-pointer overflow-hidden bg-gray-100 ${
                    i === 0 ? "rounded-tr-xl" : ""
                  } ${i === sideTiles.length - 1 ? "rounded-br-xl" : ""}`}
                  onClick={() => setIsGalleryOpen(true)}
                >
                  <Image
                    src={tile.src}
                    alt={
                      tile.isUnit
                        ? `${selectedUnitName ?? "Unit"} photo`
                        : `Listing photo ${i + 2}`
                    }
                    fill
                    sizes="(max-width: 768px) 0vw, 35vw"
                    className="object-cover"
                  />
                  {/* Says whose photo this is, so switching tabs reads as a
                      different apartment rather than the gallery reshuffling.
                      Only on the first unit tile — twice is clutter. */}
                  {tile.isUnit && selectedUnitName && i === 0 && (
                    <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white">
                      {selectedUnitName}
                    </span>
                  )}
                </div>
              ))}
            </motion.div>
            )}

            {/* "See all photos" — counts the property AND the open unit, which is
                what the gallery actually opens with. */}
            {galleryCount > 1 && (
              <button
                onClick={() => setIsGalleryOpen(true)}
                className="absolute bottom-4 right-4 z-20 text-white font-semibold text-sm bg-black/30 px-3 py-1.5 rounded-full hover:bg-black/50 transition"
              >
                See all photos ({galleryCount})
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
            {/* PMS-synced listings: availability comes straight from the landlord's
                management system, refreshed daily — Proximity's freshness guarantee. */}
            {listing.verifiedLive && (
              <div className="bg-white border border-gray-200 border-l-4 border-l-red-600 rounded-xl px-6 py-3 mb-4 flex items-center gap-2.5 text-sm shadow-sm">
                <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
                </span>
                <span className="text-gray-900">
                  Availability comes straight from the landlord&apos;s own system
                  {listing.verifiedAt && (
                    <>
                      {", last synced "}
                      {new Date(listing.verifiedAt).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </>
                  )}
                  . <span className="text-gray-500">What you see is what&apos;s actually open.</span>
                </span>
              </div>
            )}
            <div className="bg-white rounded-xl shadow px-6 py-5 mb-4 flex flex-col md:flex-row md:justify-between md:items-center gap-4">
              <div>
                <h1 className="text-lg sm:text-2xl font-bold text-gray-900 leading-snug">
                  {listing.title || street}
                </h1>
                {cityStateZip && (
                  <p className="text-gray-500 text-sm mt-0.5">{cityStateZip}</p>
                )}
                {/* Pre-leased until a known date: show the move-in instead of hiding */}
                {!listing.unavailable && formatAvailableFrom(listing.availableFrom) && (
                  <span className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2.5 py-1">
                    {formatAvailableFrom(listing.availableFrom)}
                  </span>
                )}
              </div>
              <div className="shrink-0 w-full md:w-auto flex items-center gap-2 md:ml-auto">
                {/* Rating moved up from the removed stats bar. */}
                {overallAvg ? (
                  <span className="inline-flex items-center gap-2">
                    <Star
                      className="h-8 w-8 shrink-0 fill-amber-400 text-amber-400"
                      aria-hidden="true"
                    />
                    <span className="text-2xl font-semibold leading-none text-gray-900">
                      {overallAvg}
                    </span>
                    <span className="text-md text-gray-500">
                      ({legitimateReviews.length})
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center h-9 text-sm text-gray-400">
                    No reviews yet
                  </span>
                )}
              </div>
            </div>

            {/* ── Unit Selector ── */}
            {sortedUnits.length > 0 && (
              <div className="relative bg-white rounded-xl shadow mb-4 overflow-hidden">
                <div ref={unitTrackRef} className="flex w-full overflow-x-auto">
                  {sortedUnits.map(({ origIdx, label, shortLabel }, sortedIdx) => (
                    <button
                      key={origIdx}
                      type="button"
                      onClick={() => setSelectedUnitIdx(sortedIdx)}
                      className={`flex-1 whitespace-nowrap py-2.5 px-3 text-sm font-semibold text-center transition border-b-2 ${
                        selectedUnitIdx === sortedIdx
                          ? "bg-red-600 text-white border-red-600"
                          : "bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
                      }`}
                    >
                      {unitsScroll ? shortLabel : label}
                    </button>
                  ))}
                </div>
                {/* Hidden full-label row used only to measure natural width */}
                <div
                  ref={unitMeasureRef}
                  aria-hidden="true"
                  className="absolute top-0 left-0 flex invisible pointer-events-none"
                >
                  {sortedUnits.map(({ origIdx, label }) => (
                    <span
                      key={origIdx}
                      className="whitespace-nowrap py-2.5 px-3 text-sm font-semibold"
                    >
                      {label}
                    </span>
                  ))}
                </div>

                {/* Identity of the unit on the open tab. The tab label is the
                    floor plan ("2 Bed / 1 Bath") or the landlord's own name for
                    it, neither of which says WHICH unit — so the real identity
                    ("Apt 1W") is stated here, above the offerings on it. */}
                <div className="border-t border-gray-100 px-4 pt-3">
                  {selectedUnitName ? (
                    <>
                      <p className="text-sm font-semibold text-gray-900">
                        {selectedUnitName}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {selectedUnitSpecs}
                        <FloorPlanLink
                          url={selectedUnit?.floorPlanImageUrl}
                          onOpen={() => setFloorPlanOpen(true)}
                        />
                      </p>
                    </>
                  ) : (
                    <p className="text-sm font-semibold text-gray-900">
                      {selectedUnitSpecs}
                      <FloorPlanLink
                        url={selectedUnit?.floorPlanImageUrl}
                        onOpen={() => setFloorPlanOpen(true)}
                      />
                    </p>
                  )}
                </div>

                {/* Lease options for the unit on the open tab. Each row is one
                    landlord's offering and carries its own Contact. */}
                <div>
                  <LeaseOptions
                    leases={selectedUnitLeases}
                    loading={leasesLoading}
                    onContact={handleContactLease}
                  />
                </div>
              </div>
            )}

            {/* ── Sticky Tab Bar ── */}
            <div
              id="listing-tabs"
              className={`sticky z-30 bg-white border-b border-gray-100 shadow-sm mb-6 -mx-4 ${
                compact ? "top-[52px]" : "top-0 px-4"
              }`}
            >
              {/* Three-column row so the tabs stay optically centred no matter
                  how wide the right-hand action is. */}
              <nav className="flex items-stretch max-w-7xl mx-auto">
                <div className="flex-1" aria-hidden="true" />

                <div className="flex overflow-x-auto">
                  {TABS.filter((tab) => !excludeTabs.includes(tab.id)).map(
                    (tab) => (
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
                    )
                  )}
                </div>

                {/* Furniture rental, styled as a tab so it reads as part of this
                    row. It only appears against an UNFURNISHED offering —
                    furnished belongs to the lease now, not the building, so this
                    asks whether any live offering on the open unit is
                    unfurnished, falling back to listings.furnished when none has
                    loaded. */}
                <div className="flex flex-1 items-stretch justify-end">
                  {showFurnishCta && (
                    <a
                      href="https://cort.sjv.io/zzb9y0"
                      target="_blank"
                      rel="noopener noreferrer sponsored nofollow"
                      className="inline-flex items-center whitespace-nowrap border-b-2 border-transparent px-5 py-3 text-sm font-medium text-red-600 transition hover:border-red-300 hover:text-red-700"
                    >
                      Furnish This Property
                    </a>
                  )}
                  {tabBarAction && (
                    <div className="flex items-center pl-3 pr-8">{tabBarAction}</div>
                  )}
                </div>
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
                  driveTimes={driveTimes}
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
                  selectedLease={selectedLease}
                />
              )}
            </div>
          </motion.div>
        </div>
      </div>

      {/* ── Floor plan ── */}
      {floorPlanOpen && selectedUnit?.floorPlanImageUrl && (
        <FloorPlanViewer
          url={selectedUnit.floorPlanImageUrl}
          unitName={selectedUnitName}
          onClose={() => setFloorPlanOpen(false)}
        />
      )}

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
                Photos ({galleryCount})
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
            {gallerySections.map((section, sectionIdx) => (
              <div key={section.key} className={sectionIdx ? "mt-10" : ""}>
                {/* Only worth a heading when there is more than one section —
                    a single group needs no label to tell it apart from. */}
                {gallerySections.length > 1 && (
                  <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/60">
                    {section.label}
                    <span className="ml-2 font-normal normal-case tracking-normal text-white/40">
                      {section.photos.length}{" "}
                      {section.photos.length === 1 ? "photo" : "photos"}
                    </span>
                  </h3>
                )}
                <div className="columns-1 sm:columns-2 lg:columns-3 gap-4">
                  {section.photos.map((src, i) => (
                    <GalleryImage
                      key={`${section.key}-${src}`}
                      src={src}
                      index={i}
                      onClick={(e) => {
                        e.stopPropagation();
                        setLightboxSrc(src);
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
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
          <div
            className="relative max-w-[90vw] max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
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
