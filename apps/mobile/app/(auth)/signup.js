import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useAuth } from "../../src/hooks/useAuth";
import apiClient from "../../src/lib/apiClient";
import { Button } from "../../src/components/ui/Button";
import { TextField } from "../../src/components/ui/TextField";
import { colors } from "../../src/theme/tokens";

const ROLES = [
  { value: "student", label: "Student" },
  { value: "landlord", label: "Landlord" },
];

export default function SignupScreen() {
  const { signup, isLoading } = useAuth();
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("student");
  const [error, setError] = useState(null);
  // The email the server confirmed it sent to, not the (possibly stale) form
  // field — mirrors web's AuthCard, which displays `data.email` from the
  // response rather than its own local input state.
  const [verifiedEmail, setVerifiedEmail] = useState(null);
  const [resending, setResending] = useState(false);
  const [resendMsg, setResendMsg] = useState("");

  async function handleSignup() {
    setError(null);
    try {
      const data = await signup(name, email, password, role);
      setVerifiedEmail(data.email);
    } catch (err) {
      setError(err?.body?.error ?? err?.message ?? "Sign up failed. Please try again.");
    }
  }

  async function handleResend() {
    setResendMsg("");
    setResending(true);
    try {
      await apiClient.auth.resendVerification(verifiedEmail);
      setResendMsg("Resent! Check your inbox.");
    } catch {
      setResendMsg("Failed to resend. Please try again.");
    } finally {
      setResending(false);
    }
  }

  if (verifiedEmail) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 justify-center items-center px-7">
          <Text className="text-2xl font-bold text-gray-900 mb-3 text-center">Check your email</Text>
          <Text className="text-base text-gray-500 text-center leading-[22px]">
            We sent a verification link to {verifiedEmail}. Click it to activate your account, then sign in.
          </Text>
          <Text className="text-base text-gray-500 text-center leading-[22px] mt-1.5">
            Don&apos;t see it? Check your spam folder.
          </Text>

          <Text className="text-sm text-gray-500 mt-5 mb-2">Didn&apos;t get it?</Text>
          <Pressable onPress={handleResend} disabled={resending} hitSlop={8}>
            {resending ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <Text className="text-sm font-semibold text-red-500">Resend verification email</Text>
            )}
          </Pressable>
          {resendMsg ? <Text className="mt-2 text-[13px] text-gray-500">{resendMsg}</Text> : null}

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

          <Text className="text-[28px] font-bold text-gray-900 mb-1.5">Create account</Text>
          <Text className="text-sm text-gray-500 mb-7">
            Join thousands of students finding housing near campus.
          </Text>

          <View className="gap-3">
            <TextField
              placeholder="Full name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoCorrect={false}
              editable={!isLoading}
            />
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
              placeholder="Password (min. 8 characters)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!isLoading}
            />

            <View>
              <Text className="text-[13px] text-gray-500 mb-2 font-medium">I am a…</Text>
              <View className="flex-row gap-2.5">
                {ROLES.map((r) => (
                  <Pressable
                    key={r.value}
                    onPress={() => setRole(r.value)}
                    disabled={isLoading}
                    className={`flex-1 h-11 rounded-full border items-center justify-center ${
                      role === r.value ? "bg-red-600 border-red-600" : "bg-gray-50 border-gray-200"
                    }`}
                  >
                    <Text className={`text-sm font-medium ${role === r.value ? "text-white" : "text-gray-500"}`}>
                      {r.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {error ? <Text className="text-red-500 text-[13px] text-center">{error}</Text> : null}

            <Button onPress={handleSignup} loading={isLoading}>
              Create Account
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
