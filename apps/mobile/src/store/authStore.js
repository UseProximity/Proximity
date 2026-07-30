import { create } from "zustand";
import * as secureStorage from "../lib/secureStorage";

export const useAuthStore = create((set, get) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isHydrated: false,

  setTokens: async ({ accessToken, refreshToken, user }) => {
    set({ accessToken, refreshToken, user });
    await Promise.all([
      secureStorage.set("access_token", accessToken ?? ""),
      secureStorage.set("refresh_token", refreshToken ?? ""),
      secureStorage.set("user", user ? JSON.stringify(user) : ""),
    ]);
  },

  logout: async () => {
    set({ user: null, accessToken: null, refreshToken: null });
    await Promise.all([
      secureStorage.remove("access_token"),
      secureStorage.remove("refresh_token"),
      secureStorage.remove("user"),
    ]);
    
    // Clear favorites on logout
    const { useFavoritesStore } = await import("./favoritesStore");
    useFavoritesStore.getState().clear();
  },

  hydrate: async () => {
    const [accessToken, refreshToken, userJson] = await Promise.all([
      secureStorage.get("access_token"),
      secureStorage.get("refresh_token"),
      secureStorage.get("user"),
    ]);
    let user = null;
    if (userJson) {
      try {
        user = JSON.parse(userJson);
      } catch {
        user = null;
      }
    }
    set({
      accessToken: accessToken || null,
      refreshToken: refreshToken || null,
      user,
      isHydrated: true,
    });
  },
}));
