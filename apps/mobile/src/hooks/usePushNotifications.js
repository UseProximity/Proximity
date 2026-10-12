// Wires up the push notification foundation for the whole app: registers
// the device once a user is known, keeps the token current if Expo rotates
// it, and turns a tap on a chat notification into navigation to that
// conversation. Only chat notifications navigate, and only after the payload
// validates (see chatThreadIdFromNotificationData); there is no general
// "open any route" contract.
import { useEffect } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuthStore } from "../store/authStore";
import { useChatUnreadStore } from "../store/chatUnreadStore";
import {
  registerForPushNotificationsAsync,
  registerDeviceToken,
  chatThreadIdFromNotificationData,
} from "../lib/pushNotifications";

// Notifications already acted on. The live tap listener and the launch check can
// both report the same tap, and the launch check can see it again after a remount
// (sign-out and in), so each notification navigates at most once.
const handledNotificationIds = new Set();
let launchResponseChecked = false;

// Opens the conversation a chat notification points at. Does nothing for any other
// notification, for a malformed chat payload, for one already handled, or when that
// conversation is already the one on screen.
function openChatFromResponse(router, response) {
  const id = response?.notification?.request?.identifier;
  if (id && handledNotificationIds.has(id)) return;
  const threadId = chatThreadIdFromNotificationData(response?.notification?.request?.content?.data);
  if (!threadId) return;
  if (id) handledNotificationIds.add(id);
  if (useChatUnreadStore.getState().activeThreadId?.toLowerCase?.() === threadId) return;
  router.push({ pathname: "/chat/[threadId]", params: { threadId } });
}

export function usePushNotifications() {
  const router = useRouter();
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const userId = useAuthStore((state) => state.user?.id);

  // App launched by tapping a notification while it was closed. Checked once per
  // launch, after auth has hydrated so the navigator is up; a tap that launched a
  // signed-out app is dropped rather than replayed after a later sign-in.
  useEffect(() => {
    if (!isHydrated || launchResponseChecked) return;
    launchResponseChecked = true;
    if (!useAuthStore.getState().user?.id) return;
    const response = Notifications.getLastNotificationResponse();
    if (response) openChatFromResponse(router, response);
  }, [isHydrated, router]);

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

    const responseSub = Notifications.addNotificationResponseReceivedListener((response) =>
      openChatFromResponse(router, response)
    );

    return () => {
      cancelled = true;
      tokenSub.remove();
      receivedSub.remove();
      responseSub.remove();
    };
  }, [isHydrated, userId]);
}
