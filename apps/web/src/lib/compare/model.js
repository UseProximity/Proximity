/*
 * Pure helpers for the /compare page. No React, no fetching: take two built
 * listings (the getListing shape), the student's unit/offer choices and the
 * rent basis, and produce the rows the page draws.
 */

import { leaseRentBasis } from "@/lib/listings/rentBasis";
import { isRoomShareListing } from "@/lib/matchmaking/listingConstraints";
import { SECTIONS } from "./fields";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function displayName(listing) {
  if (!listing) return "";
  return listing.title || listing.address?.split(",")[0]?.trim() || "Listing";
}

export function shortAddress(listing) {
  if (!listing?.address) return "";
  const street = listing.address.split(",")[0].trim();
  // When the title IS the street, show the rest of the address instead.
  if (!listing.title || listing.title === street) return listing.address.replace(/^[^,]+,\s*/, "");
  return street;
}

/* Units a renter can actually take, cheapest offer first. */
export function selectableUnits(listing) {
  return (listing?.unitTypes ?? [])
    .filter((u) => u.available !== false && (u.leases?.length ?? 0) > 0)
    .slice()
    .sort((a, b) => {
      const ra = a.leases?.[0]?.rent ?? Infinity;
      const rb = b.leases?.[0]?.rent ?? Infinity;
      if (ra !== rb) return ra - rb;
      return (a.bedrooms ?? 0) - (b.bedrooms ?? 0);
    });
}

export function unitLabel(unit) {
  if (!unit) return "";
  const beds = unit.bedrooms == null ? null : unit.bedrooms === 0 ? "Studio" : `${unit.bedrooms} bed`;
  const baths = unit.bathrooms == null ? null : `${unit.bathrooms} bath`;
  const specs = [beds, baths].filter(Boolean).join(" · ");
  const name = unit.identityLabel ?? unit.title ?? null;
  if (name && specs) return `${name} · ${specs}`;
  return name || specs || "Unit";
}

export function offerLabel(lease) {
  if (!lease) return "";
  const who = lease.landlordName ? `${lease.landlordName}` : lease.sublease ? "Sublease" : "Offer";
  const rent = lease.rent != null ? `$${Number(lease.rent).toLocaleString("en-US")}` : "Contact for price";
  return `${who} · ${rent}`;
}

/*
 * Resolve one side of the comparison: which unit and which offer the rows
 * describe. Falls back to the cheapest available unit and its cheapest offer,
 * so a fresh comparison always has a concrete price to show.
 */
export function resolveSide(listing, unitId, leaseId) {
  if (!listing) return null;
  const units = selectableUnits(listing);
  const unit = units.find((u) => u.id === unitId) ?? units[0] ?? listing.unitTypes?.[0] ?? null;
  const lease = unit?.leases?.find((l) => l.id === leaseId) ?? unit?.leases?.[0] ?? null;
  const rentBasis = lease
    ? leaseRentBasis({ ...lease, bedrooms: unit?.bedrooms }, isRoomShareListing(listing))
    : null;
  return { listing, unit, lease, rentBasis, reviewStats: reviewStats(listing) };
}

function avg(nums) {
  // A review that skipped a sub-rating is not a zero.
  const xs = nums.filter((n) => n != null && n !== "").map(Number).filter(Number.isFinite);
  if (!xs.length) return null;
  return Math.round((xs.reduce((s, n) => s + n, 0) / xs.length) * 10) / 10;
}

export function reviewStats(listing) {
  const reviews = (listing?.reviews ?? []).filter((r) => r.legitimacy && !r.deletedAt);
  const count = reviews.length;
  const latestReview = reviews
    .filter((r) => r.createdAt)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  // The most-upvoted review with a real sentence in it.
  const quoted = reviews
    .filter((r) => r.comment && r.comment.trim().length > 20)
    .sort((a, b) => (b.upvotes ?? 0) - (a.upvotes ?? 0) || new Date(b.createdAt) - new Date(a.createdAt))[0];
  return {
    count,
    overall: count ? avg(reviews.map((r) => r.rating)) : null,
    communication: avg(reviews.map((r) => r.communicationRating)),
    location: avg(reviews.map((r) => r.locationRating)),
    value: avg(reviews.map((r) => r.valueRating)),
    latest: latestReview
      ? new Date(latestReview.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })
      : null,
    quote: quoted ? quoted.comment.trim() : null,
  };
}

export const money = (n) =>
  n == null ? null : `$${Math.round(Number(n)).toLocaleString("en-US")}`;

export function formatValue(field, value, ctx) {
  if (value == null) return null;
  if (field.format) return field.format(value, ctx);
  switch (field.type) {
    case "money":
      return money(value);
    case "minutes":
      return `${value} min`;
    case "area":
      return `${Number(value).toLocaleString("en-US")} sq ft`;
    case "rating":
      return Number(value).toFixed(1);
    case "count":
      return String(value);
    case "date":
      return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    case "list":
      return value.join(", ");
    default:
      return String(value);
  }
}

/*
 * Build every section's rows for the two sides. A row is kept when at least
 * one side knows the value; a section is kept when it has any rows. The other
 * side then reads "Not listed", which is itself worth seeing: one landlord
 * told us, the other did not.
 */
export function buildRows(sides, basis) {
  const ctxs = sides.map((s) => (s ? { ...s, basis } : null));
  return SECTIONS.map((section) => {
    const rows = section.fields
      .map((field) => {
        const values = ctxs.map((ctx) => (ctx ? field.get(ctx) : null));
        if (values.every((v) => v == null)) return null;
        const label = typeof field.label === "function" ? field.label(ctxs.find(Boolean)) : field.label;
        const both = values.every((v) => v != null);
        const comparable = both && field.better && typeof values[0] === "number" && typeof values[1] === "number" && values[0] !== values[1];
        const winner = !comparable
          ? null
          : field.better === "lower"
          ? values[0] < values[1] ? 0 : 1
          : values[0] > values[1] ? 0 : 1;
        // Term totals over different lease lengths are not the same purchase.
        const termsDiffer =
          field.id === "termTotal" &&
          both &&
          ctxs[0]?.lease?.leaseTermMonths?.[0] !== ctxs[1]?.lease?.leaseTermMonths?.[0];
        const display = values.map((v, i) => (ctxs[i] ? formatValue(field, v, ctxs[i]) : null));
        return {
          id: field.id,
          label,
          type: field.type,
          values,
          display,
          notes: values.map((v, i) => (ctxs[i] && field.note ? field.note(ctxs[i]) : null)),
          suffix: field.suffix ? field.suffix(ctxs.find(Boolean)) : null,
          winner: termsDiffer ? null : winner,
          // Dates and quotes differ when what the student reads differs.
          differs: !both || (field.type === "date" ? display[0] !== display[1] : !sameValue(values[0], values[1])),
        };
      })
      .filter(Boolean);
    return { id: section.id, label: section.label, rows };
  }).filter((s) => s.rows.length > 0);
}

function sameValue(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.join("|") === b.join("|");
  return a === b;
}

/*
 * The two headline tradeoffs shown between the cards and the table. Each is a
 * single plain sentence, or null when the sides don't differ on it.
 */
export function headlineDeltas(sides, basis) {
  if (!sides[0] || !sides[1]) return { rent: null, walk: null };
  const names = sides.map((s) => displayName(s.listing));
  const rents = sides.map((s) =>
    s.rentBasis ? (basis === "unit" ? s.rentBasis.unitRent : s.rentBasis.perPerson) : null
  );
  let rent = null;
  if (rents.every((r) => r != null)) {
    const diff = Math.round(Math.abs(rents[0] - rents[1]));
    rent =
      diff === 0
        ? { text: "Same rent", sub: basis === "unit" ? "per apartment per month" : "per person per month" }
        : {
            text: `${names[rents[0] < rents[1] ? 0 : 1]} is ${money(diff)} less`,
            sub: basis === "unit" ? "per apartment per month" : "per person per month",
          };
  }
  const walks = sides.map((s) => {
    const pwm = s.listing.placeWalkMinutes || {};
    const vals = Object.entries(pwm)
      .filter(([k]) => k !== "Schnucks (Grocery)" && k !== "Med Campus")
      .map(([, v]) => v)
      .filter(Number.isFinite);
    return vals.length ? Math.min(...vals) : null;
  });
  let walk = null;
  if (walks.every((w) => w != null)) {
    const diff = Math.abs(walks[0] - walks[1]);
    walk =
      diff === 0
        ? { text: "Same walk to campus", sub: `${walks[0]} minutes each` }
        : {
            text: `${names[walks[0] < walks[1] ? 0 : 1]} is ${diff} min closer`,
            sub: "walking to campus",
          };
  }
  return { rent, walk };
}

/* URL state: /compare?a=<id>&b=<id>&au=<unit>&al=<lease>&bu=&bl=&basis=unit */
export function compareHref(ids, extra = {}) {
  const params = new URLSearchParams();
  if (ids[0]) params.set("a", ids[0]);
  if (ids[1]) params.set("b", ids[1]);
  for (const [k, v] of Object.entries(extra)) if (v) params.set(k, v);
  const qs = params.toString();
  return `/compare${qs ? `?${qs}` : ""}`;
}
