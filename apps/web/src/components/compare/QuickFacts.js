"use client";

import { ArrowLeftRight, Columns2 } from "lucide-react";
import { money } from "@/lib/compare/model";
import { NON_CAMPUS_WALK_PLACES } from "@/utils/washuPlaces";

function campus(listing) {
  const vals = Object.entries(listing?.placeWalkMinutes || {})
    .filter(([k]) => !NON_CAMPUS_WALK_PLACES.includes(k))
    .map(([, v]) => v)
    .filter(Number.isFinite);
  return vals.length ? `${Math.min(...vals)} min` : null;
}

function bedBath(unit) {
  if (!unit) return null;
  const beds = unit.bedrooms == null ? null : unit.bedrooms === 0 ? "Studio" : `${unit.bedrooms} bd`;
  const baths = unit.bathrooms == null ? null : `${unit.bathrooms} ba`;
  return [beds, baths].filter(Boolean).join(" · ") || null;
}

/* The narrow column between the two cards. Desktop only; on phones the same
 * facts open the details list. */
export default function QuickFacts({ sides, basis, onSwap, canSwap }) {
  const rows = [
    {
      label: basis === "unit" ? "Rent / apt" : "Rent / person",
      values: sides.map((s) =>
        s?.rentBasis ? money(basis === "unit" ? s.rentBasis.unitRent : s.rentBasis.perPerson) : null
      ),
    },
    { label: "Walk to campus", values: sides.map((s) => (s ? campus(s.listing) : null)) },
    { label: "Bed · bath", values: sides.map((s) => (s ? bedBath(s.unit) : null)) },
    {
      label: "Furnished",
      values: sides.map((s) => {
        if (!s) return null;
        const f = s.lease?.furnished ?? s.listing.furnished;
        return f == null ? null : f ? "Yes" : "No";
      }),
    },
  ];

  return (
    <div className="col-start-2 row-start-1 hidden flex-col items-center justify-center px-3 md:flex lg:px-5">
      <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-500">
        <Columns2 className="h-4.5 w-4.5" strokeWidth={1.6} />
      </span>
      <p className="mb-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">At a glance</p>
      <div role="table" aria-label="Key facts" className="w-full">
        {rows.map((row) => (
          <div key={row.label} role="row" className="grid grid-cols-2 border-t border-gray-100 py-3.5 first:border-t-0 first:pt-0">
            <span role="rowheader" className="col-span-2 mb-1 text-center text-[11px] text-gray-400">
              {row.label}
            </span>
            {row.values.map((v, i) => (
              <span
                key={i}
                role="cell"
                className={`text-center text-[13px] font-semibold tabular-nums ${v ? "text-gray-900" : "text-gray-300"}`}
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
        className="mt-5 flex min-h-10 flex-col items-center gap-1 text-gray-400 transition-colors hover:text-gray-900 disabled:opacity-40"
      >
        <ArrowLeftRight className="h-4 w-4" />
        <span className="text-[11px] font-medium">Swap</span>
      </button>
    </div>
  );
}
