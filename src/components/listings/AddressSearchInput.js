"use client";

import { useState, useEffect, useRef, forwardRef } from "react";

const AddressSearchInput = forwardRef(function AddressSearchInput(
  { value, onChange, onSelectSuggestion, onKeyDown, placeholder, className, type = "text" },
  ref
) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const timerRef = useRef(null);

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
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(value)}.json?access_token=${token}&autocomplete=true&country=us&proximity=-90.3032,38.6495&types=address,poi&limit=5`
        );
        const data = await res.json();
        const feats = data.features || [];
        setSuggestions(feats);
        setOpen(feats.length > 0);
      } catch {
        setSuggestions([]);
      }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [value]);

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
