// Change Password screen
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
import apiClient from "../../src/lib/apiClient";
import { ErrorMessage } from "../../src/components/ui/ErrorMessage";
import { getErrorMessage } from "../../src/lib/apiError";
import { ERROR_MESSAGES } from "../../src/lib/errorMessages";

export default function ChangePasswordScreen() {
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    setError(null);

    // Validation
    if (!currentPassword) {
      setError(ERROR_MESSAGES.PROFILE.CURRENT_PASSWORD_REQUIRED);
      return;
    }

    if (!newPassword) {
      setError(ERROR_MESSAGES.PROFILE.NEW_PASSWORD_REQUIRED);
      return;
    }

    if (newPassword.length < 8) {
      setError(ERROR_MESSAGES.PROFILE.NEW_PASSWORD_SHORT);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(ERROR_MESSAGES.PROFILE.PASSWORDS_MISMATCH);
      return;
    }

    if (newPassword === currentPassword) {
      setError(ERROR_MESSAGES.PROFILE.PASSWORD_UNCHANGED);
      return;
    }

    setSaving(true);

    try {
      await apiClient.auth.changePassword(currentPassword, newPassword);

      Alert.alert(
        "Success",
        "Your password has been changed successfully",
        [{ text: "OK", onPress: () => router.back() }]
      );
    } catch (err) {
      setError(getErrorMessage(err, ERROR_MESSAGES.PROFILE.CHANGE_PASSWORD));
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
          <Text className="text-base font-semibold text-gray-900">Change Password</Text>
          <Pressable onPress={handleSave} disabled={saving} hitSlop={12}>
            {saving ? (
              <ActivityIndicator size="small" />
            ) : (
              <Text className="text-red-600 text-base font-semibold">Save</Text>
            )}
          </Pressable>
        </View>

        <ScrollView className="flex-1 px-4 pt-6">
          {/* Current Password */}
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-2">
              Current Password
            </Text>
            <TextInput
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Enter current password"
              secureTextEntry
              className="h-12 border border-gray-200 rounded-xl px-4 text-base"
              editable={!saving}
            />
          </View>

          {/* New Password */}
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-2">
              New Password
            </Text>
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Enter new password"
              secureTextEntry
              className="h-12 border border-gray-200 rounded-xl px-4 text-base"
              editable={!saving}
            />
            <Text className="text-xs text-gray-500 mt-1">
              Must be at least 8 characters
            </Text>
          </View>

          {/* Confirm New Password */}
          <View className="mb-4">
            <Text className="text-sm font-medium text-gray-700 mb-2">
              Confirm New Password
            </Text>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter new password"
              secureTextEntry
              className="h-12 border border-gray-200 rounded-xl px-4 text-base"
              editable={!saving}
            />
          </View>

          {/* Error */}
          <ErrorMessage className="mb-4">{error}</ErrorMessage>

          {/* Security Tips: the `info` role (design-system/MASTER.md §2):
              blue-50/blue-200/blue-900, blue-700 for body text as a second
              tier under the heading. This is where that role originated;
              the colors already matched, only the radius needed fixing. */}
          <View className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
            <Text className="text-sm font-semibold text-blue-900 mb-2">
              Password Requirements:
            </Text>
            <Text className="text-xs text-blue-700">• At least 8 characters</Text>
            <Text className="text-xs text-blue-700">• Different from current password</Text>
            <Text className="text-xs text-blue-700">
              • Use a mix of letters, numbers, and symbols
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
