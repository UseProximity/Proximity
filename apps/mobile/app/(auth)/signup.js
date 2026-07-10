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
  const [success, setSuccess] = useState(false);

  async function handleSignup() {
    setError(null);
    try {
      await signup(name, email, password, role);
      setSuccess(true);
    } catch (err) {
      setError(err?.body?.error ?? err?.message ?? "Sign up failed. Please try again.");
    }
  }

  if (success) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centeredContainer}>
          <Text style={styles.successTitle}>Check your email</Text>
          <Text style={styles.successBody}>
            We sent a verification link to {email}. Click it to activate your account, then sign in.
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

          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Join thousands of students finding housing near campus.</Text>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Full name"
              placeholderTextColor="#9ca3af"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              autoCorrect={false}
              editable={!isLoading}
            />
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
              placeholder="Password (min. 8 characters)"
              placeholderTextColor="#9ca3af"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!isLoading}
            />

            <View>
              <Text style={styles.roleLabel}>I am a…</Text>
              <View style={styles.roleRow}>
                {ROLES.map((r) => (
                  <TouchableOpacity
                    key={r.value}
                    style={[
                      styles.rolePill,
                      role === r.value && styles.rolePillActive,
                    ]}
                    onPress={() => setRole(r.value)}
                    disabled={isLoading}
                  >
                    <Text
                      style={[
                        styles.rolePillText,
                        role === r.value && styles.rolePillTextActive,
                      ]}
                    >
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <TouchableOpacity
              style={[styles.button, styles.buttonPrimary, isLoading && styles.buttonDisabled]}
              onPress={handleSignup}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonPrimaryText}>Create Account</Text>
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
  roleLabel: {
    fontSize: 13,
    color: "#6b7280",
    marginBottom: 8,
    fontWeight: "500",
  },
  roleRow: {
    flexDirection: "row",
    gap: 10,
  },
  rolePill: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f9fafb",
  },
  rolePillActive: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  rolePillText: {
    fontSize: 14,
    fontWeight: "500",
    color: "#6b7280",
  },
  rolePillTextActive: {
    color: "#fff",
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
