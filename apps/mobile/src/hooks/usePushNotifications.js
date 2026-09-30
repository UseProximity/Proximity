// Wires up the push notification foundation for the whole app: registers
// the device once a user is known, keeps the token current if Expo rotates
// it, and turns a tap on a notification into in-app navigation via
// `data.route` — the generic contract a later feature (e.g. in-app
// messaging) builds its real notifications on top of.
import { useEffect } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuthStore } from "../store/authStore";
import {
  registerForPushNotificationsAsync,
  registerDeviceToken,
} from "../lib/pushNotifications";

export function usePushNotifications() {
  const router = useRouter();
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const userId = useAuthStore((state) => state.user?.id);

  useEffect(() => {
    if (!isHydrated || !userId) return;

    let cancelled = false;
    (async () => {
      const token = await registerForPushNotificationsAsync();
      if (!cancelled && token) {
        await registerDeviceToken(token);
      }
    })();

    // Expo may roll the token while the app is running (rare) — re-register
    // immediately so the backend never sends to a token Expo has retired.
    // The listener already hands us the new native DevicePushToken, so it's
    // passed straight through rather than re-fetched — re-fetching it here
    // would itself re-trigger this same listener and loop.
    const tokenSub = Notifications.addPushTokenListener(async (devicePushToken) => {
      const token = await registerForPushNotificationsAsync(devicePushToken);
      if (token) await registerDeviceToken(token);
    });

    const receivedSub = Notifications.addNotificationReceivedListener(() => {
      // Foreground display is handled by setNotificationHandler
      // (lib/pushNotifications.js) — nothing product-specific to do here yet.
    });

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = response.notification.request.content.data?.route;
      if (route) router.push(route);
    });

    return () => {
      cancelled = true;
      tokenSub.remove();
      receivedSub.remove();
      responseSub.remove();
    };
  }, [isHydrated, userId]);
}
