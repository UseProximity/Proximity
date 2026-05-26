"use client";

/*
 * Client form for the ambassador referral review flow.
 *
 * Flow:
 *   1. Search an address (Mapbox autocomplete via AddressSearchInput) and pick a verified
 *      suggestion. There is NO "pick our listing vs. make a new one" step — the server
 *      auto-matches the address to our catalog (or creates a stub) on submit.
 *   2. Fill out the review: unit (optional), overall + communication/value/location stars
 *      (half-star), a written review (≥10 chars), and the landlord/company name + contact.
 *   3. Submit to /api/reviewReferral. Reviews auto-publish.
 */

import { useState, useEffect } from "react";
import { useSession, signIn } from "next-auth/react";
import toast from "react-hot-toast";
import AddressSearchInput from "@/components/listings/AddressSearchInput";

const INPUT_CLASS =
  "w-full px-3 py-2.5 text-[15px] border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-200 focus:border-red-400";

// Half-star rating input — clicking the left/right half of a star sets x.5 / x.0.
function HalfStars({ value, onChange, px = 30 }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => {
          const fill = Math.max(0, Math.min(1, value - (i - 1)));
          return (
            <div key={i} className="relative" style={{ width: px, height: px }}>
              <span
                className="absolute inset-0 text-gray-300 leading-none select-none"
                style={{ fontSize: px, lineHeight: 1 }}
              >
                ★
              </span>
              <span
                className="absolute inset-0 overflow-hidden text-yellow-400 leading-none select-none"
                style={{ width: `${fill * 100}%`, fontSize: px, lineHeight: 1 }}
              >
                ★
              </span>
              <button
                type="button"
                aria-label={`${i - 0.5} stars`}
                onClick={() => onChange(i - 0.5)}
                className="absolute inset-y-0 left-0 w-1/2 cursor-pointer"
              />
              <button
                type="button"
                aria-label={`${i} stars`}
                onClick={() => onChange(i)}
                className="absolute inset-y-0 right-0 w-1/2 cursor-pointer"
              />
            </div>
          );
        })}
      </div>
      <span className="text-sm text-gray-400 w-8">{value ? value.toFixed(1) : ""}</span>
    </div>
  );
}

function SubRating({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-700">
        {label} <span className="text-red-500">*</span>
      </span>
      <HalfStars value={value} onChange={onChange} px={22} />
    </div>
  );
}

export default function ReferReviewClient({ referrerId, referrerName }) {
  const { data: session, status } = useSession();
  const loggedIn = !!session?.user?.id;
  const isWustl = !!session?.user?.email?.toLowerCase().endsWith("@wustl.edu");

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

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Review cap: check how many reviews this account has already used.
  const [atLimit, setAtLimit] = useState(false);
  const [reviewLimit, setReviewLimit] = useState(2);
  useEffect(() => {
    if (!loggedIn || !isWustl) return;
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
  }, [loggedIn, isWustl]);

  function handleSelectSuggestion(feature) {
    const [lng, lat] = feature.center || [];
    const place = feature.place_name || "";
    setAddressQuery(place);
    setPicked(lat != null && lng != null ? { place_name: place, lat, lng } : null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    if (!picked) return toast.error("Search and select your property address.");
    if (![rating, comm, val, loc].every((v) => v >= 0.5))
      return toast.error("Please set all four star ratings.");
    if (comment.trim().length < 10)
      return toast.error("Please write at least 10 characters.");
    if (landlordName.trim().length < 2)
      return toast.error("Please enter the landlord or company name.");
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(landlordEmail.trim());
    const phoneOk = landlordPhone.trim().length >= 7;
    if (!noContact && !emailOk && !phoneOk)
      return toast.error("Add a landlord email or phone, or check the box below.");

    const payload = {
      referrerId,
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
          Your review has been posted. Thanks for helping fellow students through{" "}
          {referrerName}.
        </p>
      </div>
    );
  }

  // Gate: a signed-in WashU account is required to review.
  if (status !== "loading" && (!loggedIn || !isWustl)) {
    const callbackUrl = `/refer/${referrerId}`;
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Leave a review</h1>
        <p className="text-gray-600 mb-6">
          Referred by <span className="font-semibold">{referrerName}</span>.
          {loggedIn && !isWustl
            ? " Reviews can only be left from a WashU (@wustl.edu) account. Please sign in with your WashU email."
            : " Sign in with your WashU (@wustl.edu) email to share your experience."}
        </p>
        <button
          onClick={() => signIn(undefined, { callbackUrl })}
          className="px-6 py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition"
        >
          {loggedIn && !isWustl ? "Sign in with WashU" : "Sign in to continue"}
        </button>
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
          Referred by <span className="font-semibold">{referrerName}</span>. Search the
          address of a place you’ve lived and share your experience.
        </p>
      </header>

      {/* Step 1 — address search */}
      <label className="block text-sm font-semibold text-gray-800 mb-1.5">
        Property address <span className="text-red-500">*</span>
      </label>
      {picked ? (
        <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-red-200 bg-red-50">
          <span className="text-[15px] text-gray-800 truncate">{picked.place_name}</span>
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

      {/* Step 2 — review form */}
      {picked && (
        <form onSubmit={handleSubmit} className="mt-6 border-t pt-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1.5">
              Unit number <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={unitNumber}
              onChange={(e) => setUnitNumber(e.target.value)}
              placeholder="e.g. 2B"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1.5">
              Overall rating <span className="text-red-500">*</span>
            </label>
            <HalfStars value={rating} onChange={setRating} />
          </div>

          <div className="space-y-3 bg-gray-50 rounded-xl p-4">
            <SubRating label="Communication" value={comm} onChange={setComm} />
            <SubRating label="Value" value={val} onChange={setVal} />
            <SubRating label="Location" value={loc} onChange={setLoc} />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-800 mb-1.5">
              Your review <span className="text-red-500">*</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="What was it like living here? Landlord, location, value… (min. 10 characters)"
              className={INPUT_CLASS}
            />
          </div>

          {/* Landlord / company */}
          <div className="space-y-3 border-t pt-5">
            <div>
              <label className="block text-sm font-semibold text-gray-800 mb-1.5">
                Landlord / company name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={landlordName}
                onChange={(e) => setLandlordName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5">
                  Landlord email
                </label>
                <input
                  type="email"
                  value={landlordEmail}
                  onChange={(e) => setLandlordEmail(e.target.value)}
                  disabled={noContact}
                  className={`${INPUT_CLASS} disabled:bg-gray-100 disabled:text-gray-400`}
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-800 mb-1.5">
                  Landlord phone
                </label>
                <input
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

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Submitting…" : "Submit review"}
          </button>
        </form>
      )}
    </div>
  );
}
