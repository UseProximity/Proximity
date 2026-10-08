import { Text, View } from "react-native";
import { formatMessageTime } from "../../lib/chatFormat";

// One chat message. Sent messages sit on the right in brand red, received ones
// on the left in gray. `senderName` is shown above the first received bubble of
// a run, and `listingLabel` as a small centered note when the conversation
// moves to a different property.
export function MessageBubble({ message, senderName, listingLabel }) {
  const mine = !!message.isMine;
  const isAttachment = message.messageType === "attachment";

  return (
    <View className="px-4 mb-2">
      {listingLabel ? (
        <Text className="text-[11px] text-gray-400 text-center my-2" numberOfLines={1}>
          About {listingLabel}
        </Text>
      ) : null}
      {!mine && senderName ? (
        <Text className="text-[11px] text-gray-500 mb-0.5 ml-1">{senderName}</Text>
      ) : null}
      <View className={mine ? "items-end" : "items-start"}>
        <View
          className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
            mine ? "bg-red-600 rounded-tr-sm" : "bg-gray-100 rounded-tl-sm"
          } ${message.pending ? "opacity-60" : ""}`}
        >
          <Text className={`text-sm ${mine ? "text-white" : "text-gray-900"}`}>
            {message.body || (isAttachment ? "Sent a file" : "")}
          </Text>
          {isAttachment ? (
            <Text className={`text-[11px] mt-1 ${mine ? "text-red-100" : "text-gray-500"}`}>
              Attachments can&apos;t be viewed in the app yet
            </Text>
          ) : null}
        </View>
        <Text className="text-[10px] text-gray-400 mt-0.5 mx-1">
          {message.pending ? "Sending..." : formatMessageTime(message.createdAt)}
        </Text>
      </View>
    </View>
  );
}
