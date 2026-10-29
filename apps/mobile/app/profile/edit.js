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
import { ErrorMessage } from "../../src/components/ui/ErrorMessage";
import { getErrorMessage } from "../../src/lib/apiError";
import { ERROR_MESSAGES } from "../../src/lib/errorMessages";

export default function EditProfileScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [name, setName] = useState(user?.name || "");
  const [graduationYear, setGraduationYear] = useState(user?.graduationYear?.toString() || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isStudent = user?.role === "student";

  const handleSave = async () => {
    setError(null);

    // Validation
    if (!name.trim()) {
      setError(ERROR_MESSAGES.PROFILE.NAME_REQUIRED);
      return;
    }

    if (isStudent && graduationYear && !/^\d{4}$/.test(graduationYear)) {
      setError(ERROR_MESSAGES.PROFILE.GRAD_YEAR);
      return;
    }

    setSaving(true);

    try {
      // The email is read-only here and deliberately never sent.
      const updateData = {
        name: name.trim(),
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
      setError(getErrorMessage(err, ERROR_MESSAGES.PROFILE.SAVE));
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
            <View
              accessible
              accessibilityLabel={`Email, ${user?.email || "not set"}, read only`}
              className="h-12 justify-center bg-gray-50 border border-gray-200 rounded-xl px-4"
            >
              <Text className="text-base text-gray-500" numberOfLines={1}>
                {user?.email}
              </Text>
            </View>
            <Text className="text-xs text-gray-500 mt-1">
              Your email can't be changed here. Contact support if you need to update it.
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
          <ErrorMessage className="mb-4">{error}</ErrorMessage>

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
