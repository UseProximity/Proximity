import { useEffect } from "react";
import { Stack, useRouter } from "expo-router";
import { useAuthStore } from "../../src/store/authStore";

export default function AuthLayout() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isHydrated = useAuthStore((state) => state.isHydrated);

  useEffect(() => {
    // Bounce an already-logged-in user away from login/signup — reachable
    // via a stale deep link or back-navigation, not just the Profile prompt.
    if (isHydrated && user) {
      router.replace("/(tabs)");
    }
  }, [isHydrated, user]);

  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
