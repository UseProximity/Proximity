"use client";
import { createContext, useState, useEffect, useContext } from "react";
import { useUser } from "./UserContext";

// Create the context
const FavoritesContext = createContext();

// Hook for easy access
export const useFavorites = () => useContext(FavoritesContext);

// Provider component
export function FavoritesProvider({ children }) {
  const [favorites, setFavorites] = useState(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const { role } = useUser();

  // Load favorites when user role changes
  useEffect(() => {
    if (role === "student") {
      loadFavorites();
    } else {
      setFavorites(new Set());
    }
  }, [role]);

  const loadFavorites = async () => {
    try {
      // For now, use the default student ID until auth is implemented
      const defaultUserId = "68877696221d6bb66c4c7c7d";
      const response = await fetch(`/api/favorites?userId=${defaultUserId}`);
      if (response.ok) {
        const data = await response.json();
        setFavorites(new Set(data.favorites || []));
      }
    } catch (error) {
      console.error("Error loading favorites:", error);
    }
  };

  const toggleFavorite = async (listingId) => {
    console.log("toggleFavorite called", { listingId, role });
    if (role !== "student") {
      console.log("Not a student, returning");
      return;
    }

    setIsLoading(true);
    const defaultUserId = "68877696221d6bb66c4c7c7d"; // Default student ID

    try {
      const isCurrentlyFavorited = favorites.has(listingId);
      const action = isCurrentlyFavorited ? "remove" : "add";
      console.log("Action:", action, "for listing:", listingId);

      const response = await fetch("/api/favorites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: defaultUserId,
          listingId,
          action,
        }),
      });

      console.log("API response:", response.status);

      if (response.ok) {
        const newFavorites = new Set(favorites);
        if (isCurrentlyFavorited) {
          newFavorites.delete(listingId);
        } else {
          newFavorites.add(listingId);
        }
        setFavorites(newFavorites);
        console.log("Updated favorites:", Array.from(newFavorites));
      } else {
        console.error("Error updating favorites", response.status);
      }
    } catch (error) {
      console.error("Error toggling favorite:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const isFavorited = (listingId) => {
    return favorites.has(listingId);
  };

  return (
    <FavoritesContext.Provider
      value={{
        favorites,
        isLoading,
        toggleFavorite,
        isFavorited,
        loadFavorites,
      }}
    >
      {children}
    </FavoritesContext.Provider>
  );
}
