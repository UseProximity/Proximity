import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  SafeAreaView,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useAuth } from "../../src/hooks/useAuth";
import apiClient from "../../src/lib/apiClient";

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
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.container}>
          <Text style={styles.wordmark}>proximity</Text>
          <Text style={styles.tagline}>Find your perfect place near campus.</Text>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#9ca3af"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor="#9ca3af"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!isLoading}
            />

            {needsVerification && (
              <View style={styles.verificationBox}>
                <Text style={styles.verificationTitle}>Email not verified</Text>
                <Text style={styles.verificationText}>
                  Check your inbox for a verification link. Can't find it?
                </Text>
                {resendSuccess ? (
                  <Text style={styles.successText}>
                    ✓ Verification email sent! Check your inbox.
                  </Text>
                ) : (
                  <TouchableOpacity
                    style={[styles.resendButton, resending && styles.buttonDisabled]}
                    onPress={handleResendVerification}
                    disabled={resending}
                  >
                    {resending ? (
                      <ActivityIndicator size="small" color="#ef4444" />
                    ) : (
                      <Text style={styles.resendButtonText}>Resend verification email</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.button, styles.buttonPrimary, isLoading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonPrimaryText}>Sign In</Text>
              )}
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>or</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity
              style={[styles.button, styles.buttonSecondary, isLoading && styles.buttonDisabled]}
              onPress={handleGoogleSignIn}
              disabled={isLoading}
            >
              <Text style={styles.buttonSecondaryText}>Continue with Google</Text>
            </TouchableOpacity>
          </View>

          <Link href="/(auth)/signup" style={styles.footerLink}>
            <Text style={styles.footerText}>
              Don&apos;t have an account?{" "}
              <Text style={styles.footerLinkText}>Sign up</Text>
            </Text>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#fff",
  },
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingBottom: 32,
  },
  wordmark: {
    fontSize: 40,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -1,
    marginBottom: 6,
    textAlign: "center",
  },
  tagline: {
    fontSize: 15,
    color: "#6b7280",
    textAlign: "center",
    marginBottom: 36,
  },
  form: {
    gap: 12,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    color: "#111827",
    backgroundColor: "#f9fafb",
  },
  button: {
    height: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPrimary: {
    backgroundColor: "#111827",
  },
  buttonPrimaryText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  buttonSecondary: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  buttonSecondaryText: {
    color: "#111827",
    fontSize: 15,
    fontWeight: "600",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e5e7eb",
  },
  dividerText: {
    marginHorizontal: 12,
    color: "#9ca3af",
    fontSize: 13,
  },
  error: {
    color: "#ef4444",
    fontSize: 13,
    textAlign: "center",
  },
  verificationBox: {
    backgroundColor: "#fef3c7",
    borderWidth: 1,
    borderColor: "#fbbf24",
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  verificationTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#92400e",
  },
  verificationText: {
    fontSize: 13,
    color: "#78350f",
    lineHeight: 18,
  },
  resendButton: {
    alignSelf: "flex-start",
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fbbf24",
  },
  resendButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#92400e",
  },
  successText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#15803d",
    marginTop: 4,
  },
  footerLink: {
    marginTop: 28,
  },
  footerText: {
    textAlign: "center",
    color: "#6b7280",
    fontSize: 14,
  },
  footerLinkText: {
    color: "#111827",
    fontWeight: "600",
  },
});
