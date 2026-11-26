import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import apiClient from "../src/lib/apiClient";
import { AuthScreen } from "../src/components/brand/AuthScreen";
import { Button } from "../src/components/ui/Button";
import { TextField } from "../src/components/ui/TextField";
import { ErrorMessage } from "../src/components/ui/ErrorMessage";
import { getErrorMessage } from "../src/lib/apiError";
import { ERROR_MESSAGES } from "../src/lib/errorMessages";
import { clearLinkToken, getLinkToken, subscribeLinkTokens } from "../src/lib/linkTokens";

// Opened from the password-reset email (see +native-intent.js, which keeps the one-time
// token out of the route and hands it to src/lib/linkTokens.js). The token is only ever
// sent to POST /api/auth/reset-password. A reset does not sign anyone in.
export default function ResetPasswordScreen() {
  const router = useRouter();
  const token = useSyncExternalStore(subscribeLinkTokens, () => getLinkToken("reset"));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [linkDead, setLinkDead] = useState(false);
  const [done, setDone] = useState(false);

  // A genuinely new link (a different token from the last one seen) starts over. The same
  // token arriving again, or the token being cleared after use, changes nothing, so the
  // form is never reset under someone typing and a used token cannot be submitted twice.
  const lastToken = useRef(token);
  // Identifies the latest submit. A new link or a new submit moves it on, so a slower, older
  // request can tell it is stale and must not touch the screen or the stored token.
  const submitId = useRef(0);
  useEffect(() => {
    if (!token || token === lastToken.current) return;
    lastToken.current = token;
    submitId.current += 1;
    setIsLoading(false);
    setLinkDead(false);
    setDone(false);
    setError(null);
    setPassword("");
    setConfirm("");
  }, [token]);

  async function handleSubmit() {
    setError(null);
    if (password.length < 8) {
      setError(ERROR_MESSAGES.AUTH.PASSWORD_SHORT);
      return;
    }
    if (password !== confirm) {
      setError(ERROR_MESSAGES.PROFILE.PASSWORDS_MISMATCH);
      return;
    }
    const id = ++submitId.current;
    const submitted = token;
    setIsLoading(true);
    try {
      await apiClient.auth.resetPassword(submitted, password);
      // Clears only the token this request used, so a newer link is never wiped.
      if (id !== submitId.current) {
        clearLinkToken("reset", submitted);
        return;
      }
      // Set before clearing: clearing the token re-renders synchronously.
      setDone(true);
      clearLinkToken("reset", submitted);
    } catch (err) {
      if (id !== submitId.current) return;
      const message = getErrorMessage(err, ERROR_MESSAGES.AUTH.RESET_PASSWORD);
      if (message === ERROR_MESSAGES.AUTH.RESET_LINK_INVALID) {
        setLinkDead(true);
        clearLinkToken("reset", submitted);
      } else {
        setError(message);
      }
    } finally {
      if (id === submitId.current) setIsLoading(false);
    }
  }

  if (done) {
    return (
      <AuthScreen compact>
        <Text className="text-[22px] font-bold text-gray-900 text-center mb-2">Password updated</Text>
        <Text className="text-sm text-gray-500 text-center mb-6">You can now sign in with your new password.</Text>
        <Button onPress={() => router.replace("/(auth)/login")}>Sign In</Button>
      </AuthScreen>
    );
  }

  if (!token || linkDead) {
    return (
      <AuthScreen compact>
        <Text className="text-[22px] font-bold text-gray-900 text-center mb-4">Reset link not valid</Text>
        <ErrorMessage>{ERROR_MESSAGES.AUTH.RESET_LINK_INVALID}</ErrorMessage>
        <Button onPress={() => router.replace("/(auth)/forgot-password")} className="mt-6">
          Request a new link
        </Button>
      </AuthScreen>
    );
  }

  return (
    <AuthScreen compact>
      <Text className="text-[22px] font-bold text-gray-900 text-center mb-1.5">Choose a new password</Text>
      <Text className="text-sm text-gray-500 text-center mb-5">Use at least 8 characters.</Text>

      <View className="gap-3">
        <TextField
          placeholder="New password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          editable={!isLoading}
        />
        <TextField
          placeholder="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          editable={!isLoading}
        />

        <ErrorMessage compact>{error}</ErrorMessage>

        <Button onPress={handleSubmit} loading={isLoading} disabled={isLoading || !password || !confirm}>
          Reset Password
        </Button>
      </View>
    </AuthScreen>
  );
}
