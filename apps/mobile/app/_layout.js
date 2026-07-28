// Root layout. Tabs are public — no login required to browse listings, view
// details, or use the map (per the plan's auth-deferred decision). Auth
// screens ((auth)/login, signup) are reachable from the Profile tab rather
// than gating the whole app. authStore hydrates in the background so a
// previously logged-in user's session is restored without blocking the
// public screens on launch.
import "../global.css";

import { useEffect } from "react";
import { Stack } from "expo-router";
import { useAuthStore } from "../src/store/authStore";

export default function RootLayout() {
  useEffect(() => {
    useAuthStore.getState().hydrate();
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
