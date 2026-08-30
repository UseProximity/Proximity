"use client";

/*
 * The off-campus branch of the review flow: review a property you've rented.
 *
 * Rendered by ReviewFlow (which asks the on/off-campus question first) for both
 * entry points:
 *   - /review:               the public page, and where a scanned QR code lands
 *   - /refer/<ambassadorId>: an ambassador's shareable link (adds attribution)
 *
 * The form is progressively disclosed: it opens as a single question and reveals
 * the next step only once the current one is answered. Earlier steps stay
 * visible and editable.
 *
 * SIGNED IN vs SIGNED OUT is the main structural difference:
 *   - Signed in: the school comes from the account's email domain (step 1) and
 *     the review is attributed to that account, exactly as before.
 *   - Signed out (the QR case): there is no school step, because the school is
 *     derived from the school email collected in the contact block at the
 *     bottom. Either way the school is proved by an email domain and never
 *     self-declared, and that is the property that makes a school tag trustworthy.
 *
 * Steps: property + unit → overall rating → category ratings → written review →
 * landlord → who you are / post.
 */

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import AddressSearchInput from "@/components/listings/AddressSearchInput";
import AuthCard from "@/components/auth/AuthCard";
import StarRatingInput from "@/components/ui/StarRatingInput";
import { UNIT_DESIGNATORS } from "@/components/listings/listingFormOptions";
import { SCHOOLS, schoolForEmail, isReviewEligibleEmail } from "@/lib/schools";
import { INPUT_CLASS, PAGE_BOTTOM_PADDING, Step, SubRating } from "./reviewFormUi";
import ReviewerContactFields, {
  EMAIL_RE,
  EMPTY_CONTACT,
  contactReady,
} from "./ReviewerContactFields";

export default function ReviewSubmitForm({
  referrerId = null,
  referrerName = null,
  callbackUrl = "/review",
  source = null,
  onSubmitted,
}) {
  const { data: session, status } = useSession();
  const loggedIn = !!session?.user?.id;
  const accountEmail = session?.user?.email || "";
  const eligible = isReviewEligibleEmail(accountEmail);
  const emailSchool = schoolForEmail(accountEmail);

  // A signed-out reviewer supplies their own identity; a signed-in one doesn't.
  const requireContact = status !== "loading" && !loggedIn;

  // School: signed in, pre-filled from the account's email domain (which the
  // server re-checks). Signed out, implied by the contact email instead.
  const [school, setSchool] = useState("");
  useEffect(() => {
    if (emailSchool) setSchool(emailSchool.shortName);
  }, [emailSchool]);
  const schoolMismatch = !!school && !!emailSchool && school !== emailSchool.shortName;
  const schoolReady = loggedIn ? !!school && !schoolMismatch : true;

  // Address selection
  const [addressQuery, setAddressQuery] = useState("");
  const [picked, setPicked] = useState(null); // { place_name, lat, lng }

  // Review fields
  const [unitDesignator, setUnitDesignator] = useState("");
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

  // Who's reviewing (signed-out only) + how it's shown
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [anonymous, setAnonymous] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Progressive reveal: each step only renders once the step before it is answered.
  const landlordEmailOk = EMAIL_RE.test(landlordEmail.trim());
  const landlordPhoneOk = landlordPhone.trim().length >= 7;
  const addressReady = !!picked;
  const overallReady = rating >= 0.5;
  const categoriesReady = comm >= 0.5 && val >= 0.5 && loc >= 0.5;
  const commentReady = comment.trim().length >= 10;
  const landlordReady =
    landlordName.trim().length >= 2 &&
    (noContact || landlordEmailOk || landlordPhoneOk);

  // A signed-out reviewer's school comes from the address they typed in.
  const contactSchool = schoolForEmail(contact.email);
  const contactSchoolMismatch =
    requireContact && EMAIL_RE.test(contact.email.trim()) && !contactSchool;
  const identityReady = contactReady(contact, { requireContact }) && !contactSchoolMismatch;

  // 'Whole' means the lease covered the entire property, so it carries no number.
  const wholeProperty = unitDesignator === "Whole";

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

  // Every step lives in one <form>, so Enter in any single-line field (address
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

    if (loggedIn) {
      if (!school) return toast.error("Select the school you go / went to.");
      if (schoolMismatch)
        return toast.error(
          `Your account email is ${emailSchool.shortName}. Pick that school, or sign in with your ${school} email.`
        );
    }
    if (!picked) return toast.error("Search and select your property address.");
    if (![rating, comm, val, loc].every((v) => v >= 0.5))
      return toast.error("Please set all four star ratings.");
    if (comment.trim().length < 10)
      return toast.error("Please write at least 10 characters.");
    if (landlordName.trim().length < 2)
      return toast.error("Please enter the landlord or company name.");
    if (!noContact && !landlordEmailOk && !landlordPhoneOk)
      return toast.error("Add a landlord email or phone, or check the box below.");
    if (requireContact && !contactReady(contact, { requireContact }))
      return toast.error("Add your name, class year and school email.");
    if (contactSchoolMismatch)
      return toast.error("Use your school email address so we can verify your review.");

    const payload = {
      referrerId,
      school: loggedIn ? school : contactSchool?.shortName,
      address: picked.place_name,
      latitude: picked.lat,
      longitude: picked.lng,
      rating,
      communicationRating: comm,
      valueRating: val,
      locationRating: loc,
      comment: comment.trim(),
      unitDesignator: unitDesignator || null,
      unitNumber: wholeProperty ? null : unitNumber.trim() || null,
      landlordName: landlordName.trim(),
      landlordEmail: landlordEmail.trim() || null,
      landlordPhone: landlordPhone.trim() || null,
      noLandlordContact: noContact,
      anonymous,
      source,
      // Only sent when signed out; the server ignores it otherwise and uses the session.
      reviewer: requireContact
        ? {
            firstName: contact.firstName.trim(),
            lastName: contact.lastName.trim(),
            classYear: contact.classYear,
            email: contact.email.trim(),
          }
        : null,
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
      // The parent owns what happens next: an account was created for a
      // signed-out reviewer, so it offers the profile step instead of a
      // dead-end thank-you.
      if (onSubmitted) onSubmitted(data);
      else setDone(true);
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className={`max-w-lg mx-auto px-4 py-24 text-center ${PAGE_BOTTOM_PADDING}`}>
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

  /*
   * Gate: only a SIGNED-IN account on a school we don't serve is turned away.
   * Being signed out is no longer a gate at all, which is the point of the QR
   * flow, so an anonymous reviewer falls through to the form below.
   */
  if (status !== "loading" && loggedIn && !eligible) {
    return (
      <div className="max-w-md mx-auto px-4 py-12">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Leave a review</h1>
          <p className="text-gray-600">
            Reviews can only be left from a student account at a school we serve. Sign in
            with your school email below.
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

  // Step numbers shift by one depending on whether the school step is shown.
  let n = 0;
  const step = () => ++n;

  return (
    <form onSubmit={handleSubmit} onKeyDown={handleFormKeyDown} className="space-y-5">
      {loggedIn && (
        <Step show number={step()} title="What school do/did you go to?">
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
      )}

      <Step show={schoolReady} number={step()} title="Which property are you reviewing?">
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
        {picked && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="review-unit-designator" className="block text-sm text-gray-600 mb-1.5">
                Unit type <span className="text-gray-400">(optional)</span>
              </label>
              <select
                id="review-unit-designator"
                value={unitDesignator}
                onChange={(e) => {
                  const next = e.target.value;
                  setUnitDesignator(next);
                  if (next === "Whole") setUnitNumber("");
                }}
                className={INPUT_CLASS}
              >
                <option value="">Not sure</option>
                {UNIT_DESIGNATORS.map((d) => (
                  <option key={d} value={d}>
                    {d === "Whole" ? "Whole property" : d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="review-unit" className="block text-sm text-gray-600 mb-1.5">
                Number <span className="text-gray-400">(optional)</span>
              </label>
              <input
                id="review-unit"
                type="text"
                value={unitNumber}
                onChange={(e) => setUnitNumber(e.target.value)}
                disabled={wholeProperty}
                placeholder={unitDesignator === "Floor" ? "e.g. 3" : "e.g. 2B"}
                className={`${INPUT_CLASS} disabled:bg-gray-100 disabled:text-gray-400`}
              />
            </div>
          </div>
        )}
      </Step>

      <Step show={addressReady} number={step()} title="How was it overall?">
        <div className="flex justify-center py-1">
          <StarRatingInput value={rating} onChange={setRating} />
        </div>
      </Step>

      <Step show={overallReady} number={step()} title="Rate the details">
        <div className="space-y-3 bg-gray-50 rounded-xl p-4">
          <SubRating label="Communication" value={comm} onChange={setComm} />
          <SubRating label="Value" value={val} onChange={setVal} />
          <SubRating label="Location" value={loc} onChange={setLoc} />
        </div>
      </Step>

      <Step show={categoriesReady} number={step()} title="Tell other students about it">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          placeholder="What was it like living here? Landlord, location, value… (min. 10 characters)"
          className={INPUT_CLASS}
        />
      </Step>

      <Step show={commentReady} number={step()} title="Who was the landlord?">
        <div className="space-y-3">
          <div>
            <label htmlFor="review-landlord-name" className="block text-sm text-gray-600 mb-1.5">
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
              <label htmlFor="review-landlord-email" className="block text-sm text-gray-600 mb-1.5">
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
              <label htmlFor="review-landlord-phone" className="block text-sm text-gray-600 mb-1.5">
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

      <Step
        show={landlordReady}
        number={step()}
        title={requireContact ? "Almost done: who are you?" : "Post your review"}
      >
        <ReviewerContactFields
          contact={contact}
          onContactChange={setContact}
          anonymous={anonymous}
          onAnonymousChange={setAnonymous}
          requireContact={requireContact}
          schoolMismatch={contactSchoolMismatch}
          postingAs={loggedIn ? session?.user?.name || accountEmail : null}
        />

        <button
          type="submit"
          disabled={submitting || !identityReady}
          className="mt-4 w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Submitting…" : "Submit review"}
        </button>
      </Step>
    </form>
  );
}
