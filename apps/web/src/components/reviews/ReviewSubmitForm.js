"use client";

/*
 * Shared client form for leaving a property review. Two entry points render it:
 *   - /refer/<ambassadorId> — an ambassador's shareable link (passes referrerId/referrerName)
 *   - /review               — the public "Add a Review" page (no referrer)
 * The flow is identical either way; only the attribution copy differs.
 *
 * The form is progressively disclosed: it opens as a single question and reveals the next
 * step only once the current one is answered. Earlier steps stay visible and editable.
 *
 * Steps:
 *   1. Confirm which school you go / went to. Pre-filled from the signed-in account's email
 *      domain and re-checked server-side, so the school on a review is verified rather than
 *      self-declared.
 *   2. Search an address (Mapbox autocomplete via AddressSearchInput) and pick a verified
 *      suggestion, then an optional unit. There is NO "pick our listing vs. make a new one"
 *      step — the server auto-matches the address to our catalog (or creates a stub).
 *   3. Overall rating (half-star).
 *   4. Communication / value / location ratings (half-star, all required).
 *   5. Written review (≥10 chars).
 *   6. Landlord / company name + contact (or "I don't have it").
 *   7. Anonymous toggle + submit to /api/reviewReferral. Reviews auto-publish.
 */

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import AddressSearchInput from "@/components/listings/AddressSearchInput";
import AuthCard from "@/components/auth/AuthCard";
import StarRatingInput from "@/components/ui/StarRatingInput";
import { SCHOOLS, schoolForEmail, isReviewEligibleEmail } from "@/lib/schools";

const INPUT_CLASS =
  "w-full px-3 py-2.5 text-[15px] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400";

function SubRating({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-700">
        {label} <span className="text-red-500">*</span>
      </span>
      <StarRatingInput
        value={value}
        onChange={onChange}
        px={22}
        ariaLabelPrefix={`Rate ${label}`}
      />
    </div>
  );
}

/*
 * One revealed step. Steps render only once the previous one is answered, so the page
 * starts as a single question and grows as it's filled in. Earlier steps stay on screen
 * and editable — this is progressive disclosure, not a wizard you can't go back in.
 */
function Step({ show, number, title, children }) {
  if (!show) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="border-t border-gray-100 pt-5 first:border-t-0 first:pt-0"
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-50 text-xs font-semibold text-red-600">
          {number}
        </span>
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
      </div>
      {children}
    </motion.div>
  );
}

export default function ReviewSubmitForm({
  referrerId = null,
  referrerName = null,
  callbackUrl = "/review",
}) {
  const { data: session, status } = useSession();
  const loggedIn = !!session?.user?.id;
  const email = session?.user?.email || "";
  const eligible = isReviewEligibleEmail(email);
  const emailSchool = schoolForEmail(email);

  // School — pre-filled from the account's email domain, which is also what the server
  // validates against, so the field is confirmation rather than a free-form claim.
  const [school, setSchool] = useState("");
  useEffect(() => {
    if (emailSchool) setSchool(emailSchool.shortName);
  }, [emailSchool]);
  const schoolMismatch = !!school && !!emailSchool && school !== emailSchool.shortName;
  const schoolReady = !!school && !schoolMismatch;

  // Address selection
  const [addressQuery, setAddressQuery] = useState("");
  const [picked, setPicked] = useState(null); // { place_name, lat, lng }

  // Review fields
  const [unitNumber, setUnitNumber] = useState("");
  const [rating, setRating] = useState(0);
  const [comm, setComm] = useState(0);
  const [val, setVal] = useState(0);
  const [loc, setLoc] = useState(0);
  const [comment, setComment] = useState("");

  // Landlord / company
  const [landlordName, setLandlordName] = useState("");
  const [landlordEmail, setLandlordEmail] = useState("");
  const [landlordPhone, setLandlordPhone] = useState("");
  const [noContact, setNoContact] = useState(false);
  const [anonymous, setAnonymous] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Progressive reveal — each step only renders once the step before it is answered.
  const landlordEmailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(landlordEmail.trim());
  const landlordPhoneOk = landlordPhone.trim().length >= 7;
  const addressReady = !!picked;
  const overallReady = rating >= 0.5;
  const categoriesReady = comm >= 0.5 && val >= 0.5 && loc >= 0.5;
  const commentReady = comment.trim().length >= 10;
  const landlordReady =
    landlordName.trim().length >= 2 &&
    (noContact || landlordEmailOk || landlordPhoneOk);

  // Review cap: check how many reviews this account has already used.
  const [atLimit, setAtLimit] = useState(false);
  const [reviewLimit, setReviewLimit] = useState(2);
  useEffect(() => {
    if (!loggedIn || !eligible) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/reviewReferral");
        if (!res.ok) return;
        const data = await res.json();
        if (!active) return;
        setReviewLimit(data.limit ?? 2);
        setAtLimit(!!data.atLimit);
      } catch {
        /* non-blocking; server still enforces on submit */
      }
    })();
    return () => {
      active = false;
    };
  }, [loggedIn, eligible]);

  // Every step now lives in one <form>, so Enter in any single-line field (address
  // search, unit, landlord contact) would otherwise submit a half-finished review.
  function handleFormKeyDown(e) {
    if (e.key === "Enter" && e.target.tagName === "INPUT") e.preventDefault();
  }

  function handleSelectSuggestion(feature) {
    const [lng, lat] = feature.center || [];
    const place = feature.place_name || "";
    setAddressQuery(place);
    setPicked(lat != null && lng != null ? { place_name: place, lat, lng } : null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    if (!school) return toast.error("Select the school you go / went to.");
    if (schoolMismatch)
      return toast.error(
        `Your account email is ${emailSchool.shortName}. Pick that school, or sign in with your ${school} email.`
      );
    if (!picked) return toast.error("Search and select your property address.");
    if (![rating, comm, val, loc].every((v) => v >= 0.5))
      return toast.error("Please set all four star ratings.");
    if (comment.trim().length < 10)
      return toast.error("Please write at least 10 characters.");
    if (landlordName.trim().length < 2)
      return toast.error("Please enter the landlord or company name.");
    if (!noContact && !landlordEmailOk && !landlordPhoneOk)
      return toast.error("Add a landlord email or phone, or check the box below.");

    const payload = {
      referrerId,
      school,
      address: picked.place_name,
      latitude: picked.lat,
      longitude: picked.lng,
      rating,
      communicationRating: comm,
      valueRating: val,
      locationRating: loc,
      comment: comment.trim(),
      unitNumber: unitNumber.trim() || null,
      landlordName: landlordName.trim(),
      landlordEmail: landlordEmail.trim() || null,
      landlordPhone: landlordPhone.trim() || null,
      noLandlordContact: noContact,
      anonymous,
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/reviewReferral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Something went wrong.");
        return;
      }
      setDone(true);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-lg mx-auto px-4 py-24 text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Thank you!</h1>
        <p className="text-gray-600">
          {referrerName
            ? `Your review has been posted. Thanks for helping fellow students through ${referrerName}.`
            : "Your review has been posted. Thanks for helping fellow students find a better place to live."}
        </p>
      </div>
    );
  }

  // Gate: a signed-in student account from a school we serve is required to review.
  if (status !== "loading" && (!loggedIn || !eligible)) {
    return (
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Leave a review</h1>
          <p className="text-gray-600">
            {referrerName && (
              <>
                Referred by <span className="font-semibold">{referrerName}</span>.{" "}
              </>
            )}
            {loggedIn && !eligible
              ? "Reviews can only be left from a student account at a school we serve. Sign in with your school email below."
              : "Sign in or create an account with your school email to share your experience."}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Currently serving {SCHOOLS.map((s) => s.shortName).join(", ")}.
          </p>
        </div>
        <div className="flex justify-center">
          <AuthCard callbackUrl={callbackUrl} initialTab="signin" />
        </div>
      </div>
    );
  }

  // Account has used all its allowed reviews.
  if (atLimit) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">You’re all set</h1>
        <p className="text-gray-600">
          Your account has reached the maximum of {reviewLimit} reviews. Thanks for
          contributing to Proximity!
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Leave a review</h1>
        <p className="text-gray-600 mt-1">
          {referrerName && (
            <>
              Referred by <span className="font-semibold">{referrerName}</span>.{" "}
            </>
          )}
          Search the address of a place you’ve lived and share your experience.
        </p>
      </header>

      <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="space-y-5">
        <Step show number={1} title="What school do/did you go to?">
          <select
            id="review-school"
            value={school}
            onChange={(e) => setSchool(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Select your school…</option>
            {SCHOOLS.map((s) => (
              <option key={s.shortName} value={s.shortName}>
                {s.label}
              </option>
            ))}
          </select>
          {schoolMismatch && (
            <p className="mt-1.5 text-sm text-red-600">
              Your account email belongs to {emailSchool.label}. Pick that school, or sign
              in with your {school} email to review as a {school} student.
            </p>
          )}
        </Step>

        <Step show={schoolReady} number={2} title="Which property are you reviewing?">
          {picked ? (
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-red-200 bg-red-50">
              <span className="text-[15px] text-gray-800 truncate">
                {picked.place_name}
              </span>
              <button
                type="button"
                onClick={() => {
                  setPicked(null);
                  setAddressQuery("");
                }}
                className="text-sm text-red-600 hover:underline flex-shrink-0"
              >
                Change
              </button>
            </div>
          ) : (
            <AddressSearchInput
              value={addressQuery}
              onChange={(e) => {
                setAddressQuery(e.target.value);
                setPicked(null);
              }}
              onSelectSuggestion={handleSelectSuggestion}
              placeholder="Start typing an address…"
              className={INPUT_CLASS}
            />
          )}
          {picked && (
            <div className="mt-3">
              <label
                htmlFor="review-unit"
                className="block text-sm text-gray-600 mb-1.5"
              >
                Unit number <span className="text-gray-400">(optional)</span>
              </label>
              <input
                id="review-unit"
                type="text"
                value={unitNumber}
                onChange={(e) => setUnitNumber(e.target.value)}
                placeholder="e.g. 2B"
                className={INPUT_CLASS}
              />
            </div>
          )}
        </Step>

        <Step show={addressReady} number={3} title="How was it overall?">
          <StarRatingInput value={rating} onChange={setRating} />
        </Step>

        <Step show={overallReady} number={4} title="Rate the details">
          <div className="space-y-3 bg-gray-50 rounded-xl p-4">
            <SubRating label="Communication" value={comm} onChange={setComm} />
            <SubRating label="Value" value={val} onChange={setVal} />
            <SubRating label="Location" value={loc} onChange={setLoc} />
          </div>
        </Step>

        <Step show={categoriesReady} number={5} title="Tell other students about it">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={4}
            placeholder="What was it like living here? Landlord, location, value… (min. 10 characters)"
            className={INPUT_CLASS}
          />
        </Step>

        <Step show={commentReady} number={6} title="Who was the landlord?">
          <div className="space-y-3">
            <div>
              <label
                htmlFor="review-landlord-name"
                className="block text-sm text-gray-600 mb-1.5"
              >
                Landlord / company name <span className="text-red-500">*</span>
              </label>
              <input
                id="review-landlord-name"
                type="text"
                value={landlordName}
                onChange={(e) => setLandlordName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="review-landlord-email"
                  className="block text-sm text-gray-600 mb-1.5"
                >
                  Landlord email
                </label>
                <input
                  id="review-landlord-email"
                  type="email"
                  value={landlordEmail}
                  onChange={(e) => setLandlordEmail(e.target.value)}
                  disabled={noContact}
                  className={`${INPUT_CLASS} disabled:bg-gray-100 disabled:text-gray-400`}
                />
              </div>
              <div>
                <label
                  htmlFor="review-landlord-phone"
                  className="block text-sm text-gray-600 mb-1.5"
                >
                  Landlord phone
                </label>
                <input
                  id="review-landlord-phone"
                  type="tel"
                  value={landlordPhone}
                  onChange={(e) => setLandlordPhone(e.target.value)}
                  disabled={noContact}
                  className={`${INPUT_CLASS} disabled:bg-gray-100 disabled:text-gray-400`}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={noContact}
                onChange={(e) => setNoContact(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-400"
              />
              I do not have their contact information
            </label>
          </div>
        </Step>

        <Step show={landlordReady} number={7} title="Post your review">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-400"
            />
            <span className="text-sm text-gray-700">
              <span className="font-semibold">Post anonymously</span>
              <span className="block text-gray-500">
                Your name and photo won&apos;t appear on the listing — it&apos;ll show as
                “Anonymous.”
              </span>
            </span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : "Submit review"}
          </button>
        </Step>
      </form>
    </div>
  );
}
