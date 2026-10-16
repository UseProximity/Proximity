import { Pressable, Text, View } from "react-native";
import { ChatAvatar } from "./ChatAvatar";
import { formatThreadTime, threadListingLabel, threadPreview } from "../../lib/chatFormat";

// One conversation in the inbox. Unread threads get a bold name and preview
// plus a red count badge.
export function ThreadRow({ thread, onPress }) {
  const unread = !!thread.hasUnread;
  const listingLabel = threadListingLabel(thread);
  const name = thread.otherUserName || "Proximity user";

  return (
    <Pressable onPress={onPress} className="flex-row items-center px-4 py-3 active:bg-gray-50">
      <ChatAvatar name={name} image={thread.otherUserImage} />
      <View className="flex-1 ml-3">
        <View className="flex-row items-center justify-between">
          <Text
            numberOfLines={1}
            className={`flex-1 mr-2 text-base text-gray-900 ${unread ? "font-bold" : "font-semibold"}`}
          >
            {name}
          </Text>
          <Text className={`text-xs ${unread ? "text-red-600 font-semibold" : "text-gray-400"}`}>
            {formatThreadTime(thread.lastMessageAt ?? thread.updatedAt)}
          </Text>
        </View>
        {listingLabel ? (
          <Text numberOfLines={1} className="text-xs text-gray-500 mt-0.5">
            {listingLabel}
          </Text>
        ) : null}
        <View className="flex-row items-center mt-0.5">
          <Text
            numberOfLines={1}
            className={`flex-1 text-sm ${unread ? "text-gray-900 font-medium" : "text-gray-500"}`}
          >
            {threadPreview(thread)}
          </Text>
          {unread ? (
            <View className="ml-2 min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 items-center justify-center">
              <Text className="text-white text-[11px] font-bold">
                {thread.unreadCount > 99 ? "99+" : thread.unreadCount || ""}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
