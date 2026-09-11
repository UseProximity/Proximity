"use client";

/*
 * The address box with a suggestion dropdown, shared by the home hero, the header
 * search, the admin listings view and the review flow.
 *
 * Suggestions are geocoded against a campus rather than the country at large.
 * Street names repeat endlessly across the US — "6659 Washington" exists in five
 * states — so without a point to search around, a student typing their own
 * address is offered Michigan and Ohio. `near` is that point; it defaults to the
 * school we serve everywhere else, and the review flow overrides it with the
 * campus the reviewer actually attends.
 *
 * Mapbox treats proximity as one signal among several, so it still returns distant
 * matches and sometimes ranks one above a local one. We ask for more results than
 * we show and float the ones near campus to the top, keeping Mapbox's relevance
 * order within each group — a far-away address stays reachable, it just stops
 * outranking the one down the street.
 */

import { useState, useEffect, useRef, forwardRef } from "react";
import { schoolCenter } from "@/lib/schools";

// Fetched, then trimmed to SHOWN_LIMIT after reordering. The extra candidates are
// what make the reordering worth doing: a local match ranked 7th by Mapbox can
// still reach the visible list.
const FETCH_LIMIT = 10;
const SHOWN_LIMIT = 5;

// Roughly the metro a student could plausibly have lived in and still be near
// campus. Generous on purpose: this only decides ordering, never visibility.
const NEARBY_RADIUS_MILES = 50;

const MILES_PER_DEGREE_LAT = 69;

function milesFrom(center, [lng, lat]) {
  if (lat == null || lng == null) return Infinity;
  const dy = (lat - center.latitude) * MILES_PER_DEGREE_LAT;
  const dx =
    (lng - center.longitude) *
    MILES_PER_DEGREE_LAT *
    Math.cos((center.latitude * Math.PI) / 180);
  return Math.hypot(dx, dy);
}

/** Features near `center` first, each group left in the order Mapbox returned it. */
function campusFirst(features, center) {
  const near = [];
  const far = [];
  for (const f of features) {
    (milesFrom(center, f.center || []) <= NEARBY_RADIUS_MILES ? near : far).push(f);
  }
  return [...near, ...far];
}

const AddressSearchInput = forwardRef(function AddressSearchInput(
  {
    value,
    onChange,
    onSelectSuggestion,
    onKeyDown,
    placeholder,
    className,
    type = "text",
    // Campus to search around: a school short name ("SLU"), or coordinates.
    // Anything unrecognised, including nothing at all, falls back to the default school.
    near,
  },
  ref
) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const timerRef = useRef(null);

  const center =
    near && near.latitude != null && near.longitude != null
      ? { latitude: near.latitude, longitude: near.longitude }
      : schoolCenter(near);
  // Primitives, so re-biasing re-runs the search but a fresh object literal doesn't.
  const { latitude: centerLat, longitude: centerLng } = center;

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (!value || value.length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      try {
        const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(value)}.json?access_token=${token}&autocomplete=true&country=us&proximity=${centerLng},${centerLat}&types=address,poi&limit=${FETCH_LIMIT}`
        );
        const data = await res.json();
        const feats = campusFirst(data.features || [], {
          latitude: centerLat,
          longitude: centerLng,
        }).slice(0, SHOWN_LIMIT);
        setSuggestions(feats);
        setOpen(feats.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [value, centerLat, centerLng]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Escape") setOpen(false);
    onKeyDown?.(e);
  };

  const handleSelect = (feature) => {
    setOpen(false);
    setSuggestions([]);
    onSelectSuggestion(feature);
  };

  return (
    <div ref={wrapperRef} className="relative flex-1 min-w-0">
      <input
        ref={ref}
        type={type}
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-white rounded-xl border border-gray-100 shadow-xl overflow-hidden z-50">
          {suggestions.map((f) => (
            <button
              key={f.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); handleSelect(f); }}
              className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
            >
              <div className="text-[15px] text-gray-700 leading-snug">{f.place_name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

export default AddressSearchInput;
