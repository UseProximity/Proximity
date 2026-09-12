"use client";

import { motion } from "framer-motion";
import { ArrowLeftRight } from "lucide-react";
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
 * The column between the two photos. The photos fade into it, so it reads as
 * the seam where the two options meet: five facts, each side's value under
 * a shared label, with the objectively better number in green.
 */
export default function QuickFacts({ sides, basis, onSwap, canSwap, delay = 0 }) {
  const rents = sides.map((s) => (s?.rentBasis ? (basis === "unit" ? s.rentBasis.unitRent : s.rentBasis.perPerson) : null));
  const walks = sides.map((s) => (s ? campus(s.listing) : null));
  const areas = sides.map((s) => s?.unit?.area ?? null);
  const lower = (v) => (v.every((x) => x != null) && v[0] !== v[1] ? (v[0] < v[1] ? 0 : 1) : null);
  const higher = (v) => (v.every((x) => x != null) && v[0] !== v[1] ? (v[0] > v[1] ? 0 : 1) : null);

  const rows = [
    { label: basis === "unit" ? "Rent / apartment" : "Rent / person", values: rents.map(money), best: lower(rents) },
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
      className="col-start-2 row-start-1 hidden flex-col justify-center px-4 md:flex lg:px-6"
    >
      <p className="mb-2 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">At a glance</p>
      <div role="table" aria-label="Key facts" className="w-full">
        {rows.map((row) => (
          <div key={row.label} role="row" className="grid grid-cols-2 gap-x-3 border-t border-gray-100 py-4">
            <span role="rowheader" className="col-span-2 mb-1.5 text-center text-xs text-gray-400">
              {row.label}
            </span>
            {row.values.map((v, i) => (
              <span
                key={i}
                role="cell"
                className={`text-center text-[15px] font-semibold tabular-nums leading-tight lg:text-base ${
                  v == null ? "text-gray-300" : row.best === i ? "text-emerald-700" : "text-gray-900"
                }`}
              >
                {v ?? "·"}
              </span>
            ))}
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onSwap}
        disabled={!canSwap}
        className="mx-auto mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-gray-200 px-3.5 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900 disabled:opacity-40"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
        Swap sides
      </button>
    </motion.div>
  );
}
