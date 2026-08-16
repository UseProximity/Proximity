import { createApiClient } from "@proximity/api-client";
import { useAuthStore } from "../store/authStore";

const apiClient = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL,
  getToken: () => useAuthStore.getState().accessToken,
  getRefreshToken: () => useAuthStore.getState().refreshToken,
  onTokenExpired: () => useAuthStore.getState().logout(),
  onTokenRefreshed: async (accessToken) => {
    const { refreshToken, user } = useAuthStore.getState();
    await useAuthStore.getState().setTokens({ accessToken, refreshToken, user });
  },
  // Mobile equivalent of web's "📧 Test emails →" cookie picker — set this in
  // .env to actually receive verification/reset emails while testing against
  // a non-production API (the server ignores it in real production).
  testEmailTo: process.env.EXPO_PUBLIC_TEST_EMAIL_TO || null,
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
