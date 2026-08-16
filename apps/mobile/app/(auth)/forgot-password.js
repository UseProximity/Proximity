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
import apiClient from "../../src/lib/apiClient";

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
      <SafeAreaView style={styles.safe}>
        <View style={styles.centeredContainer}>
          <Text style={styles.successTitle}>Check your email</Text>
          <Text style={styles.successBody}>
            If an account exists for {email}, we sent a link to reset your password.
          </Text>
          <TouchableOpacity
            style={[styles.button, styles.buttonPrimary, { marginTop: 28 }]}
            onPress={() => router.replace("/(auth)/login")}
          >
            <Text style={styles.buttonPrimaryText}>Back to Sign In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.container}>
          <Link href="/(auth)/login" style={styles.backLink}>
            <Text style={styles.backLinkText}>← Sign in instead</Text>
          </Link>

          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.subtitle}>
            Enter your email and we&apos;ll send you a link to reset your password.
          </Text>

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

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.button, styles.buttonPrimary, isLoading && styles.buttonDisabled]}
              onPress={handleSubmit}
              disabled={isLoading || !email}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonPrimaryText}>Send Reset Link</Text>
              )}
            </TouchableOpacity>
          </View>
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
  centeredContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 28,
  },
  backLink: {
    marginBottom: 24,
  },
  backLinkText: {
    color: "#6b7280",
    fontSize: 14,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 28,
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
  buttonDisabled: {
    opacity: 0.6,
  },
  error: {
    color: "#ef4444",
    fontSize: 13,
    textAlign: "center",
  },
  successTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 12,
    textAlign: "center",
  },
  successBody: {
    fontSize: 15,
    color: "#6b7280",
    textAlign: "center",
    lineHeight: 22,
  },
});
