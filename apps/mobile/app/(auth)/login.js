import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { Check } from "lucide-react-native";
import { useAuth } from "../../src/hooks/useAuth";
import apiClient from "../../src/lib/apiClient";
import { Button } from "../../src/components/ui/Button";
import { TextField } from "../../src/components/ui/TextField";
import { colors } from "../../src/theme/tokens";

const EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED";

export default function LoginScreen() {
  const router = useRouter();
  const { login, signInWithGoogle, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  async function handleLogin() {
    setError(null);
    setNeedsVerification(false);
    setResendSuccess(false);
    try {
      await login(email, password);
      // Login successful - navigate to main app
      router.replace("/(tabs)");
    } catch (err) {
      const errorCode = err?.body?.error;
      if (errorCode === EMAIL_NOT_VERIFIED) {
        setNeedsVerification(true);
        setError(null);
      } else {
        setError(err?.body?.error ?? err?.message ?? "Sign in failed. Please try again.");
      }
    }
  }

  async function handleResendVerification() {
    if (!email) return;
    setResending(true);
    setError(null);
    setResendSuccess(false);
    try {
      await apiClient.auth.resendVerification(email);
      setResendSuccess(true);
    } catch (err) {
      setError("Failed to send verification email. Please try again.");
    } finally {
      setResending(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setNeedsVerification(false);
    try {
      await signInWithGoogle();
      // Login successful - navigate to main app
      router.replace("/(tabs)");
    } catch (err) {
      setError(err?.body?.error ?? err?.message ?? "Google sign in failed. Please try again.");
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View className="flex-1 justify-center px-7 pb-8">
          {/* text-[40px] = the `display` type-scale token (design-system/
              MASTER.md §3) — reserved for one-off brand moments like this
              wordmark. font-bold (not font-extrabold): DM Sans only has
              400/500/600/700 weights loaded, so 700 is as heavy as it gets. */}
          <Text className="text-[40px] font-bold tracking-tight text-gray-900 mb-1.5 text-center">
            proximity
          </Text>
          <Text className="text-base text-gray-500 text-center mb-9">
            Find your perfect place near campus.
          </Text>

          <View className="gap-3">
            <TextField
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
            />
            <TextField
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!isLoading}
            />

            <Link href="/(auth)/forgot-password" className="self-end">
              <Text className="text-gray-500 text-[13px]">Forgot password?</Text>
            </Link>

            {needsVerification && (
              <View className="bg-amber-100 border border-amber-400 rounded-xl p-4 gap-2">
                <Text className="text-sm font-semibold text-amber-800">Email not verified</Text>
                <Text className="text-[13px] text-amber-900 leading-[18px]">
                  Check your inbox for a verification link. Can't find it?
                </Text>
                {resendSuccess ? (
                  <View className="flex-row items-center gap-1 mt-1">
                    <Check size={13} color={colors.success} strokeWidth={2.5} />
                    <Text className="text-[13px] font-medium text-green-700">
                      Verification email sent! Check your inbox.
                    </Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={handleResendVerification}
                    disabled={resending}
                    className="self-start mt-1 bg-white border border-amber-400 rounded-lg px-3 py-2"
                  >
                    {resending ? (
                      <ActivityIndicator size="small" color={colors.error} />
                    ) : (
                      <Text className="text-[13px] font-semibold text-amber-800">Resend verification email</Text>
                    )}
                  </Pressable>
                )}
              </View>
            )}

            {error ? <Text className="text-red-500 text-[13px] text-center">{error}</Text> : null}

            <Button onPress={handleLogin} loading={isLoading}>
              Sign In
            </Button>

            <View className="flex-row items-center my-1">
              <View className="flex-1 h-px bg-gray-200" />
              <Text className="mx-3 text-gray-400 text-[13px]">or</Text>
              <View className="flex-1 h-px bg-gray-200" />
            </View>

            <Button variant="secondary" onPress={handleGoogleSignIn} loading={isLoading}>
              Continue with Google
            </Button>
          </View>

          <Link href="/(auth)/signup" className="mt-7 self-center">
            <Text className="text-gray-500 text-sm">
              Don&apos;t have an account? <Text className="text-gray-900 font-semibold">Sign up</Text>
            </Text>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
