import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { useRouter } from "expo-router";
import apiClient from "../src/lib/apiClient";
import { AuthScreen } from "../src/components/brand/AuthScreen";
import { Button } from "../src/components/ui/Button";
import { ErrorMessage } from "../src/components/ui/ErrorMessage";
import { getErrorMessage } from "../src/lib/apiError";
import { ERROR_MESSAGES } from "../src/lib/errorMessages";
import { colors } from "../src/theme/tokens";
import { clearLinkToken, getLinkToken, subscribeLinkTokens } from "../src/lib/linkTokens";

// Opened from the email-verification email (see +native-intent.js, which keeps the
// one-time token out of the route and hands it to src/lib/linkTokens.js). The person
// tapped the link, so the token is redeemed on arrival, once per token, by
// POST /api/auth/verify-email. Verifying does not sign anyone in.
export default function VerifyEmailScreen() {
  const router = useRouter();
  const token = useSyncExternalStore(subscribeLinkTokens, () => getLinkToken("verify"));
  const [status, setStatus] = useState("verifying"); // verifying | success | invalid | failed
  const [message, setMessage] = useState(null);
  const [attempt, setAttempt] = useState(0);
  // The token and attempt already sent, so a re-render (or a remount that keeps refs)
  // cannot redeem the same one-time token twice.
  const sent = useRef(null);

  useEffect(() => {
    if (!token) return;
    const key = `${token}:${attempt}`;
    if (sent.current === key) return;
    sent.current = key;
    setStatus("verifying");
    apiClient.auth
      .verifyEmail(token)
      .then(() => {
        // Set before clearing: clearing the token re-renders synchronously.
        setStatus("success");
        clearLinkToken("verify");
      })
      .catch((err) => {
        const text = getErrorMessage(err, ERROR_MESSAGES.AUTH.VERIFY_EMAIL);
        const dead = text === ERROR_MESSAGES.AUTH.VERIFY_LINK_INVALID;
        setMessage(text);
        setStatus(dead ? "invalid" : "failed");
        if (dead) clearLinkToken("verify");
      });
  }, [token, attempt]);

  if (status === "success") {
    return (
      <AuthScreen compact>
        <Text className="text-[22px] font-bold text-gray-900 text-center mb-2">Email verified</Text>
        <Text className="text-sm text-gray-500 text-center mb-6">Your account is ready. Sign in to continue.</Text>
        <Button onPress={() => router.replace("/(auth)/login")}>Sign In</Button>
      </AuthScreen>
    );
  }

  if (!token || status === "invalid") {
    return (
      <AuthScreen compact>
        <Text className="text-[22px] font-bold text-gray-900 text-center mb-4">Verification link not valid</Text>
        <ErrorMessage>{message ?? ERROR_MESSAGES.AUTH.VERIFY_LINK_INVALID}</ErrorMessage>
        <Button onPress={() => router.replace("/(auth)/login")} className="mt-6">
          Go to Sign In
        </Button>
      </AuthScreen>
    );
  }

  if (status === "failed") {
    return (
      <AuthScreen compact>
        <Text className="text-[22px] font-bold text-gray-900 text-center mb-4">Couldn&apos;t verify your email</Text>
        <ErrorMessage>{message}</ErrorMessage>
        <Button onPress={() => setAttempt((n) => n + 1)} className="mt-6">
          Try again
        </Button>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen compact>
      <View className="items-center">
        <ActivityIndicator size="large" color={colors.primary} />
        <Text className="text-sm text-gray-500 mt-4">Verifying your email…</Text>
      </View>
    </AuthScreen>
  );
}
