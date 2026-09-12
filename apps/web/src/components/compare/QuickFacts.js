"use client";

import { motion } from "framer-motion";
import { money } from "@/lib/compare/model";
import { NON_CAMPUS_WALK_PLACES } from "@/utils/washuPlaces";

function campus(listing) {
  const vals = Object.entries(listing?.placeWalkMinutes || {})
    .filter(([k]) => !NON_CAMPUS_WALK_PLACES.includes(k))
    .map(([, v]) => v)
    .filter(Number.isFinite);
  return vals.length ? Math.min(...vals) : null;
}

function bedBath(unit) {
  if (!unit) return null;
  const beds = unit.bedrooms == null ? null : unit.bedrooms === 0 ? "Studio" : `${unit.bedrooms} bd`;
  const baths = unit.bathrooms == null ? null : `${unit.bathrooms} ba`;
  return [beds, baths].filter(Boolean).join(" · ") || null;
}

/*
 * The raised panel between the two photos: five facts, each side's value
 * under a shared label, the objectively better number in green.
 */
export default function QuickFacts({ sides, basis, delay = 0 }) {
  const rents = sides.map((s) => (s?.rentBasis ? (basis === "unit" ? s.rentBasis.unitRent : s.rentBasis.perPerson) : null));
  const walks = sides.map((s) => (s ? campus(s.listing) : null));
  const areas = sides.map((s) => s?.unit?.area ?? null);
  const lower = (v) => (v.every((x) => x != null) && v[0] !== v[1] ? (v[0] < v[1] ? 0 : 1) : null);
  const higher = (v) => (v.every((x) => x != null) && v[0] !== v[1] ? (v[0] > v[1] ? 0 : 1) : null);

  const rows = [
    { label: basis === "unit" ? "Rent / apt" : "Rent / person", values: rents.map(money), best: lower(rents) },
    { label: "Walk to campus", values: walks.map((w) => (w == null ? null : `${w} min`)), best: lower(walks) },
    { label: "Bed · bath", values: sides.map((s) => (s ? bedBath(s.unit) : null)), best: null },
    { label: "Size", values: areas.map((a) => (a == null ? null : `${Number(a).toLocaleString("en-US")} sq ft`)), best: higher(areas) },
    {
      label: "Furnished",
      values: sides.map((s) => {
        if (!s) return null;
        const f = s.lease?.furnished ?? s.listing.furnished;
        return f == null ? null : f ? "Yes" : "No";
      }),
      best: null,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay }}
      className="col-start-2 row-start-1 hidden self-start px-3 pt-6 md:block lg:px-4"
    >
      <div
        role="table"
        aria-label="Key facts"
        className="rounded-2xl bg-white px-3 py-2 shadow-[0_18px_48px_-24px_rgba(15,23,42,0.35)] ring-1 ring-black/5 lg:px-4"
      >
        {rows.map((row) => (
          <div key={row.label} role="row" className="grid grid-cols-2 gap-x-2 border-t border-gray-100 py-4 first:border-t-0">
            <span
              role="rowheader"
              className="col-span-2 mb-1.5 text-center text-[10.5px] font-medium uppercase tracking-[0.14em] text-gray-400"
            >
              {row.label}
            </span>
            {row.values.map((v, i) => (
              <span
                key={i}
                role="cell"
                className={`text-center text-[17px] font-semibold leading-tight tracking-tight tabular-nums lg:text-lg ${
                  v == null ? "text-gray-300" : row.best === i ? "text-emerald-600" : "text-gray-900"
                }`}
              >
                {v ?? "·"}
              </span>
            ))}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
