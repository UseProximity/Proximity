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
    // Unregister the device's push token before clearing local tokens — the
    // DELETE call needs the still-valid access token to authenticate.
    // Best effort and time-bounded (see unregisterDeviceToken): a failure here
    // must never stop the local sign-out below.
    try {
      const { unregisterDeviceToken } = await import("../lib/pushNotifications");
      await unregisterDeviceToken();
    } catch (err) {
      console.warn("logout: push token cleanup skipped", err);
    }

    set({ user: null, accessToken: null, refreshToken: null });
    // allSettled so one failing key can't skip the others or the favorites clear.
    const removals = await Promise.allSettled([
      secureStorage.remove("access_token"),
      secureStorage.remove("refresh_token"),
      secureStorage.remove("user"),
    ]);
    if (removals.some((r) => r.status === "rejected")) {
      console.warn("logout: could not clear all stored credentials");
    }

    // Clear favorites on logout
    const { useFavoritesStore } = await import("./favoritesStore");
    useFavoritesStore.getState().clear();

    // Matchmaking's own chatStore reacts to this store's user?.id changing
    // (see the effect in app/(tabs)/matchmaking.js) — no explicit reset
    // needed here.
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
