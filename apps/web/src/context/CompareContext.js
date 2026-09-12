/*
 * The student's comparison shortlist: up to two listings.
 *
 * Picked from Browse (pill toggles), or opened straight from a listing page.
 * Mirrored into sessionStorage so the shortlist survives navigation and the
 * /compare page and the pills always agree. Session-scoped on purpose: a
 * comparison is a single afternoon's shortlist, not something to greet a
 * returning student with a week later.
 *
 * Each item carries the little the tray needs to draw it (name, photo); the
 * /compare page loads the full listing by id.
 */
"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const KEY = "prx_compare";
const CompareContext = createContext({
  items: [],
  ids: [],
  opening: false,
  setOpening: () => {},
  add: () => {},
  remove: () => {},
  clear: () => {},
  setItems: () => {},
});

function read() {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => x && x.id).slice(0, 2) : [];
  } catch {
    return [];
  }
}

export function CompareProvider({ children }) {
  const [items, setItemsState] = useState([]);
  // True from the moment a pick opens the comparison until the page mounts.
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    setItemsState(read());
  }, []);

  const setItems = useCallback((next) => {
    const clean = (next ?? []).filter((x) => x && x.id).slice(0, 2);
    setItemsState(clean);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(clean));
    } catch {}
  }, []);

  const add = useCallback(
    (item) => setItems([...items.filter((x) => x.id !== item.id), item]),
    [items, setItems]
  );
  const remove = useCallback((id) => setItems(items.filter((x) => x.id !== id)), [items, setItems]);
  const clear = useCallback(() => setItems([]), [setItems]);

  const value = useMemo(
    () => ({ items, ids: items.map((x) => x.id), opening, setOpening, add, remove, clear, setItems }),
    [items, opening, add, remove, clear, setItems]
  );

  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

export const useCompare = () => useContext(CompareContext);

/* The fields the tray needs from a listing, in the shape the context stores. */
export function compareItem(listing) {
  if (!listing) return null;
  return {
    id: String(listing._id),
    name: listing.title || listing.address?.split(",")[0]?.trim() || "Listing",
    image: listing.images?.[0] ?? null,
  };
}
