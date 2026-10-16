import * as WebBrowser from "expo-web-browser";

// Public legal documents served by the website (apps/web/src/app/(legal)).
// Fixed production URLs on purpose: EXPO_PUBLIC_API_URL can point at staging or
// a dev machine, but the store listings and the policy text name these pages.
export const TERMS_URL = "https://useproximity.org/terms";
export const PRIVACY_URL = "https://useproximity.org/privacy";

// Opens in an in-app browser sheet (same expo-web-browser used for Google
// sign-in), so the user stays in the app.
export function openLegalLink(url) {
  return WebBrowser.openBrowserAsync(url).catch(() => {});
}
