import { create } from "zustand";
import apiClient from "../lib/apiClient";

export const useFavoritesStore = create((set, get) => ({
  // Set of saved listing IDs for fast lookup
  savedIds: new Set(),
  // Array of full listing objects (for the Saved tab)
  savedListings: [],
  isHydrated: false,
  isLoading: false,

  // Initialize favorites from backend
  hydrate: async () => {
    try {
      const favorites = await apiClient.favorites.getFavorites();
      const ids = new Set(favorites.map((listing) => listing._id));
      set({
        savedIds: ids,
        savedListings: favorites,
        isHydrated: true,
      });
    } catch (error) {
      // If not logged in or error, just mark as hydrated with empty state
      set({
        savedIds: new Set(),
        savedListings: [],
        isHydrated: true,
      });
    }
  },

  // Refresh favorites (for pull-to-refresh)
  refresh: async () => {
    set({ isLoading: true });
    try {
      const favorites = await apiClient.favorites.getFavorites();
      const ids = new Set(favorites.map((listing) => listing._id));
      set({
        savedIds: ids,
        savedListings: favorites,
      });
    } catch (error) {
      console.error("Failed to refresh favorites:", error);
    } finally {
      set({ isLoading: false });
    }
  },

  // Check if a listing is saved
  isSaved: (listingId) => {
    return get().savedIds.has(listingId);
  },

  // Add a favorite (optimistic update)
  addFavorite: async (listingId, listingData = null) => {
    const { savedIds, savedListings } = get();
    
    // Optimistic update
    const newIds = new Set(savedIds);
    newIds.add(listingId);
    const newListings = listingData
      ? [listingData, ...savedListings]
      : savedListings;
    
    set({
      savedIds: newIds,
      savedListings: newListings,
    });

    // Call API
    try {
      await apiClient.favorites.addFavorite(listingId);
      // Don't refresh - trust the optimistic update
      // The backend confirmed it worked, no need to re-fetch
    } catch (error) {
      // Rollback on error
      set({
        savedIds,
        savedListings,
      });
      throw error;
    }
  },

  // Remove a favorite (optimistic update)
  removeFavorite: async (listingId) => {
    const { savedIds, savedListings } = get();
    
    // Optimistic update
    const newIds = new Set(savedIds);
    newIds.delete(listingId);
    const newListings = savedListings.filter((l) => l._id !== listingId);
    
    set({
      savedIds: newIds,
      savedListings: newListings,
    });

    // Call API
    try {
      await apiClient.favorites.removeFavorite(listingId);
    } catch (error) {
      // Rollback on error
      set({
        savedIds,
        savedListings,
      });
      throw error;
    }
  },

  // Toggle favorite
  toggleFavorite: async (listingId, listingData = null) => {
    const isSaved = get().isSaved(listingId);
    if (isSaved) {
      await get().removeFavorite(listingId);
    } else {
      await get().addFavorite(listingId, listingData);
    }
  },

  // Clear all favorites (on logout)
  clear: () => {
    set({
      savedIds: new Set(),
      savedListings: [],
      isHydrated: false,
    });
  },
}));
