// Edit Profile screen
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/hooks/useAuth";
import apiClient from "../../src/lib/apiClient";

export default function EditProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [graduationYear, setGraduationYear] = useState(user?.graduationYear?.toString() || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isStudent = user?.role === "student";

  const handleSave = async () => {
    setError(null);

    // Validation
    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    if (!email.trim()) {
      setError("Email is required");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email");
      return;
    }

    if (isStudent && graduationYear && !/^\d{4}$/.test(graduationYear)) {
      setError("Graduation year must be a 4-digit year");
      return;
    }

    setSaving(true);

    try {
      const updateData = {
        name: name.trim(),
        email: email.trim(),
      };

      if (isStudent && graduationYear) {
        updateData.graduationYear = parseInt(graduationYear, 10);
      }

      await apiClient.user.updateProfile(updateData);

      // Update local auth store
      const { useAuthStore } = await import("../../src/store/authStore");
      const currentUser = useAuthStore.getState().user;
      const { accessToken, refreshToken } = useAuthStore.getState();
      await useAuthStore.getState().setTokens({
        accessToken,
        refreshToken,
        user: { ...currentUser, ...updateData },
      });

      Alert.alert("Success", "Profile updated successfully", [
        { text: "OK", onPress: () => router.back() },
      ]);
    } catch (err) {
      setError(err?.body?.error ?? err?.message ?? "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100">
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text className="text-red-600 text-base">Cancel</Text>
          </Pressable>
          <Text className="text-base font-semibold text-gray-900">Edit Profile</Text>
          <Pressable onPress={handleSave} disabled={saving} hitSlop={12}>
            {saving ? (
              <ActivityIndicator size="small" />
            ) : (
              <Text className="text-red-600 text-base font-semibold">Save</Text>
            )}
          </Pressable>
        </View>

        <ScrollView className="flex-1 px-4 pt-6">
          {/* Name */}
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-2">Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Enter your full name"
              className="h-12 border border-gray-200 rounded-xl px-4 text-base"
              editable={!saving}
            />
          </View>

          {/* Email */}
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-2">Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Enter your email"
              keyboardType="email-address"
              autoCapitalize="none"
              className="h-12 border border-gray-200 rounded-xl px-4 text-base"
              editable={!saving}
            />
            <Text className="text-xs text-gray-500 mt-1">
              Changing your email will require re-verification
            </Text>
          </View>

          {/* Graduation Year (Students only) */}
          {isStudent && (
            <View className="mb-4">
              <Text className="text-sm font-medium text-gray-700 mb-2">
                Graduation Year (Optional)
              </Text>
              <TextInput
                value={graduationYear}
                onChangeText={setGraduationYear}
                placeholder="e.g. 2025"
                keyboardType="number-pad"
                maxLength={4}
                className="h-12 border border-gray-200 rounded-xl px-4 text-base"
                editable={!saving}
              />
            </View>
          )}

          {/* Error */}
          {error && (
            <View className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
              <Text className="text-red-700 text-sm">{error}</Text>
            </View>
          )}

          {/* Role Info */}
          <View className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4">
            <Text className="text-xs text-gray-500">
              Role: <Text className="font-semibold">{user?.role}</Text>
            </Text>
            <Text className="text-xs text-gray-500 mt-1">
              Contact support to change your account type
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
