/*
 * Global favorites state for the application. On mount (and whenever the signed-in user
 * changes) fetches the full list of saved listing IDs from /api/favorites and stores them
 * as strings in memory. Exposes a toggle(listingId, favorited) function that updates the
 * local array optimistically — the actual Supabase write is handled by the HeartIcon
 * component via /api/favorites/[listingId]. Keeping the IDs in context means any listing
 * card anywhere on the page reflects the correct saved state without prop-drilling.
 * Consumed via useFavorites() by HeartIcon, BrowseContent, and any component that needs
 * to know whether a listing is currently saved.
 */
"use client";

import { createContext, useContext, useState, useEffect } from "react";
import { useSession } from "next-auth/react";

const FavoritesContext = createContext({ savedIds: [], toggle: () => {} });

export function FavoritesProvider({ children }) {
  const { data: session } = useSession();
  const [savedIds, setSavedIds] = useState([]);

  useEffect(() => {
    if (!session?.user?.id) { setSavedIds([]); return; }
    fetch("/api/favorites")
      .then((r) => r.json())
      .then((data) => setSavedIds((data.ids ?? []).map(String)))
      .catch(() => {});
  }, [session?.user?.id]);

  const toggle = (listingId, favorited) => {
    setSavedIds((prev) =>
      favorited
        ? [...prev, String(listingId)]
        : prev.filter((id) => id !== String(listingId))
    );
  };

  return (
    <FavoritesContext.Provider value={{ savedIds, toggle }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export const useFavorites = () => useContext(FavoritesContext);
