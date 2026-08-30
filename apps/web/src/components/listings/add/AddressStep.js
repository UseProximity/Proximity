"use client";

/*
 * Step one: which building.
 *
 * Mapbox suggests addresses; the moment one is chosen we ask
 * /api/properties/lookup whether we already hold a property there. That answer
 * decides the whole rest of the flow — an unknown address builds a property
 * from scratch, a known one drops straight to its units.
 *
 * The same normalizer the database uses (normalize_property_key) decides
 * "already hold", so the client and the stored key can never disagree about
 * what counts as the same address.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Loader2, Check } from "lucide-react";

export default function AddressStep({ value, onResolved }) {
  const [query, setQuery] = useState(value ?? "");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [looking, setLooking] = useState(false);
  const [chosen, setChosen] = useState(null);
  const debounce = useRef(null);
  const box = useRef(null);

  const fetchSuggestions = useCallback((q) => {
    if (debounce.current) clearTimeout(debounce.current);
    if (!q || q.trim().length < 3) { setSuggestions([]); setOpen(false); return; }
    debounce.current = setTimeout(async () => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (!token) return;
      try {
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q.trim())}.json` +
          `?access_token=${token}&limit=5&country=US&types=address,place&proximity=-90.3123,38.6488`
        );
        const data = await res.json();
        const next = (data.features ?? []).map((f) => ({ label: f.place_name, center: f.center }));
        setSuggestions(next);
        setOpen(next.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 300);
  }, []);

  useEffect(() => {
    const onOutside = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const choose = async (s) => {
    setQuery(s.label);
    setOpen(false);
    setChosen(s.label);
    setLooking(true);
    try {
      const res = await fetch(`/api/properties/lookup?address=${encodeURIComponent(s.label)}`);
      const data = await res.json();
      onResolved({
        address: s.label,
        longitude: s.center?.[0] ?? null,
        latitude: s.center?.[1] ?? null,
        property: data.property ?? null,
        units: data.property?.units ?? [],
      });
    } catch {
      // A lookup failure must not block listing — treat it as a new property and
      // let the address-key check on submit catch a genuine collision.
      onResolved({
        address: s.label,
        longitude: s.center?.[0] ?? null,
        latitude: s.center?.[1] ?? null,
        property: null,
        units: [],
      });
    } finally {
      setLooking(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500">
        Address
      </label>
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setChosen(null); fetchSuggestions(e.target.value); }}
          onFocus={() => suggestions.length && setOpen(true)}
          placeholder="Start typing the building's address"
          className="w-full rounded-xl border border-gray-200 py-3 pl-10 pr-10 text-sm focus:border-red-400 focus:outline-none"
        />
        {looking && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />}
        {!looking && chosen && <Check className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-green-600" />}
      </div>

      {open && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
          {suggestions.map((s) => (
            <li key={s.label}>
              <button
                type="button" onClick={() => choose(s)}
                className="block w-full px-4 py-2.5 text-left text-sm hover:bg-gray-50"
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
