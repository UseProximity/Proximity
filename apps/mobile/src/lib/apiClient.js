import { createApiClient } from "@proximity/api-client";
import { useAuthStore } from "../store/authStore";
import { assertDistributableApiUrl } from "./envGuard";

// Literal process.env reads: Expo only inlines EXPO_PUBLIC_* written out like this.
const API_URL = process.env.EXPO_PUBLIC_API_URL;
const TEST_EMAIL_TO = process.env.EXPO_PUBLIC_TEST_EMAIL_TO;

// Outside development (EAS preview and production, any release bundle) the API must
// be a public https host. A build made with the local .env.local would otherwise talk
// to a LAN address; stop at launch instead. See app.config.js for the build-time check.
if (!__DEV__) assertDistributableApiUrl(API_URL);

const apiClient = createApiClient({
  baseUrl: API_URL,
  getToken: () => useAuthStore.getState().accessToken,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  onTokenExpired: () => useAuthStore.getState().logout(),
  onTokenRefreshed: async (accessToken) => {
    const { refreshToken, user } = useAuthStore.getState();
    await useAuthStore.getState().setTokens({ accessToken, refreshToken, user });
  },
  // Mobile equivalent of web's "📧 Test emails →" cookie picker: set this in
  // .env to actually receive verification/reset emails while testing against
  // a non-production API (the server ignores it in real production).
  // Development only: a distributed build never sends the override, even if the
  // variable leaked into it.
  testEmailTo: __DEV__ ? TEST_EMAIL_TO || null : null,
});

/**
 * Explicitly refreshes the access token and persists it to the store.
 * Called by useAuth or any code that needs a fresh token outside the
 * automatic 401-retry path in the api client.
 */
export async function refresh() {
  const refreshToken = useAuthStore.getState().refreshToken;
  const { accessToken } = await apiClient.auth.refresh(refreshToken);
  const { user } = useAuthStore.getState();
  await useAuthStore.getState().setTokens({ accessToken, refreshToken, user });
  return accessToken;
}

export default apiClient;
