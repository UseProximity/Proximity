import { useState, useEffect, useRef } from "react";
import { useAuthStore } from "../store/authStore";
import apiClient from "../lib/apiClient";
import { useGoogleSignIn } from "../lib/googleAuth";
import { requestAppleCredential, isAppleCancellation } from "../lib/appleAuth";

export function useAuth() {
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.accessToken);
  const isHydrated = useAuthStore((state) => state.isHydrated);
  const setTokens = useAuthStore((state) => state.setTokens);
  const storeLogout = useAuthStore((state) => state.logout);

  const [isLoading, setIsLoading] = useState(false);

  // Google sign-in — effect-driven flow via expo-auth-session
  const { response, promptAsync } = useGoogleSignIn();

  // Refs to bridge the effect-driven response back into the awaitable signInWithGoogle()
  const googleResolveRef = useRef(null);
  const googleRejectRef = useRef(null);

  useEffect(() => {
    if (!response) return;

    if (response.type === "success") {
      const idToken = response.params?.id_token;
      apiClient.auth
        .googleSignIn(idToken)
        .then((result) => setTokens(result))
        .then(async () => {
          // Load favorites after successful Google sign-in
          const { useFavoritesStore } = await import("../store/favoritesStore");
          useFavoritesStore.getState().hydrate();
          googleResolveRef.current?.();
          setIsLoading(false);
        })
        .catch((err) => {
          googleRejectRef.current?.(err);
          setIsLoading(false);
        });
    } else if (response.type === "error") {
      const err = new Error(response.error?.message ?? "Google sign-in failed.");
      googleRejectRef.current?.(err);
      setIsLoading(false);
    } else {
      // cancelled / dismissed — resolve silently so the caller doesn't hang
      googleResolveRef.current?.();
      setIsLoading(false);
    }
  }, [response]);

  async function login(email, password) {
    setIsLoading(true);
    try {
      const result = await apiClient.auth.login(email, password);
      await setTokens(result);
      // Load favorites after successful login
      const { useFavoritesStore } = await import("../store/favoritesStore");
      useFavoritesStore.getState().hydrate();
    } finally {
      setIsLoading(false);
    }
  }

  async function signup(name, email, password, role) {
    setIsLoading(true);
    try {
      return await apiClient.auth.signup(name, email, password, role);
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Triggers the Google OAuth prompt. Returns a Promise that resolves when
   * the full sign-in flow completes (including the API call and store update),
   * or rejects if authentication or the API call fails.
   */
  function signInWithGoogle() {
    setIsLoading(true);
    return new Promise((resolve, reject) => {
      googleResolveRef.current = resolve;
      googleRejectRef.current = reject;
      promptAsync();
    });
  }

  /**
   * Native Sign in with Apple. Resolves true once the user is signed in, and
   * false when they dismissed the Apple sheet (nothing happened, so the caller
   * must not navigate). Rejects on any real failure.
   */
  async function signInWithApple() {
    setIsLoading(true);
    try {
      const { credential, rawNonce } = await requestAppleCredential();
      // Apple only sends the name on a user's first authorization, so it has to
      // travel with this request; the backend ignores it for returning users.
      const fullName = credential.fullName
        ? { givenName: credential.fullName.givenName, familyName: credential.fullName.familyName }
        : null;
      const result = await apiClient.auth.appleSignIn({
        identityToken: credential.identityToken,
        authorizationCode: credential.authorizationCode,
        nonce: rawNonce,
        fullName,
      });
      await setTokens(result);
      // Load favorites after successful Apple sign-in
      const { useFavoritesStore } = await import("../store/favoritesStore");
      useFavoritesStore.getState().hydrate();
      return true;
    } catch (err) {
      if (isAppleCancellation(err)) return false;
      throw err;
    } finally {
      setIsLoading(false);
    }
  }

  function logout() {
    storeLogout();
  }

  return {
    user,
    accessToken,
    isLoading,
    isHydrated,
    login,
    signup,
    signInWithGoogle,
    signInWithApple,
    logout,
  };
}
