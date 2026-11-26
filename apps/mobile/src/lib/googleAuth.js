import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";

WebBrowser.maybeCompleteAuthSession();

/**
 * Hook that wraps Google.useIdTokenAuthRequest.
 * Returns { request, response, promptAsync }.
 * The id_token is available at response.params.id_token on success.
 */
// Google.useIdTokenAuthRequest throws synchronously if the client ID for the
// current platform is undefined, which would crash every screen that calls
// useAuth() (Profile, Login, Signup) while the real IDs aren't set up yet.
// Falling back to a placeholder keeps the hook (and email/password auth)
// working; tapping "Continue with Google" will just fail until the real
// per-platform client IDs are added to .env.
export function useGoogleSignIn() {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || "not-configured",
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || "not-configured",
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || "not-configured",
  });
  return { request, response, promptAsync };
}
