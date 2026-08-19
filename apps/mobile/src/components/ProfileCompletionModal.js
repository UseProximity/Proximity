// Profile Completion Modal - shown when user.profileComplete === false
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Check, GraduationCap, Home } from "lucide-react-native";
import apiClient from "../lib/apiClient";
import { colors } from "../theme/tokens";

const ROLES = [
  { value: "student", label: "Student", icon: GraduationCap },
  { value: "landlord", label: "Landlord", icon: Home },
];

export function ProfileCompletionModal({ user, onComplete }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(user?.name || "");
  const [role, setRole] = useState(user?.role || "student");
  const [graduationYear, setGraduationYear] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleContinue = () => {
    setError(null);

    if (step === 1) {
      if (!name.trim()) {
        setError("Please enter your name");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (role === "student" && graduationYear && !/^\d{4}$/.test(graduationYear)) {
        setError("Please enter a valid 4-digit year");
        return;
      }
      handleComplete();
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    setError(null);

    try {
      const updateData = {
        name: name.trim(),
        role,
        profileComplete: true,
      };

      if (role === "student" && graduationYear) {
        updateData.graduationYear = parseInt(graduationYear, 10);
      }

      await apiClient.user.updateProfile(updateData);

      // Update local auth store
      const { useAuthStore } = await import("../store/authStore");
      const { accessToken, refreshToken } = useAuthStore.getState();
      await useAuthStore.getState().setTokens({
        accessToken,
        refreshToken,
        user: { ...user, ...updateData },
      });

      onComplete();
    } catch (err) {
      setError(err?.body?.error ?? err?.message ?? "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={true} animationType="slide" presentationStyle="fullScreen">
      <SafeAreaView className="flex-1 bg-white">
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          {/* Header */}
          <View className="px-6 py-4 border-b border-gray-100">
            <Text className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Step {step} of 2
            </Text>
            <Text className="text-2xl font-bold text-gray-900 mt-1">
              {step === 1 ? "What's your name?" : "Tell us about yourself"}
            </Text>
          </View>

          <ScrollView className="flex-1 px-6 pt-6">
            {step === 1 ? (
              /* Step 1: Name */
              <View>
                <Text className="text-base text-gray-700 mb-4">
                  We'll use this to personalize your experience
                </Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Enter your full name"
                  className="h-14 border-2 border-gray-300 rounded-xl px-4 text-base"
                  editable={!saving}
                  autoFocus
                />
              </View>
            ) : (
              /* Step 2: Role & Graduation Year */
              <View>
                <Text className="text-base font-medium text-gray-900 mb-3">
                  I am a...
                </Text>
                <View className="gap-3 mb-6">
                  {ROLES.map((r) => (
                    <Pressable
                      key={r.value}
                      onPress={() => setRole(r.value)}
                      disabled={saving}
                      className={`flex-row items-center gap-3 p-4 border-2 rounded-xl ${
                        role === r.value
                          ? "border-red-600 bg-red-50"
                          : "border-gray-200 bg-white"
                      }`}
                    >
                      <r.icon size={24} color={role === r.value ? colors.primary : colors.textSecondary} strokeWidth={2} />
                      <View className="flex-1">
                        <Text
                          className={`text-base font-semibold ${
                            role === r.value ? "text-gray-900" : "text-gray-700"
                          }`}
                        >
                          {r.label}
                        </Text>
                      </View>
                      {role === r.value && (
                        <View className="w-6 h-6 rounded-full bg-red-600 items-center justify-center">
                          <Check size={14} color="#ffffff" strokeWidth={3} />
                        </View>
                      )}
                    </Pressable>
                  ))}
                </View>

                {role === "student" && (
                  <View>
                    <Text className="text-base font-medium text-gray-900 mb-2">
                      Graduation Year (Optional)
                    </Text>
                    <TextInput
                      value={graduationYear}
                      onChangeText={setGraduationYear}
                      placeholder="e.g. 2025"
                      keyboardType="number-pad"
                      maxLength={4}
                      className="h-14 border-2 border-gray-300 rounded-xl px-4 text-base"
                      editable={!saving}
                    />
                    <Text className="text-sm text-gray-500 mt-2">
                      This helps us show you relevant housing options
                    </Text>
                  </View>
                )}
              </View>
            )}

            {error && (
              <View className="bg-red-50 border border-red-200 rounded-lg p-3 mt-4">
                <Text className="text-red-700 text-sm">{error}</Text>
              </View>
            )}
          </ScrollView>

          {/* Footer */}
          <View className="px-6 py-4 border-t border-gray-100">
            <Pressable
              onPress={handleContinue}
              disabled={saving}
              className={`h-14 rounded-xl items-center justify-center ${
                saving ? "bg-gray-300" : "bg-red-600"
              }`}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-base font-semibold">
                  {step === 1 ? "Continue" : "Complete Profile"}
                </Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
