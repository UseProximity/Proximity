import { useEffect, useRef } from "react";
import { Stack, useGlobalSearchParams, useRouter } from "expo-router";
import { useAuthStore } from "../../src/store/authStore";
import { safeReturnPath } from "../../src/lib/chatLinks";

export default function AuthLayout() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const { next } = useGlobalSearchParams();
  // Set once the post-sign-in redirect has been issued. `next` is read from the focused
  // route, so it changes (to undefined) as soon as that redirect starts moving away from
  // login, which would otherwise run the effect again and replace to the tabs. Cleared
  // when nobody is signed in, so a later sign-in with this layout still mounted redirects.
  const redirected = useRef(false);

  useEffect(() => {
    // Bounce an already-logged-in user away from login/signup, which is reachable
    // via a stale deep link or back-navigation, not just the Profile prompt.
    // This is the only place that navigates after a successful sign-in, so the screens
    // below do not race it. A validated conversation destination (see the chat screen's
    // sign-in prompt) is honoured; anything else falls back to the tabs.
    if (!user) {
      redirected.current = false;
      return;
    }
    if (!isHydrated || redirected.current) return;
    redirected.current = true;
    router.replace(safeReturnPath(next) ?? "/(tabs)");
  }, [isHydrated, user, next]);

  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
