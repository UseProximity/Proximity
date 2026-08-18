// Root layout. Tabs are public — no login required to browse listings, view
// details, or use the map (per the plan's auth-deferred decision). Auth
// screens ((auth)/login, signup) are reachable from the Profile tab rather
// than gating the whole app. authStore hydrates in the background so a
// previously logged-in user's session is restored without blocking the
// public screens on launch.
import "../global.css";

import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { View } from "react-native";
import {
  useFonts,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import { useAuthStore } from "../src/store/authStore";
import { useFavoritesStore } from "../src/store/favoritesStore";
import { ProfileCompletionModal } from "../src/components/ProfileCompletionModal";

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

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
    // font-sans (DM Sans regular) applied once here and inherited by every
    // descendant Text via NativeWind v4's style inheritance — individual
    // screens don't need to opt in. font-bold/semibold/medium classNames
    // still work as before; tailwind.config.js's plugin maps them to the
    // matching DM Sans weight family (see its comment for why that's
    // necessary, not just a font-family default).
    //
    // <Stack> must render unconditionally on every render, including the
    // very first one — Expo Router requires a navigator to be mounted
    // immediately (it throws "Attempted to navigate before mounting the
    // Root Layout component" otherwise). Fonts loading is masked with an
    // absolutely-positioned overlay instead of an early return that would
    // skip rendering <Stack>: an early-return version worked fine for
    // ordinary cold starts (fonts resolve well before a user can tap
    // anything) but broke the Google sign-in round-trip, where returning
    // from the OAuth browser can remount this layout — if navigation fires
    // during that remount's font-loading window with no <Stack> yet
    // mounted, the app crashes. No native splash-screen API involved —
    // expo-splash-screen isn't a dependency today, and Google Fonts load
    // quickly enough that a blank white overlay is enough.
    <View className="flex-1 font-sans">
      <Stack screenOptions={{ headerShown: false }} />
      {!fontsLoaded && <View className="absolute inset-0 bg-white" />}
      {showProfileCompletion && (
        <ProfileCompletionModal
          user={user}
          onComplete={() => setShowProfileCompletion(false)}
        />
      )}
    </View>
  );
}
