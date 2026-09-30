// Push notification foundation: permission request, Expo push token
// acquisition, and registering/unregistering that token with the Proximity
// backend (POST/DELETE /api/devices/push-token via apiClient.devices).
// Listener wiring (foreground display, token rotation, tap handling) lives
// in ../hooks/usePushNotifications.js — this file only knows how to get and
// sync a token, not how the app reacts to notifications.
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";
import apiClient from "./apiClient";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

// Cached so logout can unregister the exact token that was registered,
// without re-deriving it (and without prompting for permission again).
let cachedToken = null;

// `devicePushToken` is optional and only ever passed by the token-rotation
// listener (usePushNotifications.js), which already receives the native
// DevicePushToken as its argument. Passing it through here skips
// getExpoPushTokenAsync's internal getDevicePushTokenAsync() call — calling
// that from inside the listener re-triggers the listener itself and loops
// (see expo-notifications' own TokenEmitter.ts: "You should not call
// getDevicePushTokenAsync inside this function, as it triggers the listener
// and may lead to an infinite loop"). The normal initial-registration call
// (no argument) is unaffected — omitting it falls back to the usual fetch.
export async function registerForPushNotificationsAsync(devicePushToken) {
  // Physical devices always continue. Of the non-physical targets, only an
  // Android emulator continues too — with Google Play services installed
  // (the default on Android Studio's Play Store AVD images), it can obtain
  // a real FCM-backed Expo push token like a physical device would. iOS
  // simulators stay blocked: Apple's platform has no remote-push support in
  // the simulator at all, so getExpoPushTokenAsync has nothing to succeed at.
  if (!Device.isDevice && Platform.OS !== "android") return null;

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== "granted") return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId, devicePushToken });
  return token;
}

export async function registerDeviceToken(token) {
  if (!token) return;
  await apiClient.devices.registerPushToken({ expoPushToken: token, platform: Platform.OS });
  cachedToken = token;
}

export async function unregisterDeviceToken() {
  if (!cachedToken) return;
  const token = cachedToken;
  cachedToken = null;
  try {
    await apiClient.devices.unregisterPushToken(token);
  } catch {
    // Logout must proceed regardless — a failed unregister just leaves a
    // stale row that a future registration (this device, any user) will
    // overwrite via the upsert's onConflict, or that purge-accounts cleans
    // up eventually.
  }
}
