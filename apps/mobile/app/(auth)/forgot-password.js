import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import apiClient from "../../src/lib/apiClient";
import { Button } from "../../src/components/ui/Button";
import { TextField } from "../../src/components/ui/TextField";
import { colors } from "../../src/theme/tokens";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsLoading(true);
    try {
      await apiClient.auth.forgotPassword(email);
      setSuccess(true);
    } catch (err) {
      setError(err?.body?.error ?? err?.message ?? "Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (success) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 justify-center items-center px-7">
          <Text className="text-2xl font-bold text-gray-900 mb-3 text-center">Check your email</Text>
          <Text className="text-base text-gray-500 text-center leading-[22px]">
            If an account exists for {email}, we sent a link to reset your password.
          </Text>
          <Button onPress={() => router.replace("/(auth)/login")} className="mt-7 self-stretch">
            Back to Sign In
          </Button>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View className="flex-1 justify-center px-7 pb-8">
          <Link href="/(auth)/login" className="mb-6 flex-row items-center">
            <ChevronLeft size={16} color={colors.textSecondary} strokeWidth={2.5} />
            <Text className="text-gray-500 text-sm">Sign in instead</Text>
          </Link>

          <Text className="text-[28px] font-bold text-gray-900 mb-1.5">Reset your password</Text>
          <Text className="text-sm text-gray-500 mb-7">
            Enter your email and we&apos;ll send you a link to reset your password.
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

            {error ? <Text className="text-red-500 text-[13px] text-center">{error}</Text> : null}

            <Button onPress={handleSubmit} loading={isLoading} disabled={isLoading || !email}>
              Send Reset Link
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
