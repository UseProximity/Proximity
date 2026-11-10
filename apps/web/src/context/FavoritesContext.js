/*
 * Global favorites state for the application. On mount (and whenever the signed-in user
 * changes) fetches the full list of saved listing IDs from /api/favorites and stores them
 * as strings in memory. Exposes setFavorite(listingId, favorited): the local array updates
 * at once, so every heart for that listing fills or empties immediately, and the server is
 * brought in line in the background. Clicks are never blocked while a request is out: the
 * latest click wins, and one request at a time per listing carries the state the reader
 * ended on. If the server refuses, the heart goes back to what the server last confirmed.
 * Keeping the IDs in context means any listing card anywhere on the page reflects the
 * correct saved state without prop-drilling. Consumed via useFavorites() by HeartIcon,
 * BrowseContent, and any component that needs to know whether a listing is currently saved.
 */
"use client";

import { createContext, useContext, useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { trackEvent, getListingSource } from "@/utils/analytics";

const FavoritesContext = createContext({
  savedIds: [],
  toggle: () => {},
  setFavorite: () => {},
});

export function FavoritesProvider({ children }) {
  const { data: session } = useSession();
  const [savedIds, setSavedIds] = useState([]);
  // Per listing: the state the reader last asked for, and whether a request
  // for that listing is out.
  const wanted = useRef(new Map());
  const syncing = useRef(new Set());

  useEffect(() => {
    if (!session?.user?.id) { setSavedIds([]); return; }
    fetch("/api/favorites")
      .then((r) => r.json())
      .then((data) => setSavedIds((data.ids ?? []).map(String)))
      .catch(() => {});
  }, [session?.user?.id]);

  const toggle = (listingId, favorited) => {
    const id = String(listingId);
    setSavedIds((prev) => {
      const without = prev.filter((saved) => saved !== id);
      return favorited ? [...without, id] : without;
    });
  };

  // Send the wanted state until the server agrees with it. `confirmed` is what
  // the server holds; it starts as the state before the first click.
  const sync = async (id, confirmed) => {
    syncing.current.add(id);
    try {
      while (wanted.current.get(id) !== confirmed) {
        const want = wanted.current.get(id);
        const res = await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId: id, favorited: want }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.favorited !== want) throw new Error("not saved");
        confirmed = want;
        const source = getListingSource(id);
        trackEvent("Favorite Toggled", {
          action: confirmed ? "add" : "remove",
          listingId: id,
          ...(source ? { source } : {}),
        });
      }
    } catch {
      // Back to what the server last confirmed.
      toggle(id, confirmed);
    } finally {
      wanted.current.delete(id);
      syncing.current.delete(id);
    }
  };

  const setFavorite = (listingId, favorited) => {
    const id = String(listingId);
    toggle(id, favorited);
    wanted.current.set(id, favorited);
    if (!syncing.current.has(id)) sync(id, !favorited);
  };

  return (
    <FavoritesContext.Provider value={{ savedIds, toggle, setFavorite }}>
      {children}
    </FavoritesContext.Provider>
  );
}

export const useFavorites = () => useContext(FavoritesContext);
