// Report-reason list, presented as a native form sheet (see the "chat-sheet/report"
// screen in app/_layout.js) so iOS provides the swipe-down dismissal. Opened from
// the chat screen with the thread id, and a message id when one message is being
// reported (long-press); without one the whole conversation is reported.
import { Alert, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CHAT_REPORT_REASONS } from "@proximity/shared";
import apiClient from "../../src/lib/apiClient";
import { chatErrorMessage } from "../../src/lib/chatFormat";

export default function ReportSheet() {
  const { threadId, messageId } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const specificMessage = !!messageId;

  const confirm = (reason) => {
    Alert.alert(
      specificMessage ? "Report this message?" : "Report this conversation?",
      `Reason: ${reason.label}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report",
          onPress: async () => {
            router.back();
            try {
              await apiClient.chat.reportThread(threadId, {
                messageId: messageId || undefined,
                reason: reason.value,
              });
            } catch (err) {
              if (err?.status === 401) return; // session expired: the api client already signed out
              Alert.alert("Couldn't send your report", chatErrorMessage(err, "Please try again."));
              return;
            }
            Alert.alert("Report sent", "Thanks, we'll take a look.");
          },
        },
      ]
    );
  };

  return (
    <View className="bg-white px-4 pt-8" style={{ paddingBottom: insets.bottom + 12 }}>
      <Text className="text-base font-bold text-gray-900 text-center">
        {specificMessage ? "Report this message" : "Report this conversation"}
      </Text>
      <Text className="text-sm text-gray-500 text-center mt-1 mb-3 px-2">
        {specificMessage
          ? "Why are you reporting it? The other person won't be told."
          : "Why are you reporting it? To report one message, press and hold it instead."}
      </Text>
      <View className="bg-gray-50 rounded-2xl overflow-hidden">
        {CHAT_REPORT_REASONS.map((reason, index) => (
          <Pressable
            key={reason.value}
            onPress={() => confirm(reason)}
            className={`px-4 justify-center active:bg-gray-100 ${
              index > 0 ? "border-t border-gray-200" : ""
            }`}
            style={{ height: 52 }}
          >
            <Text className="text-base text-gray-900">{reason.label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={() => router.back()} className="h-12 items-center justify-center mt-1">
        <Text className="text-base font-semibold text-gray-500">Cancel</Text>
      </Pressable>
    </View>
  );
}
