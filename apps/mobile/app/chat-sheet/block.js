// Block confirmation, presented as a native form sheet (see the "chat-sheet/block"
// screen in app/_layout.js). iOS gives the swipe-down dismissal, so the sheet
// follows the finger like the swipe-back gesture does. Opened from the chat
// screen's options menu with the thread id and the other person's name and photo.
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ban, BellOff } from "lucide-react-native";
import apiClient from "../../src/lib/apiClient";
import { getErrorMessage } from "../../src/lib/apiError";
import { showError } from "../../src/lib/showError";
import { ERROR_MESSAGES } from "../../src/lib/errorMessages";
import { useChatUnreadStore } from "../../src/store/chatUnreadStore";
import { ChatAvatar } from "../../src/components/chat/ChatAvatar";

export default function BlockSheet() {
  const { threadId, name, image } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const who = name || "this person";

  const block = async () => {
    setBusy(true);
    try {
      await apiClient.chat.blockThread(threadId);
    } catch (err) {
      setBusy(false);
      if (err?.status === 401) return;
      showError(getErrorMessage(err, ERROR_MESSAGES.CHAT.BLOCK));
      return;
    }
    useChatUnreadStore.getState().refresh();
    // Pops both this sheet and the conversation back to the tabs.
    router.dismissTo("/(tabs)/chat");
  };

  return (
    <View className="bg-white px-6 pt-8" style={{ paddingBottom: insets.bottom + 12 }}>
      <View className="items-center mb-4">
        <ChatAvatar name={name} image={image} size={84} />
      </View>
      <Text className="text-2xl font-bold text-gray-900 text-center">Block {who}?</Text>
      <Text className="text-sm text-gray-600 text-center mt-2 mb-5">
        This conversation will be removed from your inbox. To undo this later, contact Proximity
        support at info@useproximity.org.
      </Text>

      <View className="flex-row items-start mb-4">
        <Ban size={26} color="#111827" strokeWidth={1.8} />
        <Text className="flex-1 text-sm text-gray-900 ml-4">
          Neither of you will be able to message the other, and their reviews will be hidden from
          you.
        </Text>
      </View>
      <View className="flex-row items-start mb-6">
        <BellOff size={26} color="#111827" strokeWidth={1.8} />
        <Text className="flex-1 text-sm text-gray-900 ml-4">
          They won&apos;t be notified that you blocked them.
        </Text>
      </View>

      <Pressable
        onPress={block}
        disabled={busy}
        className={`rounded-xl items-center justify-center ${
          busy ? "bg-red-400" : "bg-red-600 active:bg-red-700"
        }`}
        style={{ height: 50 }}
      >
        {busy ? (
          <ActivityIndicator color="#ffffff" />
        ) : (
          <Text className="text-base font-semibold text-white">Block</Text>
        )}
      </Pressable>
      <Pressable
        onPress={() => router.back()}
        disabled={busy}
        className="items-center justify-center mt-1"
        style={{ height: 44 }}
      >
        <Text className="text-base text-gray-500">Cancel</Text>
      </Pressable>
    </View>
  );
}
