"use client";

import { useState } from "react";
import { MapPin, Star, Footprints, Building2 } from "lucide-react";
import toast from "react-hot-toast";
import { trackEvent } from "@/utils/analytics";

function ReviewRow({ review }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <Star size={14} className="text-gray-400" />
        <span className="text-sm font-semibold text-gray-900">{Number(review.rating).toFixed(1)}</span>
        <span className="text-xs text-gray-400">
          {new Date(review.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
        </span>
      </div>
      {review.comment && <p className="mt-2 text-sm leading-6 text-gray-600">{review.comment}</p>}
    </div>
  );
}

// Reviews across the listings matching a landlord/company name the student typed in.
function LandlordReviews({ landlord }) {
  return (
    <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-6">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-red-500">
          Landlord on Proximity
        </p>
        <div className="mt-2 flex items-center gap-2 text-gray-900">
          <Building2 size={18} className="text-gray-400" />
          <span className="font-bold">&ldquo;{landlord.query}&rdquo;</span>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          {landlord.listingCount} {landlord.listingCount === 1 ? "listing" : "listings"} under that
          name
          {landlord.reviewCount > 0 && (
            <>
              , averaging {Number(landlord.avgRating).toFixed(1)} / 5 across {landlord.reviewCount}{" "}
              student {landlord.reviewCount === 1 ? "review" : "reviews"}
            </>
          )}
          .
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Matched by the name you entered, not by your exact building.
          {landlord.matchedExamples?.length > 0 && (
            <> Includes: {landlord.matchedExamples.join(", ")}.</>
          )}
        </p>
      </div>
      {landlord.lowReviews?.length > 0 && (
        <div className="space-y-3 p-6">
          <h3 className="text-sm font-bold text-gray-900">What students flagged</h3>
          {landlord.lowReviews.map((r, i) => (
            <ReviewRow key={i} review={r} />
          ))}
        </div>
      )}
    </div>
  );
}

/*
 * Reviews + comps for a high-confidence match, plus two correction paths: by address
 * and by landlord/company name. When the address match is low/none, ONLY the lookup
 * forms render. Showing another building's reviews is the one unforgivable bug here,
 * so nothing is ever attributed without either an exact match or the student's own
 * input.
 */
export default function PropertyContext({ leaseCheckId, property, rentBasis, landlordName, onProperty }) {
  const [address, setAddress] = useState("");
  const [landlordQuery, setLandlordQuery] = useState(landlordName || "");
  const [landlord, setLandlord] = useState(null);
  const [lookingAddress, setLookingAddress] = useState(false);
  const [lookingLandlord, setLookingLandlord] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);

  const matched = property?.matchConfidence === "high" && property.listing;

  const submitAddress = async (e) => {
    e.preventDefault();
    if (!address.trim() || lookingAddress) return;
    setLookingAddress(true);
    try {
      const res = await fetch("/api/lease-check/property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseCheckId,
          address: address.trim(),
          rent: rentBasis?.rent ?? null,
          bedrooms: rentBasis?.bedrooms ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");
      trackEvent("Lease Check Address Corrected", {
        foundListing: data.property?.matchConfidence === "high",
      });
      if (data.property?.matchConfidence !== "high") {
        toast.error("Couldn't find that address on Proximity yet.");
      }
      onProperty(data.property);
      setShowCorrection(false);
      setAddress("");
    } catch (err) {
      toast.error(err.message || "Couldn't look that up. Try again?");
    } finally {
      setLookingAddress(false);
    }
  };

  const submitLandlord = async (e) => {
    e.preventDefault();
    if (!landlordQuery.trim() || lookingLandlord) return;
    setLookingLandlord(true);
    try {
      const res = await fetch("/api/lease-check/property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseCheckId, landlordName: landlordQuery.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");
      trackEvent("Lease Check Landlord Searched", { foundListings: !!data.landlord });
      if (!data.landlord) {
        toast.error("No listings under that name on Proximity yet.");
      }
      setLandlord(data.landlord);
    } catch (err) {
      toast.error(err.message || "Couldn't look that up. Try again?");
    } finally {
      setLookingLandlord(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500";
  const buttonClass =
    "bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors px-5 shrink-0";

  const addressForm = (
    <form onSubmit={submitAddress} className="mt-2 flex gap-2">
      <input
        type="text"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="Street address, e.g. 6633 Clemens Ave"
        className={inputClass}
      />
      <button type="submit" disabled={lookingAddress || !address.trim()} className={buttonClass}>
        {lookingAddress ? "Looking…" : "Look it up"}
      </button>
    </form>
  );

  const landlordForm = (
    <form onSubmit={submitLandlord} className="mt-2 flex gap-2">
      <input
        type="text"
        value={landlordQuery}
        onChange={(e) => setLandlordQuery(e.target.value)}
        placeholder="Landlord or company, e.g. Clocktower"
        className={inputClass}
      />
      <button type="submit" disabled={lookingLandlord || !landlordQuery.trim()} className={buttonClass}>
        {lookingLandlord ? "Searching…" : "Search"}
      </button>
    </form>
  );

  if (!matched) {
    return (
      <div className="space-y-4">
        <div className="rounded-[1.75rem] border border-dashed border-gray-300 bg-gray-50 p-6">
          <p className="text-sm font-semibold text-gray-700">
            We couldn&apos;t match this lease to a listing on Proximity.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Tell us where, and we&apos;ll pull that building&apos;s reviews and check for cheaper
            places nearby.
          </p>
          {addressForm}
          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
            Or search by landlord
          </p>
          <p className="mt-1 text-xs text-gray-500">
            We&apos;ll show student reviews across everything they list here.
          </p>
          {landlordForm}
        </div>
        {landlord && <LandlordReviews landlord={landlord} />}
      </div>
    );
  }

  const { listing, reviews, comps } = property;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-6">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-red-500">
            What Proximity knows
          </p>
          <div className="mt-2 flex items-center gap-2 text-gray-900">
            <MapPin size={18} className="text-gray-400" />
            <span className="font-bold">{listing.title || listing.address}</span>
          </div>
          {reviews?.reviewCount > 0 && (
            <p className="mt-1 text-sm text-gray-600">
              {Number(reviews.avgRating).toFixed(1)} / 5 across {reviews.reviewCount}{" "}
              {reviews.reviewCount === 1 ? "review" : "reviews"} from students.
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowCorrection((v) => !v)}
            className="mt-2 text-xs text-gray-400 hover:text-red-600 transition"
          >
            Not the right place?
          </button>
          {showCorrection && addressForm}
        </div>

        {(reviews?.lowReviews?.length > 0 || reviews?.landlordReviews?.length > 0) && (
          <div className="space-y-3 border-b border-gray-100 p-6">
            {reviews.lowReviews.length > 0 && (
              <>
                <h3 className="text-sm font-bold text-gray-900">
                  What students flagged about this building
                </h3>
                {reviews.lowReviews.map((r, i) => (
                  <ReviewRow key={`listing-${i}`} review={r} />
                ))}
              </>
            )}
            {reviews.landlordReviews.length > 0 && (
              <>
                <h3 className="pt-2 text-sm font-bold text-gray-900">
                  Reviews of this landlord&apos;s other properties
                </h3>
                <p className="text-xs text-gray-500">
                  These are about different buildings from the same landlord, not this one.
                </p>
                {reviews.landlordReviews.map((r, i) => (
                  <ReviewRow key={`landlord-${i}`} review={r} />
                ))}
              </>
            )}
          </div>
        )}

        {comps?.comps?.length > 0 && (
          <div className="p-6">
            <h3 className="text-sm font-bold text-gray-900">Cheaper nearby, same or more bedrooms</h3>
            <p className="mt-1 text-xs text-gray-500">
              Compared per person, per month. Your lease works out to about $
              {comps.leasePerPersonPerMonth}/mo per person.
            </p>
            <div className="mt-3 space-y-3">
              {comps.comps.map((comp) => (
                <a
                  key={comp.id}
                  href={`/listings/${comp.id}`}
                  className="block rounded-xl border border-gray-200 p-4 transition hover:border-red-400 hover:bg-red-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-gray-900">
                      {comp.title || comp.address}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-red-50 px-3 py-1 font-semibold uppercase tracking-[0.18em] text-red-600 text-[10px] shrink-0">
                      ${comp.perPersonRent}/mo per person
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                    <span>{comp.bedrooms}+ bed</span>
                    <span>{comp.distanceKm} km away</span>
                    {comp.walk && (
                      <span className="flex items-center gap-1">
                        <Footprints size={12} />
                        {comp.walk.minutes} min to {comp.walk.place}
                      </span>
                    )}
                  </p>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
      {landlord && <LandlordReviews landlord={landlord} />}
    </div>
  );
}
