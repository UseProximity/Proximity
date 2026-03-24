"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Phone, Mail, ThumbsUp, ThumbsDown, PersonStanding, Bus } from "lucide-react";
import toast from "react-hot-toast";
import { signIn } from "next-auth/react";
import HeartIcon from "@/components/HeartIcon";
import ListingMap from "@/components/show-listings/ListingMap";
import {
  getAreaRangeLabel,
  getRentRangeLabel,
  getUnitValuesLabel,
} from "@/utils/listingFormatters";
import { WASHU_PLACES } from "@/utils/washuPlaces";

// ─── Static Data ─────────────────────────────────────────────────────────────

const leaseTypeMap = {
  sublease: "Sub-Lease",
  nine: "9 Month Lease",
  twelve: "12 Month Lease",
  academic: "Academic Year",
};

const TABS = [
  { id: "amenities", label: "Overview" },
  { id: "map", label: "Map" },
  { id: "places", label: "Places" },
  { id: "reviews", label: "Reviews" },
  { id: "contact", label: "Contact Manager" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseAddress(addressStr) {
  const match = addressStr?.match(
    /^(.+?\s(?:St|Ave|Dr|Blvd|Rd|Ln|Way|Ct|Pl|Pkwy|Terr?|Cir|Loop|Trail|Trl)\b\.?)\s*,?\s*(.+)$/i
  );
  if (match) return { street: match[1].trim(), cityStateZip: match[2].trim() };
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
      {label && <span className="text-sm text-gray-600 w-32 shrink-0">{label}</span>}
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
            aria-label={readOnly ? undefined : `Rate ${star} star${star > 1 ? "s" : ""}`}
          >
            ★
          </button>
        ))}
      </div>
      {!readOnly && (
        <span className="text-xs text-gray-400">{value ? `${value}/5` : "Select"}</span>
      )}
    </div>
  );
}

function AmenityPill({ label }) {
  return (
    <span className="inline-block bg-gray-100 text-gray-700 text-sm font-medium px-3 py-1 rounded-full border border-gray-200">
      {label}
    </span>
  );
}

function StatCell({ label, value }) {
  return (
    <div className="flex-1 px-4 py-3 text-center min-w-[80px]">
      <div className="text-lg font-semibold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

// ─── Tab: Amenities ───────────────────────────────────────────────────────────

function AmenitiesTab({ listing }) {
  const amenities = listing.amenities || [];
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Amenities</h2>
      {amenities.length === 0 ? (
        <p className="text-gray-400 text-sm italic mb-6">No amenities listed for this property.</p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-6">
          {amenities.map((a) => (
            <AmenityPill key={a} label={a} />
          ))}
        </div>
      )}
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Overview</h2>
      <div className="space-y-2">
        {(listing.description || "").split(/\n+/).filter((p) => p.trim()).map((para, i) => (
          <p key={i} className="text-gray-700 leading-relaxed">{para.trim()}</p>
        ))}
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
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Nearby Places</h2>
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
            {shuttleWalkMinutes != null ? `${shuttleWalkMinutes} min walk` : "N/A"}
          </span>
        </div>
      </div>
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
  const displayed = showAllReviews ? legitimateReviews : legitimateReviews.slice(0, 4);

  return (
    <div>
      {/* Overall rating header */}
      <div className="flex flex-col md:flex-row gap-6 mb-8">
        {/* Left: overall + bar chart */}
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">
            {overallAvg ? (
              <>
                <span className="text-3xl font-bold text-red-500">{overallAvg}</span>
                <span className="text-gray-500 text-base font-normal ml-1">/ 5 Stars ★</span>
              </>
            ) : (
              "No reviews yet"
            )}
          </h2>
          <div className="space-y-1.5">
            {starCounts.map(({ star, count }) => (
              <div key={star} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-4 text-right">{star}</span>
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
                  <div className="text-xl font-bold text-gray-900">{c.value}</div>
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
                <div key={i} className="border border-gray-100 rounded-xl p-4 shadow-sm">
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
                        {date && <div className="text-xs text-gray-400">{date}</div>}
                      </div>
                    </div>
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <span
                          key={s}
                          className={s <= review.rating ? "text-red-500 text-sm" : "text-gray-200 text-sm"}
                        >
                          ★
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-gray-700 text-sm leading-relaxed mb-3">{review.comment}</p>
                  {/* Placeholder upvote/downvote — not wired to backend yet */}
                  <div className="flex gap-4 text-xs text-gray-400">
                    <button type="button" className="flex items-center gap-1 hover:text-green-500 transition">
                      <ThumbsUp size={13} /> <span>0</span>
                    </button>
                    <button type="button" className="flex items-center gap-1 hover:text-red-500 transition">
                      <ThumbsDown size={13} /> <span>0</span>
                    </button>
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
        <h3 className="text-base font-semibold text-gray-900 mb-4">Leave a Review</h3>
        <form onSubmit={handleReviewSubmit} className="space-y-4">
          <StarRow label="Overall" value={rating} onChange={setRating} />
          <StarRow label="Communication" value={commRating} onChange={setCommRating} />
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
              disabled={reviewLoading || !reviewText.trim() || reviewText.trim().length < 5 || rating === 0}
              className="bg-red-600 text-white text-sm font-medium px-6 py-2 rounded-full shadow hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {reviewLoading ? "Posting..." : "Post"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Tab: Contact Manager ─────────────────────────────────────────────────────

function ContactTab({
  listing,
  contactForm,
  setContactForm,
  handleContactSubmit,
  contactLoading,
  contactSent,
}) {
  const owner = listing.owner;

  const handleChange = (field) => (e) =>
    setContactForm((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="max-w-xl">
      {/* Landlord info */}
      <div className="flex items-center gap-4 mb-6">
        <img
          src={owner.image?.trim() ? owner.image : "/default-icons/default-user.png"}
          alt={owner.name}
          className="w-14 h-14 rounded-full object-cover ring-2 ring-gray-100"
        />
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">Listing by</p>
          <Link
            href={`/landlord/${encodeURIComponent(owner._id)}`}
            className="text-lg font-semibold text-gray-900 hover:text-red-600 transition"
          >
            {owner.name}
          </Link>
        </div>
      </div>

      {contactSent ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-green-700 text-sm font-medium">
          Your message was sent! {owner.name} will be in touch soon.
        </div>
      ) : (
        <form onSubmit={handleContactSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600 mb-1 block">First Name *</label>
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
              <label className="text-xs font-medium text-gray-600 mb-1 block">Last Name *</label>
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
            <label className="text-xs font-medium text-gray-600 mb-1 block">Email *</label>
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
            <label className="text-xs font-medium text-gray-600 mb-1 block">Phone Number</label>
            <input
              type="tel"
              value={contactForm.phone}
              onChange={handleChange("phone")}
              placeholder="(123) 456-7890"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500 transition"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Message *</label>
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ListingModalInfo({ session, listing }) {
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("amenities");

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
  const walkTimes = useMemo(() => {
    if (!storedTimes) return {};
    // storedTimes may be a Mongoose Map or a plain object depending on serialisation
    if (typeof storedTimes.get === "function") {
      const obj = {};
      storedTimes.forEach((v, k) => { obj[k] = v; });
      return obj;
    }
    return storedTimes;
  }, [storedTimes]);

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

  // Images
  const images = Array.isArray(listing?.images) ? listing.images.filter(Boolean) : [];
  const coverImage = images[0];
  const secondImage = images[1] || images[0] || null;
  const thirdImage = images[2] || images[1] || images[0] || null;

  // Address
  const { street, cityStateZip } = parseAddress(listing.address);

  // Reviews
  const legitimateReviews = (listing.reviews || []).filter(Boolean).filter((r) => r.legitimacy);
  const overallAvg =
    legitimateReviews.length
      ? (legitimateReviews.reduce((s, r) => s + r.rating, 0) / legitimateReviews.length).toFixed(1)
      : null;
  const starCounts = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: legitimateReviews.filter((r) => Math.round(r.rating) === star).length,
  }));
  function categoryAvg(field) {
    const vals = legitimateReviews.map((r) => r[field]).filter((v) => v != null);
    return vals.length ? (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1) : null;
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
    if (session.user.role !== "student") {
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
      toast.success("Review submitted! It will appear after landlord approval.");
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
    setContactLoading(true);
    try {
      const res = await fetch("/api/contactLandlord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...contactForm,
          landlordEmail: listing.owner.email,
          landlordName: listing.owner.name,
          listingAddress: listing.address,
        }),
      });
      if (res.ok) {
        await fetch("/api/contacted", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId: listing._id }),
        });
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
      <div className="bg-gray-50 min-h-screen">
        <div className="max-w-7xl mx-auto px-4 py-8">

          {/* ── Photo Grid ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-6 h-[400px] overflow-hidden rounded-xl">
            {/* Main image — 2/3 width */}
            <div
              className="md:col-span-2 relative cursor-pointer h-full overflow-hidden rounded-l-xl"
              onClick={() => images.length > 0 && setIsGalleryOpen(true)}
            >
              {coverImage ? (
                <img
                  src={coverImage}
                  alt={listing.address}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gray-200 flex items-center justify-center text-gray-400 text-sm">
                  No photos available
                </div>
              )}
              {/* HeartIcon */}
              <div
                className="absolute top-3 right-3 bg-white/90 backdrop-blur-md rounded-full p-2 shadow-xl border border-white/50 z-10"
                onClick={(e) => e.stopPropagation()}
              >
                <HeartIcon
                  session={session}
                  listingId={listing._id}
                  initial={
                    Boolean(session?.user) &&
                    Boolean(
                      session?.user?.favorites?.some(
                        (f) => String((f && f._id) || f) === String(listing._id)
                      ) || session?.user?.favoritesIds?.includes(String(listing._id))
                    )
                  }
                />
              </div>
            </div>

            {/* Two stacked thumbnails — 1/3 width, hidden on mobile */}
            <div className="hidden md:flex flex-col gap-2 h-full">
              {/* Top thumbnail */}
              <div
                className="relative flex-1 cursor-pointer overflow-hidden rounded-tr-xl"
                onClick={() => setIsGalleryOpen(true)}
              >
                {secondImage ? (
                  <img
                    src={secondImage}
                    alt="Listing photo 2"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-200" />
                )}
              </div>
              {/* Bottom thumbnail with "View All" overlay */}
              <div
                className="relative flex-1 cursor-pointer overflow-hidden rounded-br-xl"
                onClick={() => setIsGalleryOpen(true)}
              >
                {thirdImage ? (
                  <img
                    src={thirdImage}
                    alt="Listing photo 3"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-300" />
                )}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                  <span className="text-white font-semibold text-sm bg-black/30 px-3 py-1.5 rounded-full">
                    View All {images.length > 0 ? `(${images.length})` : ""}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Header Info ── */}
          <div className="bg-white rounded-xl shadow px-6 py-5 mb-4 flex flex-col md:flex-row md:justify-between md:items-start gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{street}</h1>
              {cityStateZip && (
                <p className="text-gray-500 text-sm mt-0.5">{cityStateZip}</p>
              )}
              <p className="text-sm text-gray-500 mt-2">
                Listed by{" "}
                <Link
                  href={`/landlord/${encodeURIComponent(listing.owner._id)}`}
                  className="font-semibold text-gray-800 hover:text-red-600 transition"
                >
                  {listing.owner.name}
                </Link>
              </p>
            </div>
            <div className="flex flex-col gap-2 text-sm text-gray-600 shrink-0">
              <span className="flex items-center gap-2">
                <Phone size={15} className="text-gray-400" />
                {listing.owner.phone && listing.owner.phone !== "N/A"
                  ? listing.owner.phone
                  : "Not provided"}
              </span>
              <span className="flex items-center gap-2">
                <Mail size={15} className="text-gray-400" />
                <a
                  href={`mailto:${listing.owner.email}`}
                  className="hover:text-red-600 transition"
                >
                  {listing.owner.email}
                </a>
              </span>
            </div>
          </div>

          {/* ── Stats Bar ── */}
          <div className="bg-white rounded-xl shadow mb-6 flex flex-wrap divide-y md:divide-y-0 md:divide-x divide-gray-100">
            <StatCell label="/ mo" value={getRentRangeLabel(listing.unitTypes)} />
            <StatCell label="Beds" value={getUnitValuesLabel(listing.unitTypes, "bedrooms")} />
            <StatCell label="Baths" value={getUnitValuesLabel(listing.unitTypes, "bathrooms")} />
            <StatCell label="Sq Ft" value={getAreaRangeLabel(listing.unitTypes)} />
            <StatCell
              label="Lease"
              value={leaseTypeMap[listing.leaseType] || listing.leaseType}
            />
            <StatCell
              label="Rating"
              value={overallAvg ? `★ ${overallAvg}` : "—"}
            />
          </div>

          {/* ── Sticky Tab Bar ── */}
          <div className="sticky top-0 z-30 bg-white border-b border-gray-100 shadow-sm mb-6 -mx-4 px-4">
            <nav className="flex overflow-x-auto max-w-7xl mx-auto">
              {TABS.map((tab) => (
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
            {activeTab === "places" && <PlacesTab walkTimes={walkTimes} walkLoading={walkLoading} shuttleWalkMinutes={listing?.shuttleWalkMinutes ?? null} />}
            {activeTab === "reviews" && (
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
            {activeTab === "contact" && (
              <ContactTab
                listing={listing}
                contactForm={contactForm}
                setContactForm={setContactForm}
                handleContactSubmit={handleContactSubmit}
                contactLoading={contactLoading}
                contactSent={contactSent}
              />
            )}
          </div>
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
              <div className="text-lg font-semibold">Photos ({images.length})</div>
              <button
                type="button"
                onClick={() => setIsGalleryOpen(false)}
                className="text-white/80 hover:text-white text-3xl leading-none"
                aria-label="Close photo gallery"
              >
                ×
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {images.map((src, index) => (
                <img
                  key={`${src}-${index}`}
                  src={src}
                  alt={`Listing photo ${index + 1}`}
                  className="w-full h-64 object-cover rounded-lg shadow"
                  loading="lazy"
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
