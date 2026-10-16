// Test email destination (staging only). Mobile counterpart of the staging web
// app's "Test emails" picker; see src/lib/stagingEmail.js.
import { useEffect, useState } from "react";
import {
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
import {
  getStagingEmail,
  isNonProductionApi,
  isValidTestEmail,
  loadStagingEmail,
  setStagingEmail,
} from "../../src/lib/stagingEmail";

export default function TestEmailScreen() {
  const router = useRouter();
  const enabled = isNonProductionApi(process.env.EXPO_PUBLIC_API_URL);
  const [value, setValue] = useState(getStagingEmail() ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    loadStagingEmail().then((saved) => setValue(saved ?? ""));
  }, [enabled]);

  if (!enabled) return null;

  const valid = value.trim() === "" || isValidTestEmail(value);

  const handleSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    await setStagingEmail(value);
    setSaving(false);
    router.back();
  };

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100">
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text className="text-red-600 text-base">Cancel</Text>
          </Pressable>
          <Text className="text-base font-semibold text-gray-900">Test email destination</Text>
          <Pressable onPress={handleSave} disabled={!valid || saving} hitSlop={12}>
            <Text className={`text-base font-semibold ${valid ? "text-red-600" : "text-gray-300"}`}>
              Save
            </Text>
          </Pressable>
        </View>

        <ScrollView className="flex-1 px-4 pt-6" keyboardShouldPersistTaps="handled">
          <Text className="text-sm text-gray-600 mb-4">
            Enter the inbox that receives every email sent here (owner inquiries, chat alerts,
            etc.). They&apos;re redirected here instead of reaching real people. Until you enter
            one, emails are suppressed.
          </Text>

          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!saving}
            className={`h-12 border rounded-xl px-4 text-base ${
              valid ? "border-gray-200" : "border-red-400"
            }`}
          />
          {!valid ? (
            <Text className="text-xs text-red-500 mt-1">
              Enter a valid email (or leave blank to suppress).
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
