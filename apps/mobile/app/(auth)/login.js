import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { Link, useNavigation, useRouter } from "expo-router";
import * as AppleAuthentication from "expo-apple-authentication";
import { Check } from "lucide-react-native";
import { useAuth } from "../../src/hooks/useAuth";
import apiClient from "../../src/lib/apiClient";
import { useAuthStore } from "../../src/store/authStore";
import { isAppleSignInAvailable } from "../../src/lib/appleAuth";
import { Button } from "../../src/components/ui/Button";
import { TextField } from "../../src/components/ui/TextField";
import { ErrorMessage } from "../../src/components/ui/ErrorMessage";
import { getErrorMessage } from "../../src/lib/apiError";
import { ERROR_MESSAGES } from "../../src/lib/errorMessages";
import { AuthScreen } from "../../src/components/brand/AuthScreen";
import { colors } from "../../src/theme/tokens";

const EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED";


export default function LoginScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { login, signInWithGoogle, signInWithApple, isLoading } = useAuth();
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  useEffect(() => {
    isAppleSignInAvailable().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  async function handleLogin() {
    setError(null);
    setNeedsVerification(false);
    setResendSuccess(false);
    try {
      await login(email, password);
      // Signed in: (auth)/_layout.js navigates on, to the pending conversation if any.
    } catch (err) {
      const errorCode = err?.body?.error;
      if (errorCode === EMAIL_NOT_VERIFIED) {
        setNeedsVerification(true);
        setError(null);
      } else {
        setError(getErrorMessage(err, ERROR_MESSAGES.AUTH.SIGN_IN));
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
      setError(getErrorMessage(err, ERROR_MESSAGES.AUTH.RESEND_VERIFICATION));
    } finally {
      setResending(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setNeedsVerification(false);
    try {
      await signInWithGoogle();
      // Signed in: (auth)/_layout.js navigates on, to the pending conversation if any.
      // A dismissed Google prompt resolves with nobody signed in; that case still goes
      // to the tabs, as before.
      if (!useAuthStore.getState().user) router.replace("/(tabs)");
    } catch (err) {
      setError(getErrorMessage(err, ERROR_MESSAGES.AUTH.SIGN_IN_GOOGLE));
    }
  }

  async function handleAppleSignIn() {
    if (isLoading) return;
    setError(null);
    setNeedsVerification(false);
    try {
      // false means the user dismissed the Apple sheet: stay on this screen. On true,
      // (auth)/_layout.js navigates on, to the pending conversation if any.
      await signInWithApple();
    } catch (err) {
      setError(
        getErrorMessage(err, ERROR_MESSAGES.AUTH.SIGN_IN_APPLE, {
          // Apple sign-in words an unverified email its own way.
          overrides: { EMAIL_NOT_VERIFIED: ERROR_MESSAGES.AUTH.APPLE_EMAIL_NOT_VERIFIED },
        })
      );
    }
  }

  // Back goes to the previous screen, except when that was Create Account (which
  // links here, so going back would loop between the two) or when there is no
  // previous screen: both land on the Profile tab. The navigator's route list is
  // the (auth) stack, so the entry just below this one is the screen that opened it.
  function handleBack() {
    const { routes, index } = navigation.getState();
    const cameFromSignup = routes[index - 1]?.name === "signup";
    if (!cameFromSignup && router.canGoBack()) router.back();
    else router.dismissTo("/(tabs)/profile");
  }

  return (
    <AuthScreen onBack={handleBack}>
      <Text className="text-[22px] font-bold text-gray-900 text-center mb-5">Welcome back</Text>

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

        <ErrorMessage compact>{error}</ErrorMessage>

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

        {appleAvailable && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={12}
            onPress={handleAppleSignIn}
            style={{ height: 48 }}
          />
        )}
      </View>

      <Link href="/(auth)/signup" className="mt-7 self-center">
        <Text className="text-gray-500 text-sm">
          Don&apos;t have an account? <Text className="text-gray-900 font-semibold">Sign up</Text>
        </Text>
      </Link>
    </AuthScreen>
  );
}
