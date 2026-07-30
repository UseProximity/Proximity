// Root layout. Tabs are public — no login required to browse listings, view
// details, or use the map (per the plan's auth-deferred decision). Auth
// screens ((auth)/login, signup) are reachable from the Profile tab rather
// than gating the whole app. authStore hydrates in the background so a
// previously logged-in user's session is restored without blocking the
// public screens on launch.
import "../global.css";

import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { useAuthStore } from "../src/store/authStore";
import { useFavoritesStore } from "../src/store/favoritesStore";
import { ProfileCompletionModal } from "../src/components/ProfileCompletionModal";

export default function RootLayout() {
  const user = useAuthStore((state) => state.user);
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const [showProfileCompletion, setShowProfileCompletion] = useState(false);

  useEffect(() => {
    // Hydrate auth first
    useAuthStore.getState().hydrate().then(() => {
      // Then hydrate favorites if user is logged in
      const user = useAuthStore.getState().user;
      if (user) {
        useFavoritesStore.getState().hydrate();
      }
    });
  }, []);

  useEffect(() => {
    // Show profile completion modal if user is logged in but profile incomplete
    if (isHydrated && user && user.profileComplete === false) {
      setShowProfileCompletion(true);
    } else {
      setShowProfileCompletion(false);
    }
  }, [isHydrated, user]);

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      {showProfileCompletion && (
        <ProfileCompletionModal
          user={user}
          onComplete={() => setShowProfileCompletion(false)}
        />
      )}
    </>
  );
}
