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
