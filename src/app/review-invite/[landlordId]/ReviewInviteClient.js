"use client";

/*
 * Client form for the landlord review-invite flow (/review-invite/<landlordId>).
 *
 * Flow:
 *   1. Tenant lands on the page (already sees the landlord's listings).
 *   2. Auth gate: must be signed in with a @wustl.edu account.
 *   3. Pick a listing from a dropdown, set integer 1–5 stars, write a review
 *      (≥5 chars), optionally rate Communication / Location / Value.
 *   4. Submit to /api/submitReview (unchanged shared endpoint). Reviews
 *      auto-publish via the existing legitimacy=true path.
 *
 * NOTE: /api/submitReview only allows roles 'student' and 'super'. A landlord
 * testing their own link will get a 403 — expected for v1.
 */

import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import AuthCard from "@/components/auth/AuthCard";

// Matches inputs across the rest of the site (see SubleaseFormPanel / ListingFormPanel).
const INPUT_CLASS =
  "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500";

const FIELD_LABEL_CLASS = "block text-sm font-medium text-gray-700 mb-1";

const SECTION_LABEL_CLASS =
  "text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3";

const PAGE_WRAPPER_CLASS = "min-h-screen bg-gray-50 py-8 px-4";

function StarRow({ value, onChange, size = "text-3xl" }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
          className={`${size} leading-none transition ${
            star <= value
              ? "text-yellow-400"
              : "text-gray-300 hover:text-yellow-300"
          }`}
        >
          ★
        </button>
      ))}
      <span className="ml-2 text-sm text-gray-500 w-16">
        {value ? `${value} / 5` : ""}
      </span>
    </div>
  );
}

function SubRatingRow({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-sm text-gray-700">{label}</span>
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(value === star ? 0 : star)}
            aria-label={`Rate ${label} ${star} star${star > 1 ? "s" : ""}`}
            className={`text-xl leading-none transition ${
              star <= value
                ? "text-yellow-400"
                : "text-gray-300 hover:text-yellow-300"
            }`}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ReviewInviteClient({ landlord, listings }) {
  const { data: session, status } = useSession();
  const loggedIn = !!session?.user?.id;
  const isWustl = !!session?.user?.email
    ?.toLowerCase()
    .endsWith("@wustl.edu");

  const [listingId, setListingId] = useState(listings[0]?.id ?? "");
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [comm, setComm] = useState(0);
  const [loc, setLoc] = useState(0);
  const [val, setVal] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  // After success we remember the listing the review was attached to so the
  // thank-you screen can deep-link to it (the form's listingId may be reset
  // separately later if we ever add that back).
  const [submittedListingId, setSubmittedListingId] = useState(null);

  const submittedListing = listings.find((l) => l.id === submittedListingId);
  const submittedListingLabel =
    submittedListing?.title || submittedListing?.address || "this property";

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    if (!listingId) return toast.error("Pick which property you're reviewing.");
    if (rating < 1 || rating > 5)
      return toast.error("Pick an overall rating between 1 and 5 stars.");
    if (comment.trim().length < 5)
      return toast.error("Write at least 5 characters in your review.");

    const payload = {
      listingId,
      rating,
      comment: comment.trim(),
      ...(comm > 0 && { communicationRating: comm }),
      ...(loc > 0 && { locationRating: loc }),
      ...(val > 0 && { valueRating: val }),
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/submitReview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error || "Something went wrong.");
        return;
      }
      setSubmittedListingId(listingId);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Empty state — the landlord has no listings to review yet.
  if (listings.length === 0) {
    return (
      <div className={PAGE_WRAPPER_CLASS}>
        <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 px-6 py-12 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            No properties yet
          </h1>
          <p className="text-sm text-gray-600">
            {landlord.name} doesn’t have any listings on Proximity yet. Check back
            once they’ve added a property.
          </p>
        </div>
      </div>
    );
  }

  // Success — single CTA back to the listing so the tenant can see their
  // review live. Intentionally no "leave another" button: most tenants only
  // lived in one of the landlord's properties, and offering a repeat action
  // reads as review farming.
  if (submittedListingId) {
    return (
      <div className={PAGE_WRAPPER_CLASS}>
        <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200 px-6 py-12 text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Thank you!</h1>
          <p className="text-sm text-gray-600 mb-6">
            Your review of{" "}
            <span className="font-semibold">{submittedListingLabel}</span> has
            been posted. It will help other WashU students decide where to live.
          </p>
          <Link
            href={`/browse?listing=${submittedListingId}`}
            className="inline-block px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold transition"
          >
            View your review →
          </Link>
        </div>
      </div>
    );
  }

  // Auth gate — signed-in WashU account required to submit a review.
  if (status !== "loading" && (!loggedIn || !isWustl)) {
    return (
      <div className={PAGE_WRAPPER_CLASS}>
        <div className="max-w-md mx-auto">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Review {landlord.name}’s property
            </h1>
            <p className="text-sm text-gray-600">
              {loggedIn && !isWustl
                ? "Reviews can only be left from a WashU (@wustl.edu) account — sign in with your WashU email below."
                : "Sign in or create an account with your WashU (@wustl.edu) email to share your experience."}
            </p>
          </div>
          <div className="flex justify-center">
            <AuthCard
              callbackUrl={`/review-invite/${landlord.id}`}
              initialTab="signin"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={PAGE_WRAPPER_CLASS}>
      <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-gray-200">
        {/* Header — mirrors SubleaseFormPanel / ListingFormPanel */}
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-bold text-gray-900">
            Review {landlord.name}’s property
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Pick which place you lived in and share your experience. Your review
            posts immediately so future students can find it.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {/* Review Details section */}
          <div>
            <h3 className={SECTION_LABEL_CLASS}>Review Details</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="listing" className={FIELD_LABEL_CLASS}>
                  Which property? <span className="text-red-500">*</span>
                </label>
                <select
                  id="listing"
                  value={listingId}
                  onChange={(e) => setListingId(e.target.value)}
                  className={`${INPUT_CLASS} bg-white`}
                >
                  {listings.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.title || l.address}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className={FIELD_LABEL_CLASS}>
                  Overall rating <span className="text-red-500">*</span>
                </label>
                <StarRow value={rating} onChange={setRating} />
              </div>

              <div>
                <label htmlFor="comment" className={FIELD_LABEL_CLASS}>
                  Your review <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={4}
                  maxLength={1000}
                  placeholder="What was it like living here? Landlord, location, value… (min. 5 characters)"
                  className={INPUT_CLASS}
                />
              </div>
            </div>
          </div>

          {/* Optional sub-ratings — click a star to set, click same star to clear. */}
          <div>
            <h3 className={SECTION_LABEL_CLASS}>Optional Category Ratings</h3>
            <div className="bg-gray-50 rounded-lg border border-gray-200 px-4 py-3 space-y-1">
              <SubRatingRow
                label="Communication"
                value={comm}
                onChange={setComm}
              />
              <SubRatingRow label="Location" value={loc} onChange={setLoc} />
              <SubRatingRow label="Value" value={val} onChange={setVal} />
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Only review properties you’ve actually lived in. Fake reviews violate
            Proximity’s terms.
          </p>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Posting…" : "Post review"}
          </button>
        </form>
      </div>
    </div>
  );
}
