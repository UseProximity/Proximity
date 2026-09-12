"use client";

import { motion } from "framer-motion";
import { money } from "@/lib/compare/model";
import { campusWalkFor, campusLabel } from "@/lib/compare/fields";

const ok = (n) => Number.isFinite(n) && n >= 0;

function bedBath(unit) {
  if (!unit) return null;
  const beds = !ok(unit.bedrooms) ? null : unit.bedrooms === 0 ? "Studio" : `${unit.bedrooms} bd`;
  const baths = !ok(unit.bathrooms) ? null : `${unit.bathrooms} ba`;
  return [beds, baths].filter(Boolean).join(" · ") || null;
}

/* The bordered panel between the two cards: the five facts that decide most
 * searches, each side's number under a shared label, the better one in green. */
export default function QuickFacts({ sides, basis, campus = "danforth", delay = 0 }) {
  const rents = sides.map((s) => (s?.rentBasis ? (basis === "unit" ? s.rentBasis.unitRent : s.rentBasis.perPerson) : null));
  const walks = sides.map((s) => (s ? campusWalkFor(s.listing, campus) : null));
  const shuttles = sides.map((s) => s?.listing.shuttleWalkMinutes ?? null);
  const areas = sides.map((s) => s?.unit?.area ?? null);
  const lower = (v) => (v.every((x) => x != null) && v[0] !== v[1] ? (v[0] < v[1] ? 0 : 1) : null);
  const higher = (v) => (v.every((x) => x != null) && v[0] !== v[1] ? (v[0] > v[1] ? 0 : 1) : null);

  const rows = [
    { label: basis === "unit" ? "Rent / apt" : "Rent / person", values: rents.map(money), best: lower(rents) },
    { label: `Walk to ${campusLabel(campus)}`, values: walks.map((w) => (w == null ? null : `${w} min`)), best: lower(walks) },
    { label: "Shuttle stop", values: shuttles.map((w) => (w == null ? null : `${w} min`)), best: lower(shuttles) },
    { label: "Bed / bath", values: sides.map((s) => (s ? bedBath(s.unit) : null)), best: null },
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
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay }}
      className="col-start-2 row-start-1 hidden self-start px-3 md:block"
    >
      <div role="table" aria-label="Key facts" className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 bg-gray-50 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          At a glance
        </div>
        {rows.map((row) => (
          <div key={row.label} role="row" className="grid grid-cols-2 gap-x-2 border-t border-gray-100 px-2 py-3 first:border-t-0">
            <span role="rowheader" className="col-span-2 mb-1 text-center text-[11px] text-gray-500">
              {row.label}
            </span>
            {row.values.map((v, i) => (
              <span
                key={i}
                role="cell"
                className={`text-center text-sm font-semibold tabular-nums ${
                  v == null ? "text-gray-300" : row.best === i ? "text-emerald-700" : "text-gray-900"
                }`}
              >
                {v ?? "–"}
              </span>
            ))}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
