"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { StepFrame, inputCls, importedInputCls } from "@/components/listings/wizard/wizardShared";
import PropertyUnitPicker from "@/components/listings/PropertyUnitPicker";

/*
 * Screen 1: just the address. Picking a Mapbox suggestion captures coordinates
 * (walk times, map pin, Street View). After a website import this becomes a
 * one-tap confirm: the imported street prefills and the dropdown opens itself.
 */
export default function StepAddress({ w }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(w.coords.lat != null);
  const boxRef = useRef(null);
  const debounceRef = useRef(null);

  const fetchSuggestions = useCallback((query) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query || query.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
      if (!token) return;
      setLoading(true);
      try {
        const encoded = encodeURIComponent(query.trim());
        // proximity biases ranking toward the WashU area (street-only imports).
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=5&country=US&types=address,place&proximity=-90.3123,38.6488`
        );
        const data = await res.json();
        const next = (data.features ?? []).map((f) => ({
          label: f.place_name,
          center: f.center,
        }));
        setSuggestions(next);
        setOpen(next.length > 0);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  // Imported street-only address: open the dropdown for the one-tap confirm.
  const importedUnconfirmed = w.importedFields.has("address");
  useEffect(() => {
    if (importedUnconfirmed && w.form.address) fetchSuggestions(w.form.address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const select = (s) => {
    const autoTitle = s.label.split(",")[0].trim();
    w.setField("address", s.label);
    if (!w.form.title) w.setField("title", autoTitle);
    setSuggestions([]);
    setOpen(false);
    setConfirmed(true);
    const [lng, lat] = s.center ?? [];
    if (lat != null && lng != null) {
      w.setCoords({ lat, lng });
      w.fetchStreetViewPreview(s.label, lat, lng);
    }
    // The address is settled enough to ask whether a property already exists.
    w.lookupProperty(s.label);
  };

  return (
    <StepFrame
      title={
        importedUnconfirmed
          ? "Confirm the address"
          : "Where's the property?"
      }
      subtitle={
        importedUnconfirmed
          ? `Your website says "${w.form.address}". Tap the matching suggestion so we can put it on the map.`
          : "This sets the map pin and real walk times to campus. You'll pick the display name students see later."
      }
    >
      <div className="relative" ref={boxRef}>
        <input
          value={w.form.address}
          onChange={(e) => {
            setConfirmed(false);
            w.setField("address", e.target.value);
            fetchSuggestions(e.target.value);
          }}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          autoComplete="off"
          autoFocus
          placeholder="123 Main St, St. Louis, MO 63130"
          className={`${inputCls} text-base py-3${
            importedUnconfirmed ? importedInputCls : ""
          }`}
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-red-500" />
        )}
        {open && suggestions.length > 0 && (
          <ul className="absolute z-30 left-0 right-0 top-full mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            {suggestions.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(s)}
                  className="w-full border-b border-gray-100 px-3 py-2.5 text-left text-sm text-gray-700 last:border-0 hover:bg-red-50"
                >
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirmed && !open && !w.existingProperty && !w.lookupLoading && (
        <p className="mt-2 text-xs text-green-700">✓ On the map. Walk times will be calculated automatically.</p>
      )}

      {/* A listing already exists here — attach to one of its units instead of
          creating a duplicate property. */}
      {(w.lookupLoading || w.existingProperty) && (
        <div className="mt-4">
          <PropertyUnitPicker
            loading={w.lookupLoading}
            property={w.existingProperty}
            leaseType={w.form.lease_type}
            selection={w.unitSelection}
            onSelectionChange={w.setUnitSelection}
          />
        </div>
      )}
    </StepFrame>
  );
}
