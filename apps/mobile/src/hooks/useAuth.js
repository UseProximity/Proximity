import { useState, useEffect, useRef } from "react";
import { useAuthStore } from "../store/authStore";
import apiClient from "../lib/apiClient";
import { useGoogleSignIn } from "../lib/googleAuth";

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
        .then(() => {
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
    logout,
  };
}
